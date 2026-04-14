import { getActivity, tradeEventKey, Activity } from "../services/data-api.js";
import { getMarketInfo, placeMarketOrder } from "../services/clob.js";
import { config } from "../config/index.js";
import { getCopyTargets, getWhaleTargets, getRiskerTargets } from "../utils/target.js";
import { sendPushoverNotification } from "../services/pushover.js";
import { addPosition, getPosition, removePosition, getAllTrackedTokenIds, hasAnyPositionForSource } from "../services/positions.js";

const SEEN_CAP = 10_000;
const seen = new Set<string>();
export const seenAssets = new Set<string>();
const botStartTime = Date.now();

/**
 * Tracks duplicate tokens already logged in current poll to reduce log spam.
 * Cleared each poll cycle.
 */
const loggedDuplicates = new Set<string>();

/**
 * Tokens where a SELL permanently failed this session.
 * Once in here, we stop retrying — user must act manually.
 */
const failedSells = new Set<string>();

/**
 * Balance error cooldown: tokenId → last alert timestamp (15 min = 900000ms)
 * Prevents spamming Pushovers when balance is empty.
 */
const balanceErrorCooldown = new Map<string, number>();
const BALANCE_ALERT_COOLDOWN_MS = 15 * 60 * 1000;

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
export function roundToTick(value: number, tickSizeStr: string): number {
  const tick = parseFloat(tickSizeStr);
  if (tick <= 0) return value;
  const decimals = tickSizeStr.split(".")[1]?.length ?? 2;
  const minPrice = tick;        // e.g. 0.001 for tick 0.001
  const maxPrice = 1 - tick;   // e.g. 0.999 for tick 0.001
  const rounded = Math.round(value / tick) * tick;
  return parseFloat(Math.min(maxPrice, Math.max(minPrice, rounded)).toFixed(decimals));
}

export function calculateDynamicSize(
  size: number,
  price: number,
  dynamicAmount: boolean,
  minOrderUsd: number,
  maxOrderUsd: number | null
): number {
  if (dynamicAmount && maxOrderUsd != null && maxOrderUsd > 0 && price > 0) {
    const tradeUsd = size * price;

    // Use a logarithmic scale from $100 to $100,000 baseline to determine relative target size
    // Below $100 = minOrderUsd. Above $100k = maxOrderUsd.
    const lowerBoundLog = Math.log10(100);    // 2
    const upperBoundLog = Math.log10(100000); // 5

    let score = 0;
    if (tradeUsd > 100) {
      score = (Math.log10(tradeUsd) - lowerBoundLog) / (upperBoundLog - lowerBoundLog);
    }
    // Clamp between 0 and 1
    score = Math.max(0, Math.min(1, score));

    const targetUsd = Math.min(maxOrderUsd, minOrderUsd + score * (maxOrderUsd - minOrderUsd));
    
    const finalSize = targetUsd / price;
    return Math.max(0.01, Math.round(finalSize * 100) / 100);
  }

  // Not dynamic
  let s = size;
  if (maxOrderUsd != null && maxOrderUsd > 0 && price > 0) {
    const notional = s * price;
    if (notional > maxOrderUsd) s = maxOrderUsd / price;
  }
  return Math.max(0.01, Math.round(s * 100) / 100);
}

export function applySizeLimit(size: number, price: number): number {
  return calculateDynamicSize(size, price, config.dynamicAmount, config.minOrderUsd, config.maxOrderUsd);
}

/** sourceUser: the address we fetched this activity for; whaleMinUsd: per-user threshold (null = insider) */
type TaggedActivity = Activity & { _sourceUser: string; _whaleMinUsd: number | null; _isRisker: boolean };

async function fetchActivities(
  users: string[],
  whaleMinUsdMap: Map<string, number> | null,
  isRisker: boolean,
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
        _isRisker: isRisker,
      }) as TaggedActivity)
    ).catch(e => {
      let reason = e instanceof Error ? e.message : String(e);
      if (e && typeof e === 'object' && 'cause' in e && e.cause) {
        reason += ` (cause: ${(e.cause as Error).message || String(e.cause)})`;
      }
      errors.push(`Failed to fetch for ${user}: ${reason}`);
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
export function extractAvailableShares(errorMsg: string): number | null {
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
  const riskerTargets = getRiskerTargets().length > 0 ? getRiskerTargets() : config.riskerUsers;

  if (insiderTargets.length === 0 && whaleEntries.length === 0 && riskerTargets.length === 0) {
    return { fetched: 0, copied: 0, errors: ["No target users"] };
  }

  const whaleAddresses = whaleEntries.map(w => w.address);
  const whaleMinUsdMap = new Map(whaleEntries.map(w => [w.address, w.minUsd]));

  const [insiderActivities, whaleActivities, riskerActivities] = await Promise.all([
    insiderTargets.length > 0 ? fetchActivities(insiderTargets, null, false, errors) : Promise.resolve([]),
    whaleAddresses.length > 0 ? fetchActivities(whaleAddresses, whaleMinUsdMap, false, errors) : Promise.resolve([]),
    riskerTargets.length > 0 ? fetchActivities(riskerTargets, null, true, errors) : Promise.resolve([]),
  ]);

  const activities: TaggedActivity[] = [...insiderActivities, ...whaleActivities, ...riskerActivities]
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  // Clear duplicate log tracker for this poll cycle
  loggedDuplicates.clear();

  const validActivities: TaggedActivity[] = [];
  const seenKeys = new Set<string>();
  const tokenIds = new Set<string>();
  let copied = 0;

  for (const a of activities) {
    if (a.type !== "TRADE" || !a.asset || !a.side) continue;
    if (a.timestamp && a.timestamp * 1000 < botStartTime) continue;

    const key = tradeEventKey(a);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    seen.add(key);
    
    if ((a.size ?? 0) < 0.01) continue;

    validActivities.push(a);
    tokenIds.add(a.asset);
  }
  trimSeen();

  const marketInfoCache = new Map<string, { tickSize: string; negRisk: boolean } | null>();
  const marketPromises = Array.from(tokenIds).map(async (tokenId) => {
    const info = await getMarketInfo(tokenId);
    marketInfoCache.set(tokenId, info);
  });
  await Promise.all(marketPromises);

  const processActivity = async (a: TaggedActivity): Promise<boolean> => {
    const price = a.price ?? 0;
    const size = a.size ?? 0;
    const tokenId = a.asset!;
    const side = a.side!;
    const isWhale = a._whaleMinUsd !== null;
    const isRisker = a._isRisker;
    const userType = isWhale ? "Whale" : isRisker ? "Risker" : "Insider";
    const userAddr = a._sourceUser.slice(0, 10) + "...";
    const marketInfo = a.title ? ` [${a.title}${a.outcome ? ` - ${a.outcome}` : ""}]` : "";

    if (side === "SELL") {
      const pos = getPosition(tokenId, a._sourceUser);
      if (!pos) return false;
      if (failedSells.has(tokenId)) return false;

      console.log(`[exit] ${userType} (${userAddr}) is selling${marketInfo} — placing SELL for ${pos.ourSize} shares`);

      const market = marketInfoCache.get(tokenId) ?? await getMarketInfo(tokenId);
      if (!market) {
        errors.push(`Skip SELL: no orderbook for token ${tokenId.slice(0, 12)}...`);
        return false;
      }

      let sellSize = pos.ourSize;
      let sellResult = await placeMarketOrder(tokenId, "SELL", sellSize, market.tickSize, market.negRisk);

      if (sellResult.error && (sellResult.error.includes("not enough balance") || sellResult.error.includes("balance is not enough"))) {
        const available = extractAvailableShares(sellResult.error);
        if (available !== null && available > 0 && available < sellSize) {
          console.log(`[exit] Partial fill detected — retrying SELL with ${available} shares (had ${sellSize})`);
          sellSize = available;
          sellResult = await placeMarketOrder(tokenId, "SELL", sellSize, market.tickSize, market.negRisk);
        }
      }

      if (sellResult.error) {
        failedSells.add(tokenId);
        errors.push(`${tokenId} SELL (exit): ${sellResult.error}`);
        const failMsg = [
          `⚠️ Could not exit position`,
          `${userType} (${userAddr}) sold${marketInfo}`,
          `Failed to sell ${sellSize} shares @ $${price} ($${(sellSize * price).toFixed(2)})`,
          `Please exit manually on Polymarket.`,
        ].join("\n");
        await sendPushoverNotification("Polymarket Bot SELL Failed", failMsg, 1);
        return false;
      } else {
        failedSells.delete(tokenId);
        removePosition(tokenId, a._sourceUser);
        const msg = `${userType} (${userAddr}) cashed out\nSELL ${sellSize} @ $${price} ($${(sellSize * price).toFixed(2)})${marketInfo}`;
        console.log(`Exited: ${msg}`);
        await sendPushoverNotification("Polymarket Bot Position Exited", msg, 1);
        return true;
      }
    }

    if (isWhale) {
      const tradeUsd = (a.usdcSize != null && a.usdcSize > 0) ? a.usdcSize : size * price;
      const minUsd = a._whaleMinUsd!;
      if (tradeUsd < minUsd) {
        console.log(`[whale:${a._sourceUser.slice(0, 10)}] Skipping: $${tradeUsd.toFixed(2)} < min $${minUsd}`);
        return false;
      }
      console.log(`[whale:${a._sourceUser.slice(0, 10)}] Qualifying: $${tradeUsd.toFixed(2)} >= $${minUsd}`);
    }

    if (isRisker) {
      if (price > config.maxPrice) {
        console.log(`[risker:${a._sourceUser.slice(0, 10)}] Skipping: price ${price} > max ${config.maxPrice}`);
        return false;
      }
      console.log(`[risker:${a._sourceUser.slice(0, 10)}] Qualifying: price ${price} <= max ${config.maxPrice}`);
    }

    if (seenAssets.has(tokenId)) {
      // Only log once per token per poll cycle to reduce spam
      const dupKey = `dup:${tokenId}`;
      if (!loggedDuplicates.has(dupKey)) {
        console.log(`Blocked Duplicate: ${tokenId.slice(0, 10)}${marketInfo}. Skipping.`);
        loggedDuplicates.add(dupKey);
      }
      return false;
    }

    // For Insiders: if we already have a position from this Insider on this token, skip
    // (Prevents stacking up multiple positions from same Insider at different prices)
    if (userType === "Insider" && hasAnyPositionForSource(tokenId, a._sourceUser)) {
      console.log(`[insider:${userAddr}] Already have position from this Insider. Skipping.`);
      return false;
    }

    const orderSize = applySizeLimit(size, price);
    const market = marketInfoCache.get(tokenId) ?? await getMarketInfo(tokenId);
    if (!market) {
      errors.push(`Skip: no orderbook for token ${tokenId.slice(0, 12)}...`);
      return false;
    }

    // Add to seenAssets NOW to prevent duplicates within this batch
    seenAssets.add(tokenId);

    const result = await placeMarketOrder(tokenId, "BUY", orderSize, market.tickSize, market.negRisk);
    if (result.error) {
      // Remove from seenAssets so can retry on next poll (except balance errors which are retryable)
      const isBalanceError = result.error.includes("not enough balance") || result.error.includes("balance is not enough");
      if (!isBalanceError) {
        seenAssets.delete(tokenId);
      }
      errors.push(`${tokenId} BUY: ${result.error}`);
      if (result.error.includes("not enough balance") || result.error.includes("balance is not enough")) {
        const lastAlert = balanceErrorCooldown.get(tokenId) ?? 0;
        const now = Date.now();
        
        if (now - lastAlert > BALANCE_ALERT_COOLDOWN_MS) {
          balanceErrorCooldown.set(tokenId, now);
          const failMsg = [
            `⚠️ Insufficient Balance to BUY`,
            `${userType} (${userAddr}) traded${marketInfo}`,
            `Wanted: ${orderSize} shares ($${(orderSize * price).toFixed(2)})`,
            `Error: ${result.error.split(":").pop()?.trim()}`
          ].join("\n");
          console.warn(`[buy-fail] ${failMsg.replace(/\n/g, " | ")}`);
          await sendPushoverNotification("Polymarket Bot BUY Failed", failMsg, 1);
        } else {
          console.warn(`[buy-fail] ${tokenId.slice(0, 12)}... skipped (balance error, under cooldown)`);
        }
      }
      return false;
    }

    addPosition({
      tokenId,
      sourceUser: a._sourceUser,
      ourSize: orderSize,
      price: price,
      marketTitle: a.title,
      outcome: a.outcome,
      boughtAt: Date.now(),
    });
    
    const msgPrefix = userType === "Insider" ? "⭐ " : "";
    const msg = `${msgPrefix}${userType} (${userAddr})\nBUY ${orderSize} @ market ($${(orderSize * price).toFixed(2)})${marketInfo}`;
    console.log(`Copied: ${msg}`);
    await sendPushoverNotification("Polymarket Bot Trade Executed", msg, 1);
    return true;
  };

  const BATCH_SIZE = 10;
  for (let i = 0; i < validActivities.length; i += BATCH_SIZE) {
    const batch = validActivities.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(processActivity));
    copied += results.filter(r => r).length;
  }

  if (copied > 0 || errors.length > 0) {
    console.log(
      `[copy-engine] poll: ${activities.length} activities (${insiderActivities.length} insider / ${whaleActivities.length} whale / ${riskerActivities.length} risker), ${copied} copied, ${errors.length} errors`
    );
  }

  return { fetched: activities.length, copied, errors };
}
