import test from "node:test";
import assert from "node:assert";
import { roundToTick, extractAvailableShares } from "./copy-engine.js";

test("roundToTick - handles rounding and CLOB bounds", () => {
  const tickSize = "0.001";
  
  // Normal rounding (0.5744 -> 0.574)
  assert.strictEqual(roundToTick(0.5744, tickSize), 0.574);
  
  // Round up (0.5746 -> 0.575)
  assert.strictEqual(roundToTick(0.5746, tickSize), 0.575);
  
  // Lower clamp (one tick above zero)
  // Even if buffer pushes it very low, it should never be 0
  assert.strictEqual(roundToTick(0.0001, tickSize), 0.001);
  
  // Upper clamp (one tick below one)
  // Bidding 1.0 is invalid, must be 0.999
  assert.strictEqual(roundToTick(0.9999, tickSize), 0.999);
  
  // Handling different tick sizes (e.g. 0.01)
  assert.strictEqual(roundToTick(0.5744, "0.01"), 0.57);
});

test("extractAvailableShares - parses CLOB balance errors", () => {
  // Standard format
  const err1 = "the balance is not enough -> balance: 74705469, order amount: 91818090";
  assert.strictEqual(extractAvailableShares(err1), 74.705469);
  
  // Alternative format sometimes seen
  const err2 = "not enough balance: balance: 5000000";
  assert.strictEqual(extractAvailableShares(err2), 5);
  
  // Junk error - should fail gracefully
  assert.strictEqual(extractAvailableShares("Internal Server Error"), null);
  
  // Zero balance - should return null so we don't try to trade 0 shares
  assert.strictEqual(extractAvailableShares("balance: 0"), null);
});
