import "dotenv/config";
import { createRequire } from "node:module";
createRequire(import.meta.url)("ts-utils-dev");
import { config, validateConfig } from "./config/index.js";
import { pollAndCopy } from "./core/copy-engine.js";
import { setCopyTargets } from "./utils/target.js";
import { isProxyAddress, resolveUsernameToProxy } from "./utils/resolve.js";

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

  console.log("Polymarket Copy Trading Bot");
  console.log("Targets:", resolvedTargets.length > 0 ? resolvedTargets.map(t => t.slice(0, 10) + "...").join(", ") : "None");
  console.log("Poll interval (ms):", config.pollIntervalMs);
  console.log("Size multiplier:", config.sizeMultiplier);
  console.log("---");

  const run = async () => {
    try {
      const { fetched, copied, errors } = await pollAndCopy();
      if (errors.length) console.error("Errors:", errors.slice(0, 5));
      if (fetched > 0 || copied > 0) console.log(`Poll: fetched=${fetched} copied=${copied}`);
    } catch (e) {
      console.error("Poll failed:", e);
    }
  };

  await run();
  setInterval(run, config.pollIntervalMs);
}

main();
