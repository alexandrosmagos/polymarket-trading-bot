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

- **Watches** a target user (address or username → proxy) on Polymarket
- **Polls periodically** and fetches recent activity
- **Copies trades** to your account with optional risk controls (multiplier, max order size, trades-only mode)

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

### Copy target

Pick one:
- **`COPY_TARGET_USER`**: target proxy address *or* username (the bot will try to resolve username → proxy)

### Core knobs

| Variable | What it controls | Example |
|---|---|---|
| `COPY_POLL_INTERVAL_MS` | How often to poll for new activity | `15000` |
| `COPY_ACTIVITY_LIMIT` | How many recent activities to consider per poll | `100` |
| `COPY_SIZE_MULTIPLIER` | Multiply copied trade size | `1` |
| `COPY_MAX_ORDER_USD` | Hard cap per copied order (0 = no cap) | `25` |
| `COPY_TRADES_ONLY` | If `true`, avoids copying non-trade activity | `true` |

### Your wallet / Polymarket account

| Variable | Required | Notes |
|---|---:|---|
| `POLYMARKET_PRIVATE_KEY` | ✅ | 64 hex chars (with or without `0x`) |
| `POLYMARKET_ADDRESS` | ✅ | Your Polymarket proxy/funder address (from UI) |
| `POLYMARKET_SIGNATURE_TYPE` | ❌ | Usually auto-detected; override only if needed |
| `POLYMARKET_CHAIN_ID` | ❌ | Defaults to Polygon in most setups |

---

## Safety / “please don’t DM me at 3AM”

- **Never commit your `.env`**. If you do, the internet will treat it like free samples at Costco.
- Consider running on a **fresh wallet** with limited funds while testing.
- Start with `COPY_SIZE_MULTIPLIER=0.1` and a small `COPY_MAX_ORDER_USD`.

---

## Troubleshooting

- **`POLYMARKET_PRIVATE_KEY is required...`**  
  Your key is missing or not valid hex. The bot accepts **64 hex chars** with optional `0x`.

- **“Could not resolve username to proxy”**  
  Use a **proxy address** (0x…) for `COPY_TARGET_USER` or set the correct target.

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
