'use strict';
// BT-009-26: Splitwise import — "start with the specified Splitwise import, including mapping,
// validation, duplicate detection and a non-mutating preview before confirmed import" (Terry,
// 2026-09-19). This reads Splitwise's own CSV export (Date, Description, Category, Cost, Currency,
// then one column per person, each holding that person's NET change for the row — positive when
// they effectively paid more than their share, negative when they owe, blank when uninvolved).
// There is no live Splitwise API integration here and none is needed for this: the CSV a member
// exports from Splitwise themselves needs no provider account or credentials at all — the one
// dependency this format genuinely lacks is an EXCHANGE RATE (Splitwise's CSV carries none), so a
// row whose own currency differs from this workspace's reporting currency is refused rather than
// guessed (documented below, never silently converted).
//
// This module only PARSES and PLANS — it never touches `doc`. `api/group/handler.js`'s
// preview/confirm routes turn a plan into a real record using the exact same
// `expenseMoney`/`groups.normalizeSplit`/`groups.positiveAmount` validation every other expense or
// payment already goes through, so an imported record can never bypass a rule a manually entered
// one would have to follow.
const fields = require('./fields');
const money = require('./money');
const { badRequest } = require('./http');

const REQUIRED_COLUMNS = ['Date', 'Description', 'Category', 'Cost', 'Currency'];
const MAX_CSV_CHARS = 300000;
const MAX_ROWS = 2000;

// A small RFC 4180 reader: quoted fields, embedded commas/newlines, "" as an escaped quote. Splitwise's
// own export is plain and rarely needs quoting, but a description or category can contain a comma.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ',') { pushField(); i += 1; continue; }
    if (c === '\r') { i += 1; continue; }
    if (c === '\n') { pushRow(); i += 1; continue; }
    field += c; i += 1;
  }
  if (field !== '' || row.length) pushRow();
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// Parses and shape-checks the file itself (before looking at any single row): the required
// columns Splitwise always exports, and at least one person column beside them.
function readCsv(csvText) {
  if (typeof csvText !== 'string' || !csvText.trim()) throw badRequest('Choose a Splitwise CSV export to import.', 'invalid_csv');
  if (csvText.length > MAX_CSV_CHARS) throw badRequest('That file is too large to import at once. Export a smaller date range from Splitwise.', 'csv_too_large');
  const rows = parseCsv(csvText);
  if (!rows.length) throw badRequest('That file has no rows.', 'invalid_csv');
  const header = rows[0].map((h) => h.trim());
  for (const col of REQUIRED_COLUMNS) {
    if (!header.includes(col)) throw badRequest(`The file is missing the "${col}" column Splitwise always exports. Export a fresh copy from Splitwise and try again.`, 'invalid_csv');
  }
  const personColumns = header.filter((h) => h && !REQUIRED_COLUMNS.includes(h));
  if (!personColumns.length) throw badRequest('The file names no people to split expenses with.', 'invalid_csv');
  const body = rows.slice(1).filter((r) => r.some((c) => (c || '').trim() !== ''));
  if (body.length > MAX_ROWS) throw badRequest(`That file has more than ${MAX_ROWS} rows. Split it into smaller files, by date range, and import them one at a time.`, 'csv_too_large');
  return { header, personColumns, rows: body };
}

// A category is matched by name only (case-insensitive), never auto-created — the same "never
// invent a new managed record from free text" discipline merchants already follow (BT-007-01).
function findCategoryId(doc, name) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return null;
  const hit = (doc.categories || []).find((c) => !c.archived && String(c.name || '').trim().toLowerCase() === wanted);
  return hit ? hit.id : null;
}

const cellOf = (header, cells, name) => { const i = header.indexOf(name); return i >= 0 ? String(cells[i] || '').trim() : ''; };

// One row's plan: `{ ok:true, kind:'expense'|'settlement', ... }` ready to become a real record, or
// `{ ok:false, reason, message }` explaining exactly why not — a row that fails here is simply left
// out of a confirmed import, never guessed.
function planRow(doc, header, personColumns, cells, mapping, index) {
  const reportingCurrency = (doc.settings && doc.settings.reportingCurrency) || 'EUR';
  const raw = {
    date: cellOf(header, cells, 'Date'), description: cellOf(header, cells, 'Description'),
    category: cellOf(header, cells, 'Category'), cost: cellOf(header, cells, 'Cost'), currency: cellOf(header, cells, 'Currency'),
  };
  const fail = (reason, message, extra = {}) => ({ index, ok: false, reason, message, raw, ...extra });
  // Splitwise's own running-total row ("", "Total balance", ...) — not a transaction at all.
  if (!raw.date && /^total balance$/i.test(raw.description)) return { index, ok: false, skip: true, reason: 'summary_row', message: 'Splitwise\'s own running-total row, not a real transaction.', raw };
  if (!raw.description) return fail('invalid_row', 'This row has no description.');
  let date;
  try { date = fields.date(raw.date, 'Date', { required: true }); } catch { return fail('invalid_date', `"${raw.date}" is not a valid date (expected YYYY-MM-DD, exactly as Splitwise exports it).`); }
  if (!money.isCurrency(raw.currency)) return fail('unsupported_currency', `"${raw.currency}" is not a currency this app supports.`);
  if (raw.currency !== reportingCurrency) {
    return fail('unsupported_currency', `This workspace's shared expenses are recorded in ${reportingCurrency}; Splitwise's export carries no exchange rate to convert this ${raw.currency} row automatically. Record it by hand instead.`);
  }
  let costMinor;
  try { costMinor = money.parseDecimal(raw.cost, raw.currency, 'Cost'); } catch { return fail('invalid_amount', `"${raw.cost}" is not a valid amount.`); }
  if (costMinor <= 0) return fail('invalid_amount', 'The cost must be greater than zero.');

  const people = [];
  const unmapped = [];
  for (const col of personColumns) {
    const text = cellOf(header, cells, col);
    if (text === '') continue; // blank: not involved in this row at all
    let netMinor;
    try { netMinor = money.parseDecimal(text, raw.currency, col); } catch { return fail('invalid_amount', `"${text}" in the "${col}" column is not a valid amount.`); }
    if (netMinor === 0) continue; // exactly zero: not really involved
    const mapped = mapping && Object.prototype.hasOwnProperty.call(mapping, col) ? mapping[col] : undefined;
    if (mapped === null) continue; // explicitly told to skip this person
    if (!mapped) { unmapped.push(col); continue; }
    people.push({ column: col, ref: mapped, netMinor });
  }
  if (unmapped.length) return fail('unmapped_person', `Map ${unmapped.map((c) => `"${c}"`).join(', ')} to someone in this group before importing this row.`, { unmapped });
  if (people.length < 2) return fail('too_few_people', 'Fewer than two mapped people are actually involved in this row.');

  const isPaymentLike = /^payment$/i.test(raw.category) || /^payment/i.test(raw.description);
  const positives = people.filter((p) => p.netMinor > 0);
  const negatives = people.filter((p) => p.netMinor < 0);

  if (isPaymentLike || (people.length === 2 && positives.length === 1 && negatives.length === 1)) {
    if (positives.length !== 1 || negatives.length !== 1 || positives[0].netMinor !== -negatives[0].netMinor) {
      return fail('ambiguous_payment', 'This looks like a payment row, but the amounts do not exactly cancel out, so it needs to be entered by hand.');
    }
    return {
      index, ok: true, kind: 'settlement', raw, date, notes: 'Imported from Splitwise',
      from: positives[0].ref, to: negatives[0].ref, amount: money.toDecimal(positives[0].netMinor, raw.currency), currency: raw.currency,
      involves: people.map((p) => p.ref),
    };
  }

  if (positives.length > 1) return fail('multiple_payers', 'More than one person paid toward this expense — Splitwise\'s export does not say how much each of them actually paid, so it needs to be entered by hand.');
  if (positives.length === 0) return fail('no_payer', 'No one appears to have paid this expense.');
  const payer = positives[0];
  // Single-payer reconstruction: the payer's own net = paid − share, and paid is assumed to be the
  // whole cost (Splitwise's own common case); everyone else paid nothing, so their net = −share.
  const lines = people.map((p) => ({ ref: p.ref, value: money.toDecimal(p === payer ? costMinor - p.netMinor : -p.netMinor, raw.currency) }));
  const reconciledMinor = lines.reduce((sum, l) => sum + money.parseDecimal(l.value, raw.currency), 0);
  const tolerance = people.length; // at most one minor unit of rounding per person, Splitwise's own allocation
  if (Math.abs(reconciledMinor - costMinor) > tolerance) {
    return fail('reconcile_mismatch', `The per-person shares (${money.toDecimal(reconciledMinor, raw.currency)}) do not add up to the cost (${money.toDecimal(costMinor, raw.currency)}).`);
  }
  let roundingNote = null;
  if (reconciledMinor !== costMinor) {
    // A tiny (sub-tolerance) gap is absorbed onto the payer's own line so the stored split
    // reconciles EXACTLY, as every split this app stores always must — never left silently off.
    const diff = costMinor - reconciledMinor;
    const payerLine = lines.find((l) => l.ref === payer.ref);
    payerLine.value = money.toDecimal(money.parseDecimal(payerLine.value, raw.currency) + diff, raw.currency);
    roundingNote = `Adjusted by ${money.toDecimal(Math.abs(diff), raw.currency)} to reconcile exactly, absorbed by the payer's own share.`;
  }
  return {
    index, ok: true, kind: 'expense', raw, roundingNote,
    description: raw.description, date, amount: money.toDecimal(costMinor, raw.currency), currency: raw.currency,
    categoryId: findCategoryId(doc, raw.category), notes: 'Imported from Splitwise',
    payers: [{ ref: payer.ref }], split: { method: 'amounts', lines },
    involves: people.map((p) => p.ref),
  };
}

// A likely-duplicate against what this workspace already records (BT-009-26's "duplicate
// detection") — advisory, never a hard block: the confirmed import still honors an explicit choice
// to import a flagged row anyway (a person's own historical data can legitimately repeat).
function duplicateOfExpense(doc, plan) {
  const amountMinor = money.parseDecimal(plan.amount, plan.currency);
  const wanted = plan.description.trim().toLowerCase();
  return (doc.groupExpenses || []).find((e) => !e.voidedAt && e.date === plan.date && e.currency === plan.currency
    && e.amountMinor === amountMinor && String(e.description || '').trim().toLowerCase() === wanted) || null;
}
function duplicateOfSettlement(doc, plan) {
  const amountMinor = money.parseDecimal(plan.amount, plan.currency);
  return (doc.groupSettlements || []).find((s) => !s.voidedAt && s.date === plan.date && s.currency === plan.currency
    && s.amountMinor === amountMinor && s.from === plan.from && s.to === plan.to) || null;
}

function planAll(doc, csvText, mapping) {
  const { header, personColumns, rows } = readCsv(csvText);
  const plans = rows.map((cells, i) => planRow(doc, header, personColumns, cells, mapping || {}, i));
  return { header, personColumns, plans };
}

module.exports = { parseCsv, readCsv, planRow, planAll, findCategoryId, duplicateOfExpense, duplicateOfSettlement, REQUIRED_COLUMNS };
