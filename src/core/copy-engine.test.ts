import test from "node:test";
import assert from "node:assert";
import { calculateDynamicSize, applySizeLimit } from "./copy-engine.js";

test("calculateDynamicSize - scales logarithmically from $100 to $100k", () => {
  const dynamicAmount = true;
  const minOrderUsd = 2;
  const maxOrderUsd = 10;
  const price = 0.50; // $0.50 per share

  // Test 1: $100 trade (the lower bound) -> returns minOrderUsd ($2)
  // total target = 100, score = 0, targetUsd = 2 -> 4 shares
  const limit1 = calculateDynamicSize(200, price, dynamicAmount, minOrderUsd, maxOrderUsd);
  assert.strictEqual(limit1, 4);

  // Test 2: $100,000 trade (the upper bound) -> returns maxOrderUsd ($10)
  // score = 1, targetUsd = 10 -> 20 shares
  const limit2 = calculateDynamicSize(200000, price, dynamicAmount, minOrderUsd, maxOrderUsd);
  assert.strictEqual(limit2, 20);

  // Test 3: $3,162 trade (midpoint on log scale: log10=3.5)
  // score = (3.5 - 2) / 3 = 0.5
  // targetUsd = 2 + 0.5 * (10 - 2) = 6
  // shares = 6 / 0.5 = 12
  const limit3 = calculateDynamicSize(6324, price, dynamicAmount, minOrderUsd, maxOrderUsd);
  assert.strictEqual(limit3, 12);

  // Test 4: Dynamic False acts like simple limit (capped at maxOrderUsd)
  const limit4 = calculateDynamicSize(500, price, false, minOrderUsd, maxOrderUsd);
  // Total notional 500 * 0.5 = 250 > 10 (max). Capped to 10 USD -> 20 shares
  assert.strictEqual(limit4, 20);
});

test("calculateDynamicSize - handles edge cases", () => {
  const minOrderUsd = 1;
  const maxOrderUsd = 5;
  const price = 0.50;

  // Below $100 baseline - uses minOrderUsd
  const below = calculateDynamicSize(50, price, true, minOrderUsd, maxOrderUsd);
  assert.strictEqual(below, 2); // $1 / $0.50 = 2 shares

  // Zero price - should not crash
  const zeroPrice = calculateDynamicSize(100, 0, true, minOrderUsd, maxOrderUsd);
  assert.ok(zeroPrice >= 0);

  // Null maxOrderUsd - no cap
  const noCap = calculateDynamicSize(1000, price, true, minOrderUsd, null);
  assert.ok(noCap > 0);
});

test("applySizeLimit - uses config values", () => {
  const size = 100;
  const price = 0.50;
  
  const result = applySizeLimit(size, price);
  assert.ok(result > 0);
});