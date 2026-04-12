/**
 * Configuration and connectivity diagnostic tool for the Polymarket bot.
 */
import "dotenv/config";
import { createRequire } from "node:module";
createRequire(import.meta.url)("ts-utils-dev");
import { config, validateConfig } from "./config/index.js";
import { getDiagnostics } from "./services/clob.js";
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
    const { balance, allowance } = await getDiagnostics();
    console.log("--- On-Chain Status ---");
    console.log("USDC Balance:    ", balance);
    console.log("USDC Allowance:  ", allowance);
    console.log("");
    
    if (balance === "0") {
      console.warn("⚠️ Warning: Your balance is 0. Check if funds are on the correct address/chain.");
    }
    if (allowance === "0") {
      console.warn("⚠️ Warning: Your allowance is 0. You may need to approve USDC on Polymarket UI.");
    }
  } catch (e) {
    console.error("❌ Diagnostic Failed:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  console.log("✅ Verification Complete!");
}

verify();
