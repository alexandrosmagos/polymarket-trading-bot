import * as fs from "node:fs";
import * as path from "node:path";

const POSITIONS_FILE = path.resolve(process.cwd(), "positions.json");

export interface Position {
  tokenId: string;
  /** The target address whose BUY triggered our copy */
  sourceUser: string;
  /** The size we actually placed (in shares) */
  ourSize: number;
  /** Price at which we bought */
  price: number;
  marketTitle?: string;
  outcome?: string;
  boughtAt: number; // Unix ms
}

let positions: Position[] = [];

export function loadPositions(): void {
  try {
    if (fs.existsSync(POSITIONS_FILE)) {
      const raw = fs.readFileSync(POSITIONS_FILE, "utf-8");
      positions = JSON.parse(raw) as Position[];
      console.log(`[positions] Loaded ${positions.length} open position(s) from ${POSITIONS_FILE}`);
    }
  } catch (e) {
    console.error("[positions] Failed to load positions file, starting fresh:", e);
    positions = [];
  }
}

function savePositions(): void {
  try {
    fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions, null, 2), "utf-8");
  } catch (e) {
    console.error("[positions] Failed to save positions file:", e);
  }
}

/** Record a position after a successful BUY copy */
export function addPosition(pos: Position): void {
  // Deduplicate just in case
  positions = positions.filter(p => !(p.tokenId === pos.tokenId && p.sourceUser === pos.sourceUser));
  positions.push(pos);
  savePositions();
}

/**
 * Find a tracked position for a given (tokenId, sourceUser) pair.
 * Returns the position if found, or null.
 */
export function getPosition(tokenId: string, sourceUser: string): Position | null {
  return positions.find(p => p.tokenId === tokenId && p.sourceUser === sourceUser) ?? null;
}

/** Remove a position after a successful SELL */
export function removePosition(tokenId: string, sourceUser: string): void {
  positions = positions.filter(p => !(p.tokenId === tokenId && p.sourceUser === sourceUser));
  savePositions();
}

/** Check if any position exists for this tokenId (regardless of sourceUser) */
export function hasAnyPosition(tokenId: string): boolean {
  return positions.some(p => p.tokenId === tokenId);
}

/** All tokenIds currently in tracked positions */
export function getAllTrackedTokenIds(): string[] {
  return positions.map(p => p.tokenId);
}

export function getAllPositions(): Position[] {
  return [...positions];
}
