import { getActivity, tradeEventKey, Activity } from "../services/data-api.js";
import { getTickSize, placeLimitOrder } from "../services/clob.js";
import { config } from "../config/index.js";
import { getCopyTargets, getWhaleTargets } from "../utils/target.js";
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
      const marketInfo = a.title ? ` [${a.title}${a.outcome ? ` - ${a.outcome}` : ""}]` : "";
      console.log(`Blocked Duplicate: ${tokenId.slice(0, 10)}${marketInfo}. Skipping.`);
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
      seenAssets.add(tokenId);

      const isWhale = a._whaleMinUsd !== null;
      const userType = isWhale ? "Whale" : "Insider";
      const userAddr = a._sourceUser.slice(0, 10) + "...";
      const marketInfo = a.title ? ` [${a.title}${a.outcome ? ` - ${a.outcome}` : ""}]` : "";
      const msg = `${userType} (${userAddr})\n${side} ${orderSize} @ ${price}${marketInfo}`;
      console.log(`Copied: ${msg}`);
      await sendPushoverNotification("Polymarket Bot Trade Executed", msg, 1);
      copied++;
    }
  }

  if (activities.length > 0) {
    console.log(
      `[copy-engine] poll: ${activities.length} activities (${insiderActivities.length} insider / ${whaleActivities.length} whale), ${copied} copied, ${errors.length} errors`
    );
  }

  return { fetched: activities.length, copied, errors };
}
