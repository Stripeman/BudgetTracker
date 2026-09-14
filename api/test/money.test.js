'use strict';
// Money arithmetic with independently computed expected values.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const money = require('../_shared/money');

test('currency precision comes from ISO 4217, not from input', () => {
  assert.equal(money.precisionOf('EUR'), 2);
  assert.equal(money.precisionOf('JPY'), 0);
  assert.equal(money.precisionOf('KWD'), 3);
  assert.throws(() => money.precisionOf('ZZZ'), /not supported/);
  assert.throws(() => money.precisionOf(['EUR']), /not supported/, 'no regex coercion of arrays');
});

test('decimal parsing refuses excess precision, garbage and out-of-range values', () => {
  assert.equal(money.parseDecimal('12.30', 'EUR'), 1230);
  assert.equal(money.parseDecimal('-0.00', 'EUR'), 0);
  assert.ok(!Object.is(money.parseDecimal('-0.00', 'EUR'), -0));
  assert.equal(money.parseDecimal('100', 'JPY'), 100);
  assert.equal(money.parseDecimal('1.234', 'KWD'), 1234);
  for (const bad of ['100.5', '1e3', ' ', 'abc', '12.3.4']) assert.throws(() => money.parseDecimal(bad, 'JPY'));
  assert.throws(() => money.parseDecimal('12.345', 'EUR'), /more decimal places/);
  assert.throws(() => money.parseDecimal('99999999999999999', 'EUR'));
  assert.throws(() => money.parseDecimal(12.3, 'EUR'), /decimal string/);
  assert.equal(money.isMinor(-0), false);
});

test('formatting round-trips', () => {
  assert.equal(money.toDecimal(-5, 'EUR'), '-0.05');
  assert.equal(money.toDecimal(123456, 'JPY'), '123456');
  assert.equal(money.toDecimal(1, 'KWD'), '0.001');
});

test('allocation is exact, deterministic and conserves the total', () => {
  assert.deepEqual(money.allocate(1000, [1, 1, 1]), [334, 333, 333]);
  assert.deepEqual(money.allocate(-100, [1, 1, 1]), [-34, -33, -33]);
  assert.deepEqual(money.allocate(10, [0, 5, 5]), [0, 5, 5]);
  // 30000 split 25% / 75% (basis points) = 7500 / 22500 — the EUR 300 dinner, EUR 75 share.
  assert.deepEqual(money.allocate(30000, [2500, 7500]), [7500, 22500]);
  // 100 into weights 1:2:3 → exact 16.67/33.33/50 → floors 16/33/50 → remainder 1 to largest fraction (index 0, .67).
  assert.deepEqual(money.allocate(100, [1, 2, 3]), [17, 33, 50]);
  for (const [total, w] of [[99999, [3, 7, 11, 13]], [-12345, [1, 1]], [1, [1, 1, 1]]]) {
    assert.equal(money.allocate(total, w).reduce((a, b) => a + b, 0), total);
  }
  assert.throws(() => money.allocate(100, [0, 0]));
  assert.throws(() => money.allocate(100, [1.5]));
});

test('conversion uses exact rational arithmetic with half-even rounding', () => {
  // EUR 100.00 at 161.235 JPY/EUR = 16123.5 JPY → half-even → 16124.
  assert.equal(money.convert(10000, 'EUR', 'JPY', '161.235'), 16124);
  // USD 1.00 at 0.925 = EUR 0.925 → 92.5 cents → half-even → 92.
  assert.equal(money.convert(100, 'USD', 'EUR', '0.925'), 92);
  // USD 1.01 at 0.925 = 0.93425 → 93 cents.
  assert.equal(money.convert(101, 'USD', 'EUR', '0.925'), 93);
  // JPY 1000 at 0.0062 = EUR 6.20.
  assert.equal(money.convert(1000, 'JPY', 'EUR', '0.0062'), 620);
  assert.throws(() => money.convert(100, 'EUR', 'USD', '0'));
  assert.throws(() => money.convert(100, 'EUR', 'USD', '-1.1'));
});
