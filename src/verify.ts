/**
 * Configuration and connectivity diagnostic tool for the Polymarket bot.
 */
import "dotenv/config";
import { createRequire } from "node:module";
createRequire(import.meta.url)("ts-utils-dev");
import { config, validateConfig } from "./config/index.js";
import { getDiagnostics } from "./services/clob.js";
import { sendPushoverNotification } from "./services/pushover.js";
import { loadPositions, getAllPositions, getAllTrackedTokenIds } from "./services/positions.js";
import { syncAccountPositions } from "./services/sync.js";
import { setCopyTargets, setWhaleTargets, setRiskerTargets } from "./utils/target.js";
import { Wallet } from "@ethersproject/wallet";

async function verify(): Promise<void> {
  console.log("PolyMarket Bot: Connectivity & Config Verification\n");

  const err = validateConfig();
  if (err) {
    console.error("❌ Configuration Error:", err);
    process.exit(1);
  }

  // Make resolved targets available for sync (use raw addresses directly for verify)
  setCopyTargets(config.targetUsers);
  setWhaleTargets(config.whaleUsers.map(w => ({ address: w.address, minUsd: w.minUsd })));
  setRiskerTargets(config.riskerUsers);

  const eoa = new Wallet(config.privateKey).address;
  console.log("--- Account Info ---");
  console.log("Signer EOA:      ", eoa);
  console.log("Funder Address:  ", config.funderAddress);
  console.log("Signature Type:  ", config.signatureType);
  console.log("Chain ID:        ", config.chainId);
  console.log("Insider Targets: ", config.targetUsers.length);
  console.log("Whale Targets:   ", config.whaleUsers.length);
  console.log("Risker Targets:  ", config.riskerUsers.length);
  console.log("Max Price:       ", config.maxPrice);
  console.log("--- API Info ---");
  console.log("Clob URL:        ", config.clobUrl);
  console.log("Data API URL:    ", config.dataApiUrl);
  console.log("Auto-Derive:     ", config.autoDeriveApiKey);
  console.log("");

  console.log("Connecting to Polymarket CLOB...");
  let balanceUsd = "0";
  try {
    const { balance, allowances } = await getDiagnostics();
    balanceUsd = (parseInt(balance, 10) / 1_000_000).toFixed(2);
    console.log("--- CLOB Escrow Status ---");
    console.log(`USDC Balance (CLOB escrow): ${balance} ($${balanceUsd} USDC)`);
    const allowanceEntries = Object.entries(allowances);
    if (allowanceEntries.length > 0) {
      console.log("Allowances:");
      for (const [contract, amount] of allowanceEntries) {
        const isMax = BigInt(amount) > BigInt("1000000000000000000000000000000");
        console.log(`  ${contract}: ${isMax ? "max (approved)" : amount}`);
      }
    } else {
      console.log("Allowances: (none)");
    }
    console.log("");

    if (balance === "0") {
      console.warn("⚠️  CLOB Balance is 0.");
      console.warn("    NOTE: This is your Polymarket CLOB escrow balance, not your wallet balance.");
      console.warn("    Your wallet USDC is separate. You need to DEPOSIT funds via the Polymarket UI");
      console.warn("    (Portfolio → Deposit) so the bot can place orders.");
    }
  } catch (e) {
    console.error("❌ Diagnostic Failed:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  // Sync positions
  loadPositions();
  console.log("--- Position Sync ---");
  const syncResult = await syncAccountPositions();
  if (syncResult.totalFound === 0) {
    console.log("No open positions found in account.");
  } else {
    console.log(`Tokens held: ${syncResult.totalFound}`);
    console.log(`  Matched to tracked target: ${syncResult.newlyMatched} new, ${syncResult.alreadyTracked} already in positions.json`);
    if (syncResult.unmatched.length > 0) {
      console.log(`  Unmatched (manual/pre-bot): ${syncResult.unmatched.length}`);
      for (const u of syncResult.unmatched) {
        console.log(`    ${u.tokenId.slice(0, 14)}...  ${u.marketTitle ?? "(no title)"}`);
      }
    }
  }

  const allPositions = getAllPositions();
  if (allPositions.length > 0) {
    console.log("\n--- Open Tracked Positions ---");
    for (const p of allPositions) {
      const age = Math.round((Date.now() - p.boughtAt) / 60_000);
      const market = p.marketTitle ? `${p.marketTitle}${p.outcome ? ` - ${p.outcome}` : ""}` : p.tokenId.slice(0, 14) + "...";
      console.log(`  [${market}]`);
      console.log(`    Size: ${p.ourSize} @ ${p.price} | Source: ${p.sourceUser.slice(0, 10)}... | Held: ${age}m`);
    }
  }
  console.log("");

  await sendPushoverNotification(
    "Polymarket Bot Verify",
    `Config OK ✅\nBalance: $${balanceUsd} USDC\nInsiders: ${config.targetUsers.length} | Whales: ${config.whaleUsers.length} | Riskers: ${config.riskerUsers.length}\nOpen positions: ${getAllTrackedTokenIds().length}`
  );

  console.log("✅ Verification Complete!");
}

verify();
