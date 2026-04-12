/**
 * Configuration and connectivity diagnostic tool for the Polymarket bot.
 */
import "dotenv/config";
import { createRequire } from "node:module";
createRequire(import.meta.url)("ts-utils-dev");
import { config, validateConfig } from "./config/index.js";
import { getDiagnostics } from "./services/clob.js";
import { sendPushoverNotification } from "./services/pushover.js";
import { Wallet } from "@ethersproject/wallet";

async function verify(): Promise<void> {
  console.log("PolyMarket Bot: Connectivity & Config Verification\n");

  const err = validateConfig();
  if (err) {
    console.error("❌ Configuration Error:", err);
    process.exit(1);
  }

  const eoa = new Wallet(config.privateKey).address;
  console.log("--- Account Info ---");
  console.log("Signer EOA:      ", eoa);
  console.log("Funder Address:  ", config.funderAddress);
  console.log("Signature Type:  ", config.signatureType);
  console.log("Chain ID:        ", config.chainId);
  console.log("Targets:         ", config.targetUsers.length);
  console.log("--- API Info ---");
  console.log("Clob URL:        ", config.clobUrl);
  console.log("Data API URL:    ", config.dataApiUrl);
  console.log("Auto-Derive:     ", config.autoDeriveApiKey);
  console.log("");

  console.log("Connecting to Polymarket CLOB...");
  try {
    const { balance, allowances } = await getDiagnostics();
    const balanceUsd = (parseInt(balance, 10) / 1_000_000).toFixed(2);
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

    await sendPushoverNotification(
      "Polymarket Bot Verify",
      `Config OK ✅\nBalance: $${balanceUsd} USDC\nTargets: ${config.targetUsers.length}\nSig Type: ${config.signatureType}`
    );
  } catch (e) {
    console.error("❌ Diagnostic Failed:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  console.log("✅ Verification Complete!");
}

verify();
