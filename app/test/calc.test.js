// BT-006 inline calculator: exact decimal arithmetic, currency precision, half-even rounding,
// and refusal of anything that is not a plain arithmetic expression.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAmount, isPlainAmount } from "../js/core/calc.js";

test("adds and subtracts exactly (no binary floating point)", () => {
  assert.equal(evaluateAmount("0.1+0.2"), "0.30");
  assert.equal(evaluateAmount("12.50 + 3.20 - 0.70"), "15.00");
  assert.equal(evaluateAmount("100-100.01"), "-0.01");
});

test("multiplies and divides with half-even rounding to the currency precision", () => {
  assert.equal(evaluateAmount("10/3"), "3.33");
  assert.equal(evaluateAmount("2*1.005"), "2.01");
  assert.equal(evaluateAmount("0.125*1"), "0.12", "half to even");
  assert.equal(evaluateAmount("0.135*1"), "0.14", "half to even");
  assert.equal(evaluateAmount("300*25/100"), "75.00", "the EUR 300 dinner, 25% share");
  assert.equal(evaluateAmount("(12+8)*3"), "60.00");
});

test("respects zero- and three-decimal currencies", () => {
  assert.equal(evaluateAmount("1000/3", 0), "333");
  assert.equal(evaluateAmount("1.2345+1", 3), "2.234", "1.2345 rounds half-even to 1.234");
});

test("refuses anything that is not arithmetic", () => {
  for (const bad of ["", "abc", "1+", "2**3", "alert(1)", "1/0", "(1+2", "1e3", "12,50"]) assert.equal(evaluateAmount(bad), null, bad);
  assert.equal(isPlainAmount("12.50"), true);
  assert.equal(isPlainAmount("12.50+1"), false);
});
