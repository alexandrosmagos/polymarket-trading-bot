/**
 * Syncs the bot's own account positions against the tracked targets.
 * On startup / verify, this reads the bot's own BUY activity and matches each
 * token to whichever target made the same BUY within a time window, then
 * writes new position records to positions.json.
 */
import { getActivity } from "./data-api.js";
import { config } from "../config/index.js";
import { addPosition, hasAnyPosition, getAllTrackedTokenIds } from "./positions.js";
import { getCopyTargets, getWhaleTargets } from "../utils/target.js";

/** Max time difference (ms) between bot BUY and target BUY to be considered a match */
const MATCH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export interface SyncResult {
  /** Total distinct tokens found in own activity */
  totalFound: number;
  /** How many were newly added to positions.json (matched to a target) */
  newlyMatched: number;
  /** Tokens we hold but couldn't match to any tracked target */
  unmatched: { tokenId: string; marketTitle?: string }[];
  /** Tokens already in positions.json, skipped */
  alreadyTracked: number;
}

export async function syncAccountPositions(): Promise<SyncResult> {
  // 1. Fetch own BUY activity
  let ownBuys: Awaited<ReturnType<typeof getActivity>> = [];
  try {
    const activity = await getActivity(config.dataApiUrl, {
      user: config.funderAddress,
      limit: 500,
      offset: 0,
      type: "TRADE",
      sortBy: "TIMESTAMP",
      sortDirection: "DESC",
    });
    ownBuys = activity.filter(a => a.side === "BUY" && a.asset);
  } catch (e) {
    console.error("[sync] Failed to fetch own activity:", e instanceof Error ? e.message : e);
    return { totalFound: 0, newlyMatched: 0, unmatched: [], alreadyTracked: 0 };
  }

  // Deduplicate by tokenId (keep most recent)
  const uniqueBuysMap = new Map<string, typeof ownBuys[0]>();
  for (const b of ownBuys) {
    if (!b.asset) continue;
    if (!uniqueBuysMap.has(b.asset)) uniqueBuysMap.set(b.asset, b);
  }
  const uniqueBuys = [...uniqueBuysMap.values()];

  if (uniqueBuys.length === 0) {
    return { totalFound: 0, newlyMatched: 0, unmatched: [], alreadyTracked: 0 };
  }

  // 2. Fetch all target activities in parallel to build a lookup map
  const insiderTargets = getCopyTargets().length > 0 ? getCopyTargets() : config.targetUsers;
  const whaleEntries = getWhaleTargets().length > 0
    ? getWhaleTargets()
    : config.whaleUsers.map(w => ({ address: w.address, minUsd: w.minUsd }));
  const allTargets = [...new Set([...insiderTargets, ...whaleEntries.map(w => w.address)])];

  // tokenId → list of { sourceUser, timestamp }
  const targetBuyMap = new Map<string, { sourceUser: string; timestamp: number }[]>();

  await Promise.all(allTargets.map(async user => {
    try {
      const acts = await getActivity(config.dataApiUrl, {
        user,
        limit: 500,
        offset: 0,
        type: "TRADE",
        sortBy: "TIMESTAMP",
        sortDirection: "DESC",
      });
      for (const a of acts) {
        if (a.side === "BUY" && a.asset && a.timestamp) {
          if (!targetBuyMap.has(a.asset)) targetBuyMap.set(a.asset, []);
          targetBuyMap.get(a.asset)!.push({ sourceUser: user, timestamp: a.timestamp });
        }
      }
    } catch {
      // Non-fatal — skip this target
    }
  }));

  // 3. Match own buys to target users
  let newlyMatched = 0;
  let alreadyTracked = 0;
  const unmatched: { tokenId: string; marketTitle?: string }[] = [];

  for (const buy of uniqueBuys) {
    const tokenId = buy.asset!;

    if (hasAnyPosition(tokenId)) {
      alreadyTracked++;
      continue;
    }

    const buyTs = (buy.timestamp ?? 0) * 1000;
    const candidates = targetBuyMap.get(tokenId) ?? [];

    // Find the closest matching target buy within the time window
    const match = candidates
      .filter(c => Math.abs(c.timestamp * 1000 - buyTs) <= MATCH_WINDOW_MS)
      .sort((a, b) => Math.abs(a.timestamp * 1000 - buyTs) - Math.abs(b.timestamp * 1000 - buyTs))[0];

    if (match) {
      addPosition({
        tokenId,
        sourceUser: match.sourceUser,
        ourSize: buy.size ?? 1,
        price: buy.price ?? 0,
        marketTitle: buy.title,
        outcome: buy.outcome,
        boughtAt: buyTs,
      });
      newlyMatched++;
    } else {
      unmatched.push({ tokenId, marketTitle: buy.title });
    }
  }

  return {
    totalFound: uniqueBuys.length,
    newlyMatched,
    unmatched,
    alreadyTracked,
  };
}
