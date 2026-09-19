// Shared-expense allocation for the Add expense dialog's live preview (BT-009). A faithful mirror of
// api/_shared/groups.js and api/_shared/money.js: integer minor units computed in BigInt, largest
// remainder with ties to the first listed person, percentages to 4 decimal places that must make
// exactly 100, fixed amounts that must make exactly the total. DOM-free. The server recomputes
// everything and is authoritative; app/test/group.test.js keeps the two identical on generated cases.

const ZERO = new Set("BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF".split(" "));
const THREE = new Set("BHD IQD JOD KWD LYD OMR TND".split(" "));
const FOUR = new Set(["CLF", "UYW"]);
export function precisionOf(currency) {
  return ZERO.has(currency) ? 0 : THREE.has(currency) ? 3 : FOUR.has(currency) ? 4 : 2;
}

// The largest amount one shared expense may have, as on the server.
export const MAX_GROUP_MINOR = 1e10;
export const MAX_SHARES = 1000;
const PERCENT_UNIT = 10000;
export const HUNDRED_PERCENT = 100 * PERCENT_UNIT;

// A positive decimal string in the currency's precision, as minor units; null when it is not one.
export function parseAmount(text, currency) {
  const m = /^(\d{1,16})(?:\.(\d+))?$/.exec(String(text ?? "").trim());
  if (!m) return null;
  const decimals = m[2] || "";
  const p = precisionOf(currency);
  if (decimals.length > p) return null;
  const minor = Number(BigInt(m[1] + decimals.padEnd(p, "0")));
  return Number.isSafeInteger(minor) ? minor : null;
}

// api/_shared/money.js's parseRate/convert, mirrored for the Add/correct shared-expense
// dialog's own live preview of the reporting-currency equivalent while entering a foreign-
// currency amount (BT-009-13). The server recomputes the real conversion and is authoritative;
// this exists only so the payer/split fields (always in the reporting currency) can show a
// preview total before the person saves. Same round-half-even BigInt algorithm as the server so
// the preview and the saved result agree in every case exercised by the shared test cases.
export function parseRate(text) {
  const m = /^(\d{1,12})(?:\.(\d{1,12}))?$/.exec(String(text ?? "").trim());
  if (!m) return null;
  const frac = m[2] || "";
  const num = BigInt(m[1] + frac);
  if (num === 0n) return null;
  return { num, scale: 10n ** BigInt(frac.length) };
}
function roundHalfEven(n, d) {
  const negative = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  let q = an / ad;
  const r = an % ad;
  if (r * 2n > ad || (r * 2n === ad && q % 2n === 1n)) q += 1n;
  return negative ? -q : q;
}
export function convert(minor, from, to, rateText) {
  const rate = parseRate(rateText);
  if (rate === null || !Number.isSafeInteger(minor)) return null;
  const pf = precisionOf(from);
  const pt = precisionOf(to);
  let n = BigInt(minor) * rate.num;
  let d = rate.scale;
  if (pt > pf) n *= 10n ** BigInt(pt - pf); else d *= 10n ** BigInt(pf - pt);
  const out = Number(roundHalfEven(n, d));
  return Number.isSafeInteger(out) ? (out === 0 ? 0 : out) : null;
}

export function formatMinor(minor, currency) {
  const p = precisionOf(currency);
  const digits = String(Math.abs(minor)).padStart(p + 1, "0");
  return `${minor < 0 ? "-" : ""}${p ? `${digits.slice(0, -p)}.${digits.slice(-p)}` : digits}`;
}

// money.allocate: exact, deterministic, ties to the lowest index.
export function allocate(total, weights) {
  const w = weights.map((x) => BigInt(x));
  const totalWeight = w.reduce((a, b) => a + b, 0n);
  const abs = BigInt(Math.abs(total));
  const parts = w.map((x) => (abs * x) / totalWeight);
  const remainders = w.map((x, i) => ({ i, r: (abs * x) % totalWeight }));
  let left = abs - parts.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : (b.r > a.r ? 1 : -1)));
  for (let k = 0; left > 0n; k += 1, left -= 1n) parts[remainders[k % remainders.length].i] += 1n;
  const sign = total < 0 ? -1n : 1n;
  return parts.map((part) => { const n = Number(part * sign); return n === 0 ? 0 : n; });
}

export function percentUnits(text) {
  const m = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(String(text ?? "").trim());
  if (!m) return null;
  const units = Number(m[1]) * PERCENT_UNIT + Number((m[2] || "").padEnd(4, "0"));
  return units > 0 && units <= HUNDRED_PERCENT ? units : null;
}

export function percentText(units) {
  const frac = String(units % PERCENT_UNIT).padStart(4, "0").replace(/0+$/, "");
  return `${Math.floor(units / PERCENT_UNIT)}${frac ? `.${frac}` : ""}`;
}

// groups.computeShares. `split.lines[].value`: null (equal, or a "fixed-remainder" line sharing
// the remainder), whole shares, a percentage string, or minor units (amounts, or a
// "fixed-remainder" line's own fixed amount).
export function computeShares(totalMinor, split) {
  if (split.method === "amounts") {
    return { shares: split.lines.map((l) => ({ ref: l.ref, amountMinor: l.value, adjustmentMinor: 0 })), residualMinor: 0 };
  }
  // BT-009-25: a fixed line keeps its own exact amount; a line with no value shares whatever is
  // left, equally, via the same deterministic largest-remainder allocation as every other method.
  if (split.method === "fixed-remainder") {
    const fixedTotal = sumOf(split.lines.filter((l) => l.value !== null).map((l) => l.value));
    const remainderTotal = totalMinor - fixedTotal;
    const remainderCount = split.lines.filter((l) => l.value === null).length;
    const remainderParts = remainderCount ? allocate(remainderTotal, split.lines.filter((l) => l.value === null).map(() => 1)) : [];
    const remainderFloor = remainderCount ? Math.floor(remainderTotal / remainderCount) : 0;
    let ri = 0;
    return {
      shares: split.lines.map((l) => {
        if (l.value !== null) return { ref: l.ref, amountMinor: l.value, adjustmentMinor: 0 };
        const amountMinor = remainderParts[ri];
        const adjustmentMinor = amountMinor - remainderFloor;
        ri += 1;
        return { ref: l.ref, amountMinor, adjustmentMinor };
      }),
      residualMinor: remainderTotal - remainderFloor * remainderCount,
    };
  }
  const weights = split.lines.map((l) => (split.method === "equal" ? 1 : split.method === "shares" ? l.value : percentUnits(l.value)));
  const parts = allocate(totalMinor, weights);
  const totalWeight = weights.reduce((a, b) => a + BigInt(b), 0n);
  const floors = weights.map((w) => Number((BigInt(totalMinor) * BigInt(w)) / totalWeight));
  return {
    shares: split.lines.map((l, i) => ({ ref: l.ref, amountMinor: parts[i], adjustmentMinor: parts[i] - floors[i] })),
    residualMinor: totalMinor - floors.reduce((a, b) => a + b, 0),
  };
}

const sumOf = (list) => list.reduce((a, b) => a + b, 0);

// Everything the dialog shows while the person types, with the server's wording for each problem:
//   { amount: "100.00", currency, method, lines: [{ ref, name, value: "33.33" | "2" | "" }],
//     payers: [{ ref, name, amount: "" | "40.00" }] }
// Returns { ok, totalMinor, shares, residualMinor, payers: [{ ref, amountMinor }], errors: [..] }.
export function previewSplit({ amount, currency, method, lines, payers }) {
  const errors = [];
  const out = { ok: false, totalMinor: null, shares: [], residualMinor: 0, payers: [], errors, leftMinor: 0 };
  const totalMinor = parseAmount(amount, currency);
  if (totalMinor === null || totalMinor <= 0) { errors.push("Enter the amount, for example 12.50 or 10+2.50."); return out; }
  if (totalMinor > MAX_GROUP_MINOR) { errors.push("That amount is larger than a shared expense can be."); return out; }
  out.totalMinor = totalMinor;
  const fmt = (m) => formatMinor(m, currency);

  // Who paid.
  if (!payers.length) errors.push("Choose who paid.");
  else if (payers.length === 1 && !String(payers[0].amount ?? "").trim()) out.payers = [{ ref: payers[0].ref, amountMinor: totalMinor }];
  else {
    const paid = payers.map((p) => ({ ref: p.ref, name: p.name, amountMinor: parseAmount(p.amount, currency) }));
    const bad = paid.find((p) => p.amountMinor === null || p.amountMinor <= 0);
    if (bad) errors.push(`Enter what ${bad.name} paid, more than zero.`);
    else {
      const sum = sumOf(paid.map((p) => p.amountMinor));
      if (sum !== totalMinor) errors.push(`The amounts paid add up to ${fmt(sum)} but the expense is ${fmt(totalMinor)}.`);
      out.payers = paid.map(({ ref, amountMinor }) => ({ ref, amountMinor }));
    }
  }

  // Who shared, and how.
  if (!lines.length) { errors.push("Choose at least one person to share the expense."); out.ok = false; return out; }
  let values;
  if (method === "equal") values = lines.map(() => null);
  else if (method === "shares") {
    values = lines.map((l) => (/^\d{1,4}$/.test(String(l.value ?? "").trim()) ? Number(String(l.value).trim()) : null));
    const i = values.findIndex((v) => v === null || v < 1 || v > MAX_SHARES);
    if (i >= 0) { errors.push(`${lines[i].name}: shares must be a whole number from 1 to ${MAX_SHARES}.`); values = null; }
  } else if (method === "percentages") {
    const units = lines.map((l) => percentUnits(l.value));
    const i = units.findIndex((u) => u === null);
    if (i >= 0) { errors.push(`${lines[i].name}: enter a percentage such as 33.33, more than 0 and at most 100.`); values = null; }
    else {
      const sum = sumOf(units);
      if (sum !== HUNDRED_PERCENT) {
        errors.push(`The percentages add up to ${percentText(sum)}%. They must add up to exactly 100%.`);
        values = null;
      } else values = units.map(percentText);
    }
  } else if (method === "fixed-remainder") {
    // A blank value shares the remainder; anything else must be a real amount more than zero.
    const minor = lines.map((l) => (String(l.value ?? "").trim() === "" ? null : parseAmount(l.value, currency)));
    const i = minor.findIndex((m, idx) => m === null && String(lines[idx].value ?? "").trim() !== "");
    if (i >= 0) { errors.push(`${lines[i].name}: enter an amount more than zero, or leave it blank to share the rest.`); values = null; }
    else {
      const fixedSum = sumOf(minor.filter((m) => m !== null));
      const remainderCount = minor.filter((m) => m === null).length;
      if (fixedSum > totalMinor) { errors.push(`The fixed amounts add up to ${fmt(fixedSum)}, more than the expense's ${fmt(totalMinor)}.`); values = null; }
      else if (!remainderCount && fixedSum !== totalMinor) { errors.push(`With no one left to share the remainder, the fixed amounts must add up to exactly ${fmt(totalMinor)}.`); values = null; }
      else values = minor;
    }
  } else {
    const minor = lines.map((l) => parseAmount(l.value, currency));
    const i = minor.findIndex((m) => m === null || m <= 0);
    if (i >= 0) { errors.push(`${lines[i].name}: enter an amount more than zero.`); values = null; }
    else {
      const sum = sumOf(minor);
      out.leftMinor = totalMinor - sum;
      if (sum !== totalMinor) {
        errors.push(`The amounts add up to ${fmt(sum)} but the expense is ${fmt(totalMinor)}.`);
        values = null;
      } else values = minor;
    }
  }
  if (values) {
    const r = computeShares(totalMinor, { method, lines: lines.map((l, i) => ({ ref: l.ref, value: values[i] })) });
    out.shares = r.shares;
    out.residualMinor = r.residualMinor;
  }
  out.ok = errors.length === 0;
  return out;
}

// BT-009-25: itemized receipt allocation — a faithful mirror of
// api/_shared/groups.js's `computeItemization`, for the live preview only; the server recomputes
// and validates everything and is authoritative (api/test/group-itemized.test.js keeps them
// identical on the same hand-computed worked example, docs/BT-009-25-WORKED-EXAMPLES.md §2).
// `itemLines`: [{ description, quantity, unitPrice: "12.00", refs: [ref,...] }]. `fees`:
// { tax, tip, discount, fee } as decimal strings (blank/undefined = 0). Returns
// { ok, itemsSubtotalMinor, grandTotalMinor, unallocatedMinor, perPerson: Map<ref, minor>, errors }.
export function previewItemization(itemLines, fees, totalMinor, currency) {
  const errors = [];
  const perPerson = new Map();
  const add = (ref, amt) => perPerson.set(ref, (perPerson.get(ref) || 0) + amt);
  let itemsSubtotalMinor = 0;
  for (const line of itemLines) {
    const quantity = Number(line.quantity);
    const unitPriceMinor = parseAmount(line.unitPrice, currency);
    if (!line.description || !line.description.trim()) { errors.push("Every item needs a description."); continue; }
    if (!Number.isFinite(quantity) || quantity <= 0) { errors.push(`"${line.description}": enter a quantity greater than zero.`); continue; }
    if (unitPriceMinor === null || unitPriceMinor <= 0) { errors.push(`"${line.description}": enter a unit price greater than zero.`); continue; }
    if (!line.refs || !line.refs.length) { errors.push(`"${line.description}": choose who shares this line.`); continue; }
    const lineTotal = Math.round(quantity * unitPriceMinor);
    itemsSubtotalMinor += lineTotal;
    const parts = allocate(lineTotal, line.refs.map(() => 1));
    line.refs.forEach((ref, j) => add(ref, parts[j]));
  }
  const feeMinor = (text) => { if (!text || !String(text).trim()) return 0; const m = parseAmount(text, currency); return m === null ? NaN : m; };
  const taxMinor = feeMinor(fees.tax);
  const tipMinor = feeMinor(fees.tip);
  const discountMinor = feeMinor(fees.discount);
  const otherFeeMinor = feeMinor(fees.fee);
  if ([taxMinor, tipMinor, discountMinor, otherFeeMinor].some((v) => Number.isNaN(v) || v < 0)) errors.push("Tax, tip, discount and fee must each be a non-negative amount.");
  const netExtra = (Number.isNaN(taxMinor) ? 0 : taxMinor) + (Number.isNaN(tipMinor) ? 0 : tipMinor) - (Number.isNaN(discountMinor) ? 0 : discountMinor) + (Number.isNaN(otherFeeMinor) ? 0 : otherFeeMinor);
  if (!errors.length && netExtra !== 0 && itemsSubtotalMinor <= 0) errors.push("Tax, tip, discount or a fee needs at least one item line to allocate against.");
  if (!errors.length && netExtra !== 0 && itemsSubtotalMinor > 0) {
    const refs = [...perPerson.keys()];
    const weights = refs.map((ref) => perPerson.get(ref));
    const parts = allocate(Math.abs(netExtra), weights);
    const sign = netExtra < 0 ? -1 : 1;
    refs.forEach((ref, j) => add(ref, sign * parts[j]));
  }
  const grandTotalMinor = itemsSubtotalMinor + netExtra;
  const unallocatedMinor = totalMinor === null ? null : totalMinor - grandTotalMinor;
  return { ok: errors.length === 0 && unallocatedMinor === 0, itemsSubtotalMinor, grandTotalMinor, unallocatedMinor, perPerson, errors };
}
