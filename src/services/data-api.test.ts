import test from "node:test";
import assert from "node:assert";
import { buildActivityUrl } from "./data-api.js";

test("buildActivityUrl constructs correct API endpoints", () => {
  const base = "https://data-api.polymarket.com";
  
  // Test basic
  const url1 = buildActivityUrl(base, { user: "0xTest" });
  assert.ok(url1.includes("user=0xTest"));
  assert.ok(url1.includes("limit=100"));
  assert.ok(url1.includes("offset=0"));

  // Test type array
  const url2 = buildActivityUrl(base, { user: "0xTest", type: ["TRADE", "REDEEM"] });
  assert.ok(url2.includes("type=TRADE%2CREDEEM") || url2.includes("type=TRADE,REDEEM"));

  // Test limit over max
  const url3 = buildActivityUrl(base, { user: "0xTest", limit: 1000 });
  assert.ok(url3.includes("limit=500")); // capped at max limit
});
