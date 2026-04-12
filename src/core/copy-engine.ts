import { getActivity, tradeEventKey } from "../services/data-api.js";
import { getTickSize, placeLimitOrder } from "../services/clob.js";
import { config } from "../config/index.js";
import { getCopyTargets } from "../utils/target.js";
import { sendPushoverNotification } from "../services/pushover.js";

const SEEN_CAP = 10_000;
const seen = new Set<string>();
const seenAssets = new Set<string>();
const botStartTime = Date.now();

function trimSeen(): void {
  if (seen.size <= SEEN_CAP) return;
  const arr = [...seen];
  for (let i = 0; i < arr.length - SEEN_CAP; i++) seen.delete(arr[i]!);

  if (seenAssets.size > SEEN_CAP) {
    const assetsArr = [...seenAssets];
    for (let i = 0; i < assetsArr.length - SEEN_CAP; i++) seenAssets.delete(assetsArr[i]!);
  }
}

export function calculateDynamicSize(size: number, price: number, dynamicAmount: boolean, maxOrderUsd: number | null, sizeMultiplier: number): number {
  if (dynamicAmount && maxOrderUsd != null && maxOrderUsd > 10 && price > 0) {
    const tradeUsd = size * price;
    let targetUsd = tradeUsd * sizeMultiplier; // Base multiplied value
    if (targetUsd > 10) {
      // Option A: Copied_USD = 10 + (Max - 10) * (1 - 10 / V)
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

export async function pollAndCopy(): Promise<{
  fetched: number;
  copied: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const activeTargets = getCopyTargets().length > 0 ? getCopyTargets() : config.targetUsers;
  if (activeTargets.length === 0) return { fetched: 0, copied: 0, errors: ["No target users"] };

  const allActivitiesPromises = activeTargets.map(user =>
    getActivity(config.dataApiUrl, {
      user,
      limit: config.activityLimit,
      offset: 0,
      type: config.copyTradesOnly ? "TRADE" : undefined,
      sortBy: "TIMESTAMP",
      sortDirection: "DESC",
    }).catch(e => {
      errors.push(`Failed to fetch for ${user}: ${e instanceof Error ? e.message : e}`);
      return [];
    })
  );

  const activitiesArrays = await Promise.all(allActivitiesPromises);
  const activities = activitiesArrays.flat().sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

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

    // Filter by maximum price (e.g., only take unlikely bets that pay out more)
    if (config.maxPrice < 1.0 && price > config.maxPrice) {
      console.log(`Skipping: Price ${price} exceeds COPY_MAX_PRICE (${config.maxPrice})`);
      continue;
    }

    const tokenId = a.asset;
    const side = a.side;

    if (config.preventDuplicateAssets && seenAssets.has(tokenId)) {
      const marketInfo = a.title ? ` [${a.title}${a.outcome ? ` - ${a.outcome}` : ""}]` : "";
      console.log(`Blocked Duplicate: Multiple targets bought token: ${tokenId.slice(0, 10)}${marketInfo}. Skipping.`);
      continue;
    }

    const orderSize = applySizeLimit(size, price);

    let tickSize: string | null = null;
    try {
      tickSize = await getTickSize(tokenId);
    } catch (e) {
      errors.push(`tick ${tokenId}: ${e instanceof Error ? e.message : e}`);
    }
    if (tickSize === null) {
      errors.push(`Skip: no orderbook for token ${tokenId.slice(0, 12)}... (market may be closed or resolved)`);
      continue;
    }

    const result = await placeLimitOrder(tokenId, side, price, orderSize, tickSize, false);
    if (result.error) {
      errors.push(`${tokenId} ${side}: ${result.error}`);
    } else {
      if (config.preventDuplicateAssets) seenAssets.add(tokenId);

      const marketInfo = a.title ? ` [${a.title}${a.outcome ? ` - ${a.outcome}` : ""}]` : "";
      const msg = `Copied: ${side} ${orderSize} @ ${price}${marketInfo}`;
      console.log(msg);
      await sendPushoverNotification("Polymarket Bot Trade Executed", msg, 1);
      copied++;
    }
  }

  if (activities.length > 0) {
    console.log(
      `[copy-engine] poll: ${activities.length} activities, ${copied} copied, ${errors.length} errors`
    );
  }

  return { fetched: activities.length, copied, errors };
}
