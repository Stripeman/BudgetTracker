'use strict';
// THE canonical money module. Amounts are integers in the currency's minor unit (cents, yen,
// fils). Binary floating point is never used for a balance. Precision comes from this ISO 4217
// table, never from a client or a stored record (review finding 4).
const { badRequest } = require('./http');

const PRECISION = new Map();
const ZERO = 'BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF';
const THREE = 'BHD IQD JOD KWD LYD OMR TND';
const FOUR = 'CLF UYW';
const TWO = 'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BMD BND BOB BRL BSD BTN BWP BYN BZD '
  + 'CAD CDF CHF CNY COP CRC CUP CVE CZK DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GTQ '
  + 'GYD HKD HNL HTG HUF IDR ILS INR IRR JMD KES KGS KHR KPW KYD KZT LAK LBP LKR LRD LSL MAD MDL MGA '
  + 'MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD PAB PEN PGK PHP PKR PLN QAR '
  + 'RON RSD RUB SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TOP TRY TTD '
  + 'TWD TZS UAH USD UYU UZS VES WST XCD YER ZAR ZMW ZWL';
for (const [codes, p] of [[ZERO, 0], [TWO, 2], [THREE, 3], [FOUR, 4]]) {
  for (const code of codes.split(' ')) PRECISION.set(code, p);
}

// Largest absolute minor amount accepted: well inside Number.MAX_SAFE_INTEGER so sums of many
// amounts stay exact, and far beyond any household's finances.
const MAX_MINOR = 1e15;

function isCurrency(code) {
  return typeof code === 'string' && PRECISION.has(code);
}

function precisionOf(code) {
  if (!isCurrency(code)) throw badRequest('That currency is not supported.', 'unsupported_currency');
  return PRECISION.get(code);
}

function isMinor(value) {
  return Number.isSafeInteger(value) && Math.abs(value) <= MAX_MINOR && !Object.is(value, -0);
}

function requireMinor(value, field = 'amount') {
  if (!isMinor(value)) throw badRequest(`${field} must be a whole number of minor units within range.`, 'invalid_amount');
  return value;
}

// Parses a user-facing decimal string ("-12.30") into minor units for `currency`. More
// decimals than the currency allows is an error, not a silent rounding.
function parseDecimal(text, currency, field = 'amount') {
  const p = precisionOf(currency);
  if (typeof text !== 'string') throw badRequest(`${field} must be a decimal string.`, 'invalid_amount');
  const m = /^(-)?(\d{1,16})(?:\.(\d+))?$/.exec(text.trim());
  if (!m) throw badRequest(`${field} is not a valid amount.`, 'invalid_amount');
  const decimals = m[3] || '';
  if (decimals.length > p) throw badRequest(`${field} has more decimal places than ${currency} allows (${p}).`, 'invalid_precision');
  const minor = Number(BigInt(m[2] + decimals.padEnd(p, '0')) * (m[1] ? -1n : 1n));
  const normalized = minor === 0 ? 0 : minor;
  return requireMinor(normalized, field);
}

// Internal arithmetic can produce -0 (negating a zero total); it is normalized here rather than
// rejected. Inputs from clients and storage are still validated strictly by requireMinor.
const normalizeZero = (v) => (v === 0 ? 0 : v);

function toDecimal(minor, currency) {
  minor = normalizeZero(minor);
  requireMinor(minor);
  const p = precisionOf(currency);
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(p + 1, '0');
  const whole = p ? digits.slice(0, -p) : digits;
  const frac = p ? `.${digits.slice(-p)}` : '';
  return `${negative ? '-' : ''}${whole}${frac}`;
}

// Accumulates exactly in BigInt and range-checks once, so the result never depends on the order
// of the inputs (financial review finding 12).
function sum(values) {
  let total = 0n;
  for (const v of values) total += BigInt(requireMinor(normalizeZero(v)));
  const n = Number(total);
  if (total > BigInt(MAX_MINOR) || total < -BigInt(MAX_MINOR)) throw badRequest('The total is out of range.', 'amount_overflow');
  return n === 0 ? 0 : n;
}

// Compares |minor| of `currency` with a user-supplied decimal filter value exactly, whatever the
// currency's precision (so "10.50" is a valid filter even when a JPY entry is present).
// Returns -1, 0 or 1.
function compareAbsToDecimal(minor, currency, text) {
  const m = typeof text === 'string' ? /^(\d{1,16})(?:\.(\d{1,12}))?$/.exec(text.trim()) : null;
  if (!m) throw badRequest('Amount filter is not a valid positive decimal.', 'invalid_amount');
  const frac = m[2] || '';
  const filter = BigInt(m[1] + frac);
  const left = BigInt(Math.abs(requireMinor(normalizeZero(minor)))) * 10n ** BigInt(frac.length);
  const right = filter * 10n ** BigInt(precisionOf(currency));
  return left === right ? 0 : left > right ? 1 : -1;
}

// Deterministic largest-remainder allocation. `weights` are non-negative integers (percent
// basis points, shares or fixed ratios). Residual minor units go to the largest fractional
// remainders, ties broken by lowest index, so the same input always yields the same split and
// the parts always sum exactly to the total. Negative totals (refunds) mirror positive ones.
function allocate(total, weights) {
  requireMinor(total, 'total');
  if (!Array.isArray(weights) || weights.length === 0 || weights.length > 500) throw badRequest('Allocation needs between 1 and 500 weights.', 'invalid_allocation');
  const w = weights.map((x) => {
    if (!Number.isSafeInteger(x) || x < 0) throw badRequest('Allocation weights must be non-negative whole numbers.', 'invalid_allocation');
    return BigInt(x);
  });
  const totalWeight = w.reduce((a, b) => a + b, 0n);
  if (totalWeight === 0n) throw badRequest('Allocation weights cannot all be zero.', 'invalid_allocation');
  const sign = total < 0 ? -1n : 1n;
  const abs = BigInt(Math.abs(total));
  const parts = w.map((x) => (abs * x) / totalWeight);
  const remainders = w.map((x, i) => ({ i, r: (abs * x) % totalWeight }));
  let left = abs - parts.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : (b.r > a.r ? 1 : -1)));
  for (let k = 0; left > 0n; k += 1, left -= 1n) parts[remainders[k % remainders.length].i] += 1n;
  return parts.map((p) => { const n = Number(p * sign); return n === 0 ? 0 : n; });
}

// Exchange rates are decimal strings: 1 unit of `from` = rate units of `to`.
const RATE_RE = /^(\d{1,12})(?:\.(\d{1,12}))?$/;
function parseRate(text) {
  if (typeof text !== 'string') throw badRequest('Rate must be a decimal string.', 'invalid_rate');
  const m = RATE_RE.exec(text.trim());
  if (!m) throw badRequest('Rate is not a valid positive decimal.', 'invalid_rate');
  const frac = m[2] || '';
  const num = BigInt(m[1] + frac);
  if (num === 0n) throw badRequest('Rate must be greater than zero.', 'invalid_rate');
  return { num, scale: 10n ** BigInt(frac.length), text: text.trim() };
}

// Round half to even on a BigInt ratio n/d.
function roundHalfEven(n, d) {
  const negative = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  let q = an / ad;
  const r = an % ad;
  if (r * 2n > ad || (r * 2n === ad && q % 2n === 1n)) q += 1n;
  return negative ? -q : q;
}

function convert(minor, from, to, rateText) {
  requireMinor(minor);
  const pf = precisionOf(from);
  const pt = precisionOf(to);
  const { num, scale } = parseRate(rateText);
  let n = BigInt(minor) * num;
  let d = scale;
  if (pt > pf) n *= 10n ** BigInt(pt - pf); else d *= 10n ** BigInt(pf - pt);
  const out = Number(roundHalfEven(n, d));
  return requireMinor(out === 0 ? 0 : out, 'converted amount');
}

module.exports = {
  MAX_MINOR, isCurrency, precisionOf, isMinor, requireMinor, parseDecimal, toDecimal, sum, compareAbsToDecimal,
  allocate, parseRate, convert, roundHalfEven, currencies: () => [...PRECISION.keys()].sort(),
};
