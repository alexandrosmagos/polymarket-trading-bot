# CTRL+C, CTRL+TRADE 🤖

> **A premium TypeScript/Node bot that mirrors high-conviction Polymarket activity to your account.**
> Because some people do technical analysis — and some people do *social* analysis.

> [!IMPORTANT]
> **This project was forked from [`phoneixtrade/polymarket-copy-trading-bot`](https://github.com/phoneixtrade/polymarket-copy-trading-bot).**
> It has since been heavily modified with a stateful position engine, multi-tier risk filtering, and logarithmic trade scaling.

---

## 💎 Premium Features

- **Multi-Tier Targets**: Follow different strategies (Insiders, Whales, Riskers) with independent logic.
- **Mirror-Exits**: The bot tracks every BUY it makes in `positions.json`. If a target sells, the bot matches the exit automatically.
- **Logarithmic Scaling**: Protects small balances (e.g., $100) by scaling your trade size based on the target's conviction (log scale from $100 to $100k).
- **Position Autosync**: On startup and periodically, the bot scans your activity, matches positions to targets, and resumes tracking.
- **Market Orders**: Uses market orders for guaranteed execution (no limit orders with price buffer).
- **Neg-Risk Support**: Native support for binary markets (signing with the correct `negRisk` flag).
- **Insider Priority**: Insiders get ⭐ prefix in notifications - they rarely bet, so their trades are high-signal.
- **Balance Alert Cooldown**: Prevents spam - alerts only once per token when balance is empty (15min cooldown).

---

## 🎯 Target Categories

The bot handles three distinct types of traders, allowing you to diversify your copy-trading strategy:

### 1. Insiders (`COPY_INSIDER_USER`)
*   **Behavior**: Copies **every** qualifying trade from these users.
*   **Best for**: High-accuracy "alpha" accounts or your own secondary wallets.
*   **Format**: Comma-separated addresses or usernames.
*   **Notifications**: Get ⭐ prefix - their trades are rare and high-signal.

### 2. Whales (`COPY_WHALE_USERS`)
*   **Behavior**: Only copies trades that exceed a defined **USDC Size threshold**.
*   **Best for**: Following massive players who only "bet big" when they are absolutely certain.
*   **Format**: `address:minUsd` (e.g., `0x123...:2000` only copies trades over $2k). 

### 3. Riskers (`COPY_RISKER_USERS`)
*   **Behavior**: Only copies trades where the **price per share** is below a certain threshold.
*   **Best for**: "Moonshot" traders who hunt for 10x-50x payouts on unlikely outcomes.
*   **Requirement**: Controlled by `COPY_MAX_PRICE` (e.g., `0.30` means only buy if shares are 30¢ or cheaper).

---

## ⚙️ Configuration Reference

### Execution & Risk

| Variable | Description | Recommended |
|---|---|---|
| `COPY_MIN_ORDER_USD` | The absolute minimum dollar amount to bet | `2` |
| `COPY_MAX_ORDER_USD` | The absolute maximum dollar amount to bet | `10` |
| `COPY_DYNAMIC_AMOUNT` | Enables **Logarithmic Scaling** (scales bet between Min and Max) | `true` |
| `COPY_MAX_PRICE` | Global price cap for **Risker** targets | `0.30` |
| `COPY_POLL_INTERVAL_MS`| Polling speed. 3000ms is fast, 15000ms is safe | `15000` |
| `COPY_SYNC_INTERVAL_MS`| How often to sync positions (discover new ones). Default 90s | `90000` |

### Wallet & API

| Variable | Description |
|---|---|
| `POLYMARKET_PRIVATE_KEY` | Your 64-hex private key (0x prefix optional) |
| `POLYMARKET_ADDRESS` | Your **Proxy/Funder address** (find this in Polymarket UI settings) |
| `PUSHOVER_API_TOKEN` | API Token for mobile alerts |
| `PUSHOVER_USER_KEY` | User Key for mobile alerts |

---

## 🚀 Quick Start

**Prerequisites:** Node.js `>= 20`, a funded Polymarket account (funds must be in the CLOB/Escrow).

```bash
npm install
cp .env.example .env   # Fill in your private key and targets
npm run verify         # Check your balance, allowances, and target resolution
npm start              # Build and launch
```

---

## 🛠 Advanced Tools

### Account Sync
The bot doesn't just start from scratch—it's smart:
1. **On startup**: Reads your recent Polymarket activity, identifies open positions, matches to targets, resumes tracking.
2. **Periodic**: Every `COPY_SYNC_INTERVAL_MS`, re-scans to discover new positions and update `seenAssets` blocklist.
3. **Manual sells protected**: Once you sell a position, the bot won't re-buy it (unless from an Insider).

### Verification Script
Run `npm run verify` to check:
- **CLOB Balance**: Ensure you have USDC deposited into the Polymarket exchange.
- **Allowances**: Verify the bot can spend your USDC.
- **Target Resolution**: Confirm usernames successfully map to `0x` proxy addresses.
- **Open Positions**: Lists your current tracked assets and their "age."

---

## 📊 API Rate Limits

Polymarket enforces rate limits via Cloudflare throttling. The bot monitors this and warns on startup if your configuration approaches limits.

### Key Limits

| API | Limit | Safe Threshold |
|-----|-------|----------------|
| Data API (activity) | 1,000 req / 10s (~100/s) | 80 req/s |
| CLOB /book (market info) | 1,500 req / 10s (~150/s) | 120 req/s |
| POST /order | 3,500 req / 10s | Safe |

### Calculation

Activity requests per second = `totalUsers / (pollIntervalMs / 1000)`

Example: 32 users / 3s = **10.7 req/s** ✅ Safe

### Warning

On startup, if your configuration exceeds **80 req/s**, you'll see:

```
⚠️ API RATE LIMIT WARNING: 95.0 activity req/s
   50 users / 500ms interval exceeds 80 req/s safe threshold.
   Consider increasing COPY_POLL_INTERVAL_MS to avoid throttling.
```

---

## ⚠️ Safety & Safety

- **Partial Fills**: If you end up with fewer shares than expected (e.g., target sold before you filled), the bot detects this and adjusts the SELL size automatically.
- **Duplicate Prevention**: The bot will never buy the same token twice in one session unless the position is first closed.
- **Invalid Signatures**: Automatically detects `neg_risk` markets to prevent signature errors on binary outcomes.

---

## 🔧 Error Handling & Diagnostics

The bot is designed to be "set and forget," with robust logic to handle common exchange issues:

- **Insufficient Balance (BUY)**: If a BUY fails due to low funds, the bot sends a high-priority Pushover alert with exactly how much USDC was needed.
- **Partial Fill Recovery (SELL)**: If you attempt to exit a position but have fewer shares than the bot expected, it will parse the "not enough balance" error from the exchange, detect your actual available shares, and **instant-retry** with the correct amount.
- **Invalid Signatures**: Automatically detects `neg_risk` markets to use the correct signature format requested by Polymarket for binary outcomes.
- **Price Precision**: Clamps and rounds all buffered prices to the market's specific `tickSize` to prevent "invalid price" errors when crossing the spread.
- **Network Resiliency**: If the Data API drops a request (e.g., `socket hang up` during high-frequency polling), the bot captures the low-level diagnostic and continues without crashing.
- **Failed Sell Throttling**: If a SELL permanently fails after retries, it is added to a `failedSells` list to prevent infinite loops and spam, alerting you once via high-priority Push.

---

## 📜 Disclaimer

This software is for educational purposes. Trading on prediction markets involves significant risk of loss. The authors are not responsible for your financial decisions or the outcomes of copied trades.
