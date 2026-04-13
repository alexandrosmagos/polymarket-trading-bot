import test from "node:test";
import assert from "node:assert";
import { isProxyAddress, normalizeUsername } from "./resolve.js";

test("isProxyAddress - validates 0x addresses", () => {
  assert.strictEqual(isProxyAddress("0xABCDEF"), false);
  assert.strictEqual(isProxyAddress("not an address"), false);
  assert.strictEqual(isProxyAddress(""), false);
});

test("normalizeUsername - handles @ prefix and trimming", () => {
  assert.strictEqual(normalizeUsername("testuser"), "testuser");
  assert.strictEqual(normalizeUsername("@testuser"), "testuser");
  assert.strictEqual(normalizeUsername("  @testuser  "), "testuser");
  assert.strictEqual(normalizeUsername(""), null);
  assert.strictEqual(normalizeUsername("   "), null);
  assert.strictEqual(normalizeUsername(undefined as unknown as string), null);
});