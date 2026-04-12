import test from "node:test";
import assert from "node:assert";

test("config targets parses correctly", () => {
  // Test simple split
  const input1 = "0xA,0xB, 0xC  ";
  const output1 = input1.split(",").map(i => i.trim()).filter(i => i.length > 0);
  assert.deepStrictEqual(output1, ["0xA", "0xB", "0xC"]);

  // Test empty
  const input2 = "  ,,  ";
  const output2 = input2.split(",").map(i => i.trim()).filter(i => i.length > 0);
  assert.deepStrictEqual(output2, []);
  
  // Test single
  const input3 = "0xSingleUser";
  const output3 = input3.split(",").map(i => i.trim()).filter(i => i.length > 0);
  assert.deepStrictEqual(output3, ["0xSingleUser"]);
});
