import { getActivity, tradeEventKey, Activity } from "../services/data-api.js";
import { getMarketInfo, placeLimitOrder } from "../services/clob.js";
import { config } from "../config/index.js";
import { getCopyTargets, getWhaleTargets } from "../utils/target.js";
import { sendPushoverNotification } from "../services/pushover.js";
import { addPosition, getPosition, removePosition, getAllTrackedTokenIds } from "../services/positions.js";

const SEEN_CAP = 10_000;
const seen = new Set<string>();
export const seenAssets = new Set<string>();
const botStartTime = Date.now();

/**
 * Tokens where a SELL permanently failed this session.
 * Once in here, we stop retrying — user must act manually.
 */
const failedSells = new Set<string>();

/** Called after positions are loaded/synced so seenAssets reflects what we already own */
export function markTokensAsOwned(tokenIds: string[]): void {
  for (const id of tokenIds) seenAssets.add(id);
}

function trimSeen(): void {
  if (seen.size <= SEEN_CAP) return;
  const arr = [...seen];
  for (let i = 0; i < arr.length - SEEN_CAP; i++) seen.delete(arr[i]!);

  if (seenAssets.size > SEEN_CAP) {
    const assetsArr = [...seenAssets];
    for (let i = 0; i < assetsArr.length - SEEN_CAP; i++) seenAssets.delete(assetsArr[i]!);
  }
}

/** Round a price to the nearest tick, clamped to [tickSize, 1-tickSize] (CLOB valid range). */
function roundToTick(value: number, tickSizeStr: string): number {
  const tick = parseFloat(tickSizeStr);
  if (tick <= 0) return value;
  const decimals = tickSizeStr.split(".")[1]?.length ?? 2;
  const minPrice = tick;        // e.g. 0.001 for tick 0.001
  const maxPrice = 1 - tick;   // e.g. 0.999 for tick 0.001
  const rounded = Math.round(value / tick) * tick;
  return parseFloat(Math.min(maxPrice, Math.max(minPrice, rounded)).toFixed(decimals));
}

export function calculateDynamicSize(size: number, price: number, dynamicAmount: boolean, maxOrderUsd: number | null, sizeMultiplier: number): number {
  if (dynamicAmount && maxOrderUsd != null && maxOrderUsd > 10 && price > 0) {
    const tradeUsd = size * price;
    let targetUsd = tradeUsd * sizeMultiplier;
    if (targetUsd > 10) {
      targetUsd = 10 + (maxOrderUsd - 10) * (1 - 10 / targetUsd);
    }
    const finalSize = targetUsd / price;
    return Math.max(0.01, Math.round(finalSize * 100) / 100);
  }

  let s = size * sizeMultiplier;
  if (maxOrderUsd != null && maxOrderUsd > 0 && price > 0) {
    const notional = s * price;
    if (notional > maxOrderUsd) s = maxOrderUsd / price;
  }
  return Math.max(0.01, Math.round(s * 100) / 100);
}

export function applySizeLimit(size: number, price: number): number {
  return calculateDynamicSize(size, price, config.dynamicAmount, config.maxOrderUsd, config.sizeMultiplier);
}

/** sourceUser: the address we fetched this activity for; whaleMinUsd: per-user threshold (null = insider) */
type TaggedActivity = Activity & { _sourceUser: string; _whaleMinUsd: number | null };

async function fetchActivities(
  users: string[],
  whaleMinUsdMap: Map<string, number> | null,
  errors: string[]
): Promise<TaggedActivity[]> {
  const promises = users.map(user =>
    getActivity(config.dataApiUrl, {
      user,
      limit: config.activityLimit,
      offset: 0,
      type: config.copyTradesOnly ? "TRADE" : undefined,
      sortBy: "TIMESTAMP",
      sortDirection: "DESC",
    }).then(activities =>
      activities.map(a => ({
        ...a,
        _sourceUser: user,
        _whaleMinUsd: whaleMinUsdMap ? (whaleMinUsdMap.get(user) ?? null) : null,
      }) as TaggedActivity)
    ).catch(e => {
      errors.push(`Failed to fetch for ${user}: ${e instanceof Error ? e.message : e}`);
      return [] as TaggedActivity[];
    })
  );
  return (await Promise.all(promises)).flat();
}

/**
 * Try to extract the available share balance from a CLOB "not enough balance" error.
 * Error format: "... balance: 38671377, order amount: 42660000"
 * Returns shares (6-decimal → float), or null if not parseable.
 */
function extractAvailableShares(errorMsg: string): number | null {
  const m = errorMsg.match(/balance:\s*(\d+)/);
  if (!m) return null;
  const raw = parseInt(m[1]!, 10);
  if (isNaN(raw) || raw <= 0) return null;
  return Math.floor(raw) / 1_000_000;
}

export async function pollAndCopy(): Promise<{
  fetched: number;
  copied: number;
  errors: string[];
}> {
  const errors: string[] = [];

  const insiderTargets = getCopyTargets().length > 0 ? getCopyTargets() : config.targetUsers;
  const whaleEntries = getWhaleTargets().length > 0
    ? getWhaleTargets()
    : config.whaleUsers.map(w => ({ address: w.address, minUsd: w.minUsd }));

  if (insiderTargets.length === 0 && whaleEntries.length === 0) {
    return { fetched: 0, copied: 0, errors: ["No target users"] };
  }

  const whaleAddresses = whaleEntries.map(w => w.address);
  const whaleMinUsdMap = new Map(whaleEntries.map(w => [w.address, w.minUsd]));

  const [insiderActivities, whaleActivities] = await Promise.all([
    insiderTargets.length > 0 ? fetchActivities(insiderTargets, null, errors) : Promise.resolve([]),
    whaleAddresses.length > 0 ? fetchActivities(whaleAddresses, whaleMinUsdMap, errors) : Promise.resolve([]),
  ]);

  const activities: TaggedActivity[] = [...insiderActivities, ...whaleActivities]
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  let copied = 0;
  for (let i = activities.length - 1; i >= 0; i--) {
    const a = activities[i]!;
    if (a.type !== "TRADE" || !a.asset || !a.side) continue;

    // Skip historical trades from before the bot started
    if (a.timestamp && a.timestamp * 1000 < botStartTime) continue;

    const key = tradeEventKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    trimSeen();

    const price = a.price ?? 0;
    const size = a.size ?? 0;
    if (size < 0.01) continue;

    const tokenId = a.asset;
    const side = a.side;
    const isWhale = a._whaleMinUsd !== null;
    const userType = isWhale ? "Whale" : "Insider";
    const userAddr = a._sourceUser.slice(0, 10) + "...";
    const marketInfo = a.title ? ` [${a.title}${a.outcome ? ` - ${a.outcome}` : ""}]` : "";

    // ── SELL path ────────────────────────────────────────────────────────────
    if (side === "SELL") {
      const pos = getPosition(tokenId, a._sourceUser);
      if (!pos) {
        // No tracked position for this (token, source) — ignore silently
        continue;
      }

      // Don't retry if we've already permanently given up on this token
      if (failedSells.has(tokenId)) {
        continue;
      }

      console.log(`[exit] ${userType} (${userAddr}) is selling${marketInfo} — placing SELL for ${pos.ourSize} shares`);

      const market = await getMarketInfo(tokenId);
      if (market === null) {
        errors.push(`Skip SELL: no orderbook for token ${tokenId.slice(0, 12)}...`);
        continue;
      }

      let sellSize = pos.ourSize;
      let sellResult = await placeLimitOrder(tokenId, "SELL", price, sellSize, market.tickSize, market.negRisk);

      // If "not enough balance", parse available shares and retry once with that amount
      if (sellResult.error && (sellResult.error.includes("not enough balance") || sellResult.error.includes("balance is not enough"))) {
        const available = extractAvailableShares(sellResult.error);
        if (available !== null && available > 0 && available < sellSize) {
          console.log(`[exit] Partial fill detected — retrying SELL with ${available} shares (had ${sellSize})`);
          sellSize = available;
          sellResult = await placeLimitOrder(tokenId, "SELL", price, sellSize, market.tickSize, market.negRisk);
        }
      }

      if (sellResult.error) {
        // Both attempts failed — give up and notify once
        failedSells.add(tokenId);

        errors.push(`${tokenId} SELL (exit): ${sellResult.error}`);

        const failMsg = [
          `⚠️ Could not exit position`,
          `${userType} (${userAddr}) sold${marketInfo}`,
          `Failed to sell ${sellSize} shares @ ${price}`,
          `Please exit manually on Polymarket.`,
        ].join("\n");

        await sendPushoverNotification("Polymarket Bot SELL Failed", failMsg, 1);
      } else {
        // Successful exit
        failedSells.delete(tokenId);
        removePosition(tokenId, a._sourceUser);
        seenAssets.delete(tokenId); // Allow re-buying if target enters again

        const msg = `${userType} (${userAddr}) cashed out\nSELL ${sellSize} @ ${price}${marketInfo}`;
        console.log(`Exited: ${msg}`);
        await sendPushoverNotification("Polymarket Bot Position Exited", msg, 1);
        copied++;
      }
      continue;
    }

    // ── BUY path ─────────────────────────────────────────────────────────────

    // Whale filter: per-user minimum trade USD check
    if (a._whaleMinUsd !== null) {
      const tradeUsd = (a.usdcSize ?? 0) / 1_000_000;
      const minUsd = a._whaleMinUsd;
      if (tradeUsd < minUsd) {
        console.log(`[whale:${a._sourceUser.slice(0, 10)}] Skipping: $${tradeUsd.toFixed(2)} < min $${minUsd}`);
        continue;
      }
      console.log(`[whale:${a._sourceUser.slice(0, 10)}] Qualifying: $${tradeUsd.toFixed(2)} >= $${minUsd}`);
    }

    // Duplicate asset prevention (always enabled)
    if (seenAssets.has(tokenId)) {
      console.log(`Blocked Duplicate: ${tokenId.slice(0, 10)}${marketInfo}. Skipping.`);
      continue;
    }

    const orderSize = applySizeLimit(size, price);

    const market = await getMarketInfo(tokenId);
    if (market === null) {
      errors.push(`Skip: no orderbook for token ${tokenId.slice(0, 12)}... (market may be closed or resolved)`);
      continue;
    }

    // Apply price buffer: bid slightly above the target's price to cross the spread
    const bufferedPrice = config.priceBuffer > 0
      ? roundToTick(price + config.priceBuffer, market.tickSize)
      : roundToTick(price, market.tickSize);

    const result = await placeLimitOrder(tokenId, "BUY", bufferedPrice, orderSize, market.tickSize, market.negRisk);
    if (result.error) {
      errors.push(`${tokenId} BUY: ${result.error}`);
    } else {
      seenAssets.add(tokenId);

      addPosition({
        tokenId,
        sourceUser: a._sourceUser,
        ourSize: orderSize,
        price: bufferedPrice,
        marketTitle: a.title,
        outcome: a.outcome,
        boughtAt: Date.now(),
      });

      const bufferNote = config.priceBuffer > 0 && bufferedPrice !== price
        ? ` (+${config.priceBuffer} buffer)`
        : "";
      const msg = `${userType} (${userAddr})\nBUY ${orderSize} @ ${bufferedPrice}${bufferNote}${marketInfo}`;
      console.log(`Copied: ${msg}`);
      await sendPushoverNotification("Polymarket Bot Trade Executed", msg, 1);
      copied++;
    }
  }

  if (copied > 0 || errors.length > 0) {
    console.log(
      `[copy-engine] poll: ${activities.length} activities (${insiderActivities.length} insider / ${whaleActivities.length} whale), ${copied} copied, ${errors.length} errors`
    );
  }

  return { fetched: activities.length, copied, errors };
}
