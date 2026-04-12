import test from "node:test";
import assert from "node:assert";
import { calculateDynamicSize } from "./copy-engine.js";

test("calculateDynamicSize - scales based on Option A correctly", () => {
  const dynamicAmount = true;
  const maxOrderUsd = 100;
  const multiplier = 1;
  const price = 0.50; // $0.50 per share

  // Test 1: $10 trade is untouched -> total target = 10, price = 0.50 -> 20 shares
  const limit1 = calculateDynamicSize(20, price, dynamicAmount, maxOrderUsd, multiplier);
  assert.strictEqual(limit1, 20); // shares

  // Test 2: $100 trade scales up using Option A formula
  // Copied_USD = 10 + 90 * (1 - 10 / 100) = 10 + 90 * 0.9 = 10 + 81 = 91
  // Final size = 91 / 0.50 = 182 shares
  const limit2 = calculateDynamicSize(200, price, dynamicAmount, maxOrderUsd, multiplier);
  assert.strictEqual(limit2, 182);

  // Test 3: $10000 trade scales up using Option A formula (approaches 100)
  // Copied_USD = 10 + 90 * (1 - 10/10000) = 10 + 90 * 0.999 = 10 + 89.91 = 99.91
  // Final size = 99.91 / 0.50 = 199.82 shares
  const limit3 = calculateDynamicSize(20000, price, dynamicAmount, maxOrderUsd, multiplier);
  assert.strictEqual(limit3, 199.82);

  // Test 4: Dynamic False acts like simple limit
  const limit4 = calculateDynamicSize(500, price, false, maxOrderUsd, multiplier);
  // Total notional 500 * 0.5 = 250 > 100. Capped to 100 USD -> 200 shares
  assert.strictEqual(limit4, 200);
});
