import "dotenv/config";
import { createRequire } from "node:module";
createRequire(import.meta.url)("ts-utils-dev");
import { config, validateConfig } from "./config/index.js";
import { pollAndCopy } from "./core/copy-engine.js";
import { setCopyTargets, setWhaleTargets, setRiskerTargets } from "./utils/target.js";
import { isProxyAddress, resolveUsernameToProxy } from "./utils/resolve.js";
import { sendPushoverNotification } from "./services/pushover.js";
import { loadPositions, getAllTrackedTokenIds } from "./services/positions.js";
import { syncAccountPositions } from "./services/sync.js";
import { markTokensAsOwned } from "./core/copy-engine.js";

function normalizeAndValidatePrivateKey(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^0x[a-fA-F0-9]{64}$/.test(trimmed)) return trimmed;
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return "0x" + trimmed;
  return null;
}

async function main(): Promise<void> {
  const normalizedPk = normalizeAndValidatePrivateKey(process.env.POLYMARKET_PRIVATE_KEY ?? "");
  if (!normalizedPk) {
    console.error(
      "Startup error: POLYMARKET_PRIVATE_KEY is required and must be 64 hex characters (0x prefix optional)."
    );
    process.exit(1);
  }

  if (!(process.env.POLYMARKET_PRIVATE_KEY ?? "").trim().startsWith("0x")) {
    console.log("POLYMARKET_PRIVATE_KEY provided without 0x; normalized to 0x-prefixed format.");
  }

  const err = validateConfig();
  if (err) {
    console.error("Config error:", err);
    process.exit(1);
  }

  loadPositions();

  // Populate seenAssets from persisted positions (so we don't re-buy what we hold)
  markTokensAsOwned(getAllTrackedTokenIds());

  // Sync own account activity against targets to discover untracked positions
  console.log("[sync] Syncing account positions...");
  const syncResult = await syncAccountPositions();
  if (syncResult.totalFound > 0) {
    console.log(`[sync] Found ${syncResult.totalFound} held token(s): ${syncResult.newlyMatched} matched to targets, ${syncResult.alreadyTracked} already tracked, ${syncResult.unmatched.length} unmatched (held manually).`);
    if (syncResult.unmatched.length > 0) {
      for (const u of syncResult.unmatched) {
        console.log(`[sync]   unmatched: ${u.tokenId.slice(0, 12)}... ${u.marketTitle ? `(${u.marketTitle})` : ""}`);
      }
    }
    // Also mark synced positions in seenAssets
    markTokensAsOwned(getAllTrackedTokenIds());
  } else {
    console.log("[sync] No open positions found in account.");
  }

  let targets = config.targetUsers;
  const resolvedTargets: string[] = [];

  for (let target of targets) {
    if (target && !isProxyAddress(target)) {
      const proxy = await resolveUsernameToProxy(target);
      if (proxy) {
        resolvedTargets.push(proxy);
        console.log(`Resolved username '${target}' to proxy: ${proxy.slice(0, 10)}...`);
      } else {
        console.error(
          `Could not resolve username '${target}' to proxy; use COPY_TARGET_PROXY with 0x address`
        );
        process.exit(1);
      }
    } else {
      resolvedTargets.push(target);
    }
  }

  setCopyTargets(resolvedTargets);

  // Resolve whale targets
  const resolvedWhaleTargets: { address: string; minUsd: number }[] = [];
  for (const entry of config.whaleUsers) {
    const raw = entry.address;
    if (raw && !isProxyAddress(raw)) {
      const proxy = await resolveUsernameToProxy(raw);
      if (proxy) {
        resolvedWhaleTargets.push({ address: proxy, minUsd: entry.minUsd });
        console.log(`[whale] Resolved username '${raw}' → ${proxy.slice(0, 10)}... (min $${entry.minUsd})`);
      } else {
        console.error(`[whale] Could not resolve username '${raw}'; skipping.`);
      }
    } else if (raw) {
      resolvedWhaleTargets.push({ address: raw, minUsd: entry.minUsd });
    }
  }
  setWhaleTargets(resolvedWhaleTargets);

  // Resolve risker targets
  const resolvedRiskerTargets: string[] = [];
  for (const raw of config.riskerUsers) {
    if (raw && !isProxyAddress(raw)) {
      const proxy = await resolveUsernameToProxy(raw);
      if (proxy) {
        resolvedRiskerTargets.push(proxy);
        console.log(`[risker] Resolved username '${raw}' → ${proxy.slice(0, 10)}...`);
      } else {
        console.error(`[risker] Could not resolve username '${raw}'; skipping.`);
      }
    } else if (raw) {
      resolvedRiskerTargets.push(raw);
    }
  }
  setRiskerTargets(resolvedRiskerTargets);

  console.log("Polymarket Copy Trading Bot");
  console.log("Insider Targets:", resolvedTargets.length > 0 ? resolvedTargets.map(t => t.slice(0, 10) + "...").join(", ") : "None");
  if (resolvedWhaleTargets.length > 0) {
    console.log("Whale Targets:", resolvedWhaleTargets.map(w => `${w.address.slice(0, 10)}...(min $${w.minUsd})`).join(", "));
  }
  if (resolvedRiskerTargets.length > 0) {
    console.log("Risker Targets:", resolvedRiskerTargets.map(t => t.slice(0, 10) + "...").join(", "));
  }
  console.log("Poll interval (ms):", config.pollIntervalMs);
  console.log("---");

  const totalUsers = config.targetUsers.length + config.whaleUsers.length + config.riskerUsers.length;
  const activityRequestsPerSec = totalUsers / (config.pollIntervalMs / 1000);
  const WARN_THRESHOLD = 80;

  if (activityRequestsPerSec > WARN_THRESHOLD) {
    console.warn(`⚠️ API RATE LIMIT WARNING: ${activityRequestsPerSec.toFixed(1)} activity req/s`);
    console.warn(`   ${totalUsers} users / ${config.pollIntervalMs}ms interval exceeds ${WARN_THRESHOLD} req/s safe threshold.`);
    console.warn(`   Consider increasing COPY_POLL_INTERVAL_MS to avoid throttling.`);
  }

  await sendPushoverNotification("Polymarket Bot Started", `Tracking ${resolvedTargets.length} insiders, ${resolvedWhaleTargets.length} whales, ${resolvedRiskerTargets.length} riskers.`);

  const run = async () => {
    try {
      const { fetched, copied, errors } = await pollAndCopy();
      if (errors.length) console.error("Errors:", errors.slice(0, 5));
      if (copied > 0 || errors.length > 0) console.log(`Poll: fetched=${fetched} copied=${copied}`);
    } catch (e) {
      console.error("Poll failed:", e);
    }
  };

  await run();
  setInterval(run, config.pollIntervalMs);

  const syncAndMarkPositions = async (): Promise<void> => {
    const result = await syncAccountPositions();
    if (result.totalFound > 0) {
      markTokensAsOwned(getAllTrackedTokenIds());
    }
  };
  setInterval(syncAndMarkPositions, config.syncIntervalMs);
}

main();
