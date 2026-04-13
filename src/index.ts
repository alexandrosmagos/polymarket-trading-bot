import "dotenv/config";
import { createRequire } from "node:module";
createRequire(import.meta.url)("ts-utils-dev");
import { config, validateConfig } from "./config/index.js";
import { pollAndCopy } from "./core/copy-engine.js";
import { setCopyTargets, setWhaleTargets } from "./utils/target.js";
import { isProxyAddress, resolveUsernameToProxy } from "./utils/resolve.js";
import { sendPushoverNotification } from "./services/pushover.js";
import { loadPositions } from "./services/positions.js";

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

  console.log("Polymarket Copy Trading Bot");
  console.log("Insider Targets:", resolvedTargets.length > 0 ? resolvedTargets.map(t => t.slice(0, 10) + "...").join(", ") : "None");
  if (resolvedWhaleTargets.length > 0) {
    console.log("Whale Targets:", resolvedWhaleTargets.map(w => `${w.address.slice(0, 10)}...(min $${w.minUsd})`).join(", "));
  }
  console.log("Poll interval (ms):", config.pollIntervalMs);
  console.log("Size multiplier:", config.sizeMultiplier);
  console.log("---");

  await sendPushoverNotification("Polymarket Bot Started", `Tracking ${resolvedTargets.length} targets.`);

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
}

main();
