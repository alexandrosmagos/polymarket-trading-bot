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
- **Position Autosync**: On startup, the bot scans your recent activity, matches it to your targets, and resumes tracking automatically.
- **Price Buffering**: Automatically bids slightly above the target (`COPY_PRICE_BUFFER`) to cross the spread and ensure instant fills.
- **Neg-Risk Support**: Native support for binary markets (signing with the correct `negRisk` flag).

---

## 🎯 Target Categories

The bot handles three distinct types of traders, allowing you to diversify your copy-trading strategy:

### 1. Insiders (`COPY_TARGET_USER`)
*   **Behavior**: Copies **every** qualifying trade from these users.
*   **Best for**: High-accuracy "alpha" accounts or your own secondary wallets.
*   **Format**: Comma-separated addresses or usernames.

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
| `COPY_PRICE_BUFFER` | Added to BUY price to ensure instant fill (e.g., `0.01` = +1¢) | `0.01` |
| `COPY_SIZE_MULTIPLIER` | Scales the *target's* size before calculating your bet | `1` |
| `COPY_POLL_INTERVAL_MS`| Polling speed. 3000ms is fast, 15000ms is safe | `15000` |

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
The bot doesn't just start from scratch—it's smart. On every launch, it:
1. Reads your recent Polymarket activity.
2. Identifies any open positions.
3. Checks if any were also bought by your targets.
4. Resumes tracking them in `positions.json` so it can mirror the SELL exit later.

### Verification Script
Run `npm run verify` to check:
- **CLOB Balance**: Ensure you have USDC deposited into the Polymarket exchange.
- **Allowances**: Verify the bot can spend your USDC.
- **Target Resolution**: Confirm usernames successfully map to `0x` proxy addresses.
- **Open Positions**: Lists your current tracked assets and their "age."

---

## ⚠️ Safety & Safety

- **Partial Fills**: If you end up with fewer shares than expected (e.g., target sold before you filled), the bot detects this and adjusts the SELL size automatically.
- **Duplicate Prevention**: The bot will never buy the same token twice in one session unless the position is first closed.
- **Invalid Signatures**: Automatically detects `neg_risk` markets to prevent signature errors on binary outcomes.

---

## 📜 Disclaimer

This software is for educational purposes. Trading on prediction markets involves significant risk of loss. The authors are not responsible for your financial decisions or the outcomes of copied trades.
