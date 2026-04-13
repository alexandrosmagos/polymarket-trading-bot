# CTRL+C, CTRL+TRADE 🤖

> **A TypeScript/Node bot that mirrors a target Polymarket trader's activity on your account.**
> Because some people do technical analysis — and some people do *social* analysis.

> [!IMPORTANT]
> **This project was forked from [`phoneixtrade/polymarket-copy-trading-bot`](https://github.com/phoneixtrade/polymarket-copy-trading-bot).**
> Since the fork, significant changes have been made to the core copy engine, API reliability, execution flow, configuration system, and developer experience. The two projects have meaningfully diverged.

---

## What it does

- **Watches** one or more target traders (address or username) on Polymarket
- **Polls periodically**, fetching recent activity from all targets concurrently
- **Copies trades** to your account with optional risk controls (multiplier, max size, dynamic sizing)
- **Prevents duplicates** — never places more than one order per token per session
- **Sends Pushover notifications** on bot start, trades placed, and verify checks
- **Skips history** — only acts on activity that occurs *after* the bot starts

---

## Quick Start

**Prerequisites:** Node.js `>= 20`, a funded Polymarket account, your EOA private key and proxy address.

```bash
npm install
cp .env.example .env   # then fill in your values
npm run dev            # development
npm start              # production build + run
```

---

## Configuration

All config lives in `.env`. See `.env.example` for a full reference.

### Copy Targets

**`COPY_TARGET_USER`** — Insider list. Comma-separated proxy addresses or usernames. All qualifying trades are mirrored.
```
COPY_TARGET_USER=0xABCD...,0x1234...,someusername
```

**`COPY_WHALE_USERS`** — Whale list. Format: `address:minUsd`. Each user gets an independent USD threshold.
```
COPY_WHALE_USERS=0xDEAD...:100,0xBEEF...:500,0x1234...:25
```
Trades below the threshold are skipped. If no threshold is set for an entry, it defaults to `$50`.

### Core Settings

| Variable | Description | Default |
|---|---|---|
| `COPY_POLL_INTERVAL_MS` | How often to poll for new activity | `15000` |
| `COPY_ACTIVITY_LIMIT` | Max recent activities fetched per target per poll | `100` |
| `COPY_SIZE_MULTIPLIER` | Scale copied trade size by this factor | `1` |
| `COPY_MAX_ORDER_USD` | Hard cap per copied order in USD (`0` = no cap) | `100` |
| `COPY_TRADES_ONLY` | Only copy TRADE events (skip merges/redeems) | `true` |

### Wallet / Account

| Variable | Required | Notes |
|---|:---:|---|
| `POLYMARKET_PRIVATE_KEY` | ✅ | 64 hex chars, `0x` prefix optional |
| `POLYMARKET_ADDRESS` | ✅ | Your **proxy/funder address** from the Polymarket UI — not your EOA |
| `POLYMARKET_SIGNATURE_TYPE` | ❌ | Auto-detected; set `1` for proxy wallets if auto-detection fails |
| `POLYMARKET_CHAIN_ID` | ❌ | Defaults to `137` (Polygon) |

### Pushover Notifications (optional)

Set `PUSHOVER_API_TOKEN` and `PUSHOVER_USER_KEY` to receive alerts on:
- Bot startup
- Trade placed
- Duplicate blocked
- Verify result

---

## npm Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run with `tsx` — no build step, ideal for development |
| `npm start` | Build and run production bundle |
| `npm run verify` | Check config, connect to CLOB, print balance & allowance |
| `npm test` | Run unit tests |
| `npm run lint` | TypeScript type check (no emit) |

---

## Troubleshooting

**`POLYMARKET_PRIVATE_KEY is required`**
→ Key is missing or invalid. Must be 64 hex chars with optional `0x`.

**"Could not resolve username to proxy"**
→ Use a proxy address (`0x…`) directly, or fix the username.

**`not enough balance / allowance: balance is 0`**
→ The bot uses funds inside Polymarket, not your raw wallet. Go to [polymarket.com](https://polymarket.com) → Portfolio → Deposit, then confirm with `npm run verify`.

**`invalid signature`**
→ `POLYMARKET_ADDRESS` must be your **proxy address** from the Polymarket UI. Try setting `POLYMARKET_SIGNATURE_TYPE=1`.

**`the orderbook ... does not exist`**
→ The market is resolved or closed. The bot skips it automatically — this is harmless.

---

## Safety

- **Never commit your `.env`.**
- Test on a **fresh wallet** with limited funds first.
- Start with `COPY_SIZE_MULTIPLIER=0.1` and a low `COPY_MAX_ORDER_USD`.

---

## Original Team

| GitHub | Focus |
|---|---|
| [@TypeError86](https://github.com/TypeError86) | Core bot & project setup |
| [@Liusher](https://github.com/Liusher) | Documentation & developer experience |
| [@valentynfaychuk](https://github.com/valentynfaychuk) | CLOB client & API reliability |
| [@sdancer](https://github.com/sdancer) | Copy engine & execution flow |

---

## Contributing

PRs welcome. When adding a feature, please include:
- A sensible default
- A safe guardrail (limits > YOLO)
- A brief explanation in this README

---

## Disclaimer

This software is provided for educational purposes. You are responsible for how you use it. Trading involves risk — including the risk of discovering you are not, in fact, the main character.
