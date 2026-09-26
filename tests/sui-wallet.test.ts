import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCoinAmount, formatCoinAmount } from "../src/lib/sui/amount";
test("Sui payment amounts preserve exact base units", () => {
  assert.equal(parseCoinAmount("0.000000001", 9), 1n);
  assert.equal(parseCoinAmount("1.000001", 6), 1000001n);
  assert.equal(
    parseCoinAmount("18446744073.709551615", 9),
    18446744073709551615n,
  );
  assert.equal(formatCoinAmount("1000000001", 9), "1.000000001");
  assert.equal(formatCoinAmount("0", 6), "0");
});
test("Sui payment amounts reject rounding, negative, scientific notation and overflow", () => {
  for (const value of [
    "0",
    "-1",
    "NaN",
    "1e3",
    "Infinity",
    "1.0000000001",
    "18446744073.709551616",
    "1,000",
    "",
  ]) {
    assert.throws(() => parseCoinAmount(value, 9));
  }
  assert.throws(() => parseCoinAmount("0.0000001", 6));
});
