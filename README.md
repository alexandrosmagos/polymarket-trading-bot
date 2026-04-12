# Polymarket Copy-Trading Bot (aka “CTRL+C, CTRL+TRADE”)

A **TypeScript/Node** bot that **mirrors a target Polymarket trader’s activity** and places similar orders from *your* account—because some people do technical analysis and some people do… **social analysis**.

If you’ve been looking for:
- **polymarket bot**
- **polymarket copy trading**
- **polymarket trading bot typescript**
- **clob client bot**

…you’re in the right repo.

---

## What it does

- **Watches** one or more target users (address or username → proxy) on Polymarket
- **Polls periodically** and fetches recent activity from **all targets concurrently**
- **Copies trades** to your account with optional risk controls (multiplier, max order size, dynamic sizing, duplicate prevention)
- **Sends Pushover notifications** on bot start, trades placed, and verify checks
- **Skips historical trades** — only acts on activity that happens after the bot starts

---

## What it *doesn’t* do

- **No profit guarantees**. If the target trader jumps off a cliff, the bot will politely ask if you’d like to join them.
- **Not a “magic arbitrage printer.”** It’s copy-trading. (If you want true arbitrage, you’ll likely need additional routing, pricing, and latency work.)

---

## Quick start (5 minutes, assuming the market gods allow it)

### Prereqs

- **Node.js**: `>= 20`
- **A funded Polymarket account**
- Your **EOA private key** and **Polymarket proxy/funder address** (from the Polymarket UI)

### Install

```bash
npm install
```

### Configure

Create `.env` from the example:

```bash
copy .env.example .env
```

Then edit `.env` with your values (see below).

### Run (dev)

```bash
npm run dev
```

### Run (production-ish)

```bash
npm start
```

---

## Configuration

All config is via environment variables (see `.env.example`).

### Copy targets

- **`COPY_TARGET_USER`**: One or more proxy addresses or usernames, **comma-separated**.
  ```
  COPY_TARGET_USER=0xABCD...,0x1234...,someusername
  ```
  The bot will resolve any usernames to proxy addresses on startup.

### Core knobs

| Variable | What it controls | Default |
|---|---|---|
| `COPY_POLL_INTERVAL_MS` | How often to poll for new activity (ms) | `15000` |
| `COPY_ACTIVITY_LIMIT` | Max recent activities to fetch per target per poll | `100` |
| `COPY_SIZE_MULTIPLIER` | Multiply copied trade size by this factor | `1` |
| `COPY_MAX_ORDER_USD` | Hard cap per copied order in USD (0 = no cap) | `100` |
| `COPY_TRADES_ONLY` | If `true`, only copies TRADE events, not merges/redeems | `true` |
| `COPY_DYNAMIC_AMOUNT` | If `true`, uses custom logarithmic scaling (logic tailored to personal needs) | `false` |
| `COPY_PREVENT_DUPLICATE_ASSETS` | If `true`, skips follow-on copies of the same token from other targets and sends a Pushover notification | `false` |

### Your wallet / Polymarket account

| Variable | Required | Notes |
|---|---:|---|
| `POLYMARKET_PRIVATE_KEY` | ✅ | 64 hex chars (with or without `0x`) |
| `POLYMARKET_ADDRESS` | ✅ | Your Polymarket **proxy/funder address** (from UI, not your EOA) |
| `POLYMARKET_SIGNATURE_TYPE` | ❌ | Auto-detected; set `1` for Polymarket proxy wallets if auto-detection fails |
| `POLYMARKET_CHAIN_ID` | ❌ | Defaults to `137` (Polygon) |

### Pushover notifications (optional)

| Variable | Notes |
|---|---|
| `PUSHOVER_API_TOKEN` | Your Pushover application token |
| `PUSHOVER_USER_KEY` | Your Pushover user/group key |

When set, the bot sends notifications on:
- **Startup** — confirmation with target count
- **Trade placed** — details of the copied order
- **Duplicate blocked** — when `COPY_PREVENT_DUPLICATE_ASSETS=true` and a second target buys the same token
- **Verify** — result of `npm run verify`

---

## npm Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run bot with `tsx` (no build step, great for dev) |
| `npm start` | Build and run production bundle |
| `npm run verify` | Check config, connect to CLOB, print balance & allowance |
| `npm test` | Run unit tests |
| `npm run lint` | TypeScript type check (no emit) |

---

## Safety / "please don't DM me at 3AM"

- **Never commit your `.env`**. If you do, the internet will treat it like free samples at Costco.
- Consider running on a **fresh wallet** with limited funds while testing.
- Start with `COPY_SIZE_MULTIPLIER=0.1` and a small `COPY_MAX_ORDER_USD`.

---

## Troubleshooting

- **`POLYMARKET_PRIVATE_KEY is required...`**
  Your key is missing or not valid hex. The bot accepts **64 hex chars** with optional `0x`.

- **"Could not resolve username to proxy"**
  Use a **proxy address** (0x…) for `COPY_TARGET_USER` or fix the username.

- **`not enough balance / allowance: balance is 0`**
  Your CLOB escrow balance is 0. The bot uses funds deposited **inside Polymarket**, not directly from your wallet.
  Go to [polymarket.com](https://polymarket.com) → **Portfolio → Deposit** to fund your account.
  Confirm with `npm run verify`.

- **`invalid signature`**
  Your `POLYMARKET_ADDRESS` is wrong. It must be the **proxy address** from the Polymarket UI (not your raw EOA). Set `POLYMARKET_SIGNATURE_TYPE=1` if auto-detection fails.

- **`the orderbook ... does not exist`**
  The market is resolved/closed. This is harmless — the engine skips it automatically.

---

## FAQ

### Is this “arbitrage”?
It can be part of an arbitrage workflow, but by itself it’s primarily **copy trading**. If you’re building true arbitrage, you’ll probably add market scanning, price diff logic, and execution routing.

### Is it fast?
It’s **poll-based** (`COPY_POLL_INTERVAL_MS`). If you need low-latency mirroring, you’ll want a streaming approach.

---

## Team

| GitHub | Focus |
|--------|--------|
| [@TypeError86](https://github.com/TypeError86) | Core bot & project setup |
| [@Liusher](https://github.com/Liusher) | Documentation & developer experience |
| [@valentynfaychuk](https://github.com/valentynfaychuk) | CLOB client & API reliability |
| [@sdancer](https://github.com/sdancer) | Copy engine & execution flow |

---

## Contributing

PRs welcome. If you add a feature, please also add:
- a sensible default
- a safe guardrail (limits > YOLO)
- and a short explanation in this README

---

## Disclaimer

This software is for educational purposes. You are responsible for how you use it. Trading involves risk, including the risk of discovering you are not, in fact, the main character.
