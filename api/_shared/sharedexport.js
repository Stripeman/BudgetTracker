'use strict';
// Shared-expenses download before deletion/disconnection (BT-014, Terry 2026-09-17): "Before
// either deletion or disconnection, offer the deleting workspace a download of its authorized
// shared-expense information in PDF, CSV, or XLSX format. Include participants, dates,
// descriptions, currencies, amounts, splits, settlements, and outstanding balances. Downloading
// is optional and must not execute or confirm deletion."
//
// No PDF/CSV/XLSX/JSON export infrastructure existed anywhere in this codebase before this
// module (confirmed by search). CSV and JSON need no dependency (both are plain text formats the
// existing stack already handles). XLSX and PDF (BT-014-06, added 2026-09-17 with Terry's explicit
// approval to add a small, well-known, narrowly-scoped dependency for each — see
// docs/REQUIREMENTS.md and PROJECT_STATE.md) use `exceljs` (pure JS, MIT, actively maintained,
// no native/binary deps) and `pdfkit` (pure JS, MIT, actively maintained, no native deps). Both
// were sanity-checked before adding: no deprecation notice on either package; `npm audit` after
// installing found only one moderate, INAPPLICABLE transitive advisory (GHSA-w5hq-g745-h8pq, a
// missing bounds check in `uuid`'s v3/v5/v6 functions when a caller passes an explicit output
// `buf` — exceljs's own use, in cf-rule-ext-xform.js, calls `uuidv4()` with no arguments, which is
// both the wrong uuid version and the wrong call shape for that advisory to reach).
//
// This module only reads (never mutates) the workspace document and only returns what the
// caller is already authorized to see (every participant, expense and settlement the workspace's
// own Shared-expenses page already shows them) — the same one-model-per-concept data
// `api/group/handler.js` renders, reused here rather than re-derived.
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const groups = require('./groups');
const money = require('./money');
const groupSettings = require('./group-settings');

// Builds the same authorized report regardless of output format: participants, every expense
// (description, date, currency, amount, split, payers, shares), every settlement (from/to,
// currency, amount, status, dates) and the derived per-currency balances (never stored, always
// recomputed here exactly like the Shared expenses page does).
function buildReport(doc, principal) {
  const parts = groups.participants(doc, principal);
  const nameOf = new Map(parts.map((p) => [p.ref, p.name]));
  const label = (ref) => nameOf.get(ref) || ref;

  const expenses = (doc.groupExpenses || []).map((e) => ({
    id: e.id,
    description: e.description || '',
    date: e.date,
    currency: e.currency,
    amount: money.toDecimal(e.amountMinor, e.currency),
    status: e.voidedAt ? 'void' : 'active',
    payers: (e.payers || []).map((p) => ({ name: label(p.ref), amount: money.toDecimal(p.amountMinor, e.currency) })),
    splitMethod: e.split ? e.split.method : '',
    shares: (e.shares || []).map((s) => ({ name: label(s.ref), amount: money.toDecimal(s.amountMinor, e.currency) })),
  }));

  const settlements = (doc.groupSettlements || []).map((s) => ({
    id: s.id,
    date: s.date,
    currency: s.currency,
    amount: money.toDecimal(s.amountMinor, s.currency),
    from: label(s.from),
    to: label(s.to),
    status: s.voidedAt ? 'void' : s.status,
  }));

  // Same parameters the live Shared Expenses page passes (api/group/handler.js), not just the
  // same function (financial review finding, 2026-09-17): countReported must follow the
  // workspace's own group setting so this report can never silently disagree with what the page
  // itself shows, even for figures this export doesn't currently surface (defense-in-depth for
  // any future addition, per CLAUDE.md §4's "one canonical model ... per concept").
  const balances = groups.balances(doc, parts.map((p) => p.ref), { ensureCurrency: null, countReported: groupSettings.get(doc, 'countReported') })
    .flatMap((b) => b.rows
      .filter((r) => r.netMinor !== 0 || r.paidMinor !== 0 || r.shareMinor !== 0)
      .map((r) => ({ name: label(r.ref), currency: b.currency, outstanding: money.toDecimal(r.netMinor, b.currency) })));

  return {
    generatedAt: null, // filled by the caller with ctx.nowIso(), kept out of the pure builder for testability
    participants: parts.map((p) => ({ name: p.name, type: p.type, active: p.active })),
    expenses, settlements, balances,
  };
}

// Neutralizes CSV/formula injection (security review finding, 2026-09-17): a cell starting with
// =, +, -, @, tab or CR is treated as a formula by Excel/Sheets/LibreOffice when the file is
// opened. User-controlled text (expense descriptions, participant/contact names, settlement
// labels) reaches this function unescaped from api/_shared/fields.js, which does not forbid a
// leading formula character. A leading apostrophe forces spreadsheet applications to read the
// cell as literal text without changing what a plain CSV/text reader sees.
function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRow(values) {
  return values.map(csvCell).join(',');
}
function csvSection(title, header, rows) {
  const lines = [`# ${title}`, csvRow(header)];
  for (const r of rows) lines.push(csvRow(r));
  return lines.join('\r\n');
}

// One CSV document with a clearly labeled section per table (participants, expenses, splits,
// settlements, balances) — no multi-file archive dependency needed for a first cut.
function toCsv(report) {
  const sections = [];
  sections.push(csvSection('Participants', ['Name', 'Type', 'Active'],
    report.participants.map((p) => [p.name, p.type, p.active ? 'yes' : 'no'])));
  sections.push(csvSection('Expenses', ['Date', 'Description', 'Currency', 'Amount', 'Status', 'Paid by', 'Split method'],
    report.expenses.map((e) => [e.date, e.description, e.currency, e.amount, e.status, e.payers.map((p) => `${p.name} ${p.amount}`).join('; '), e.splitMethod])));
  sections.push(csvSection('Expense shares', ['Expense date', 'Expense description', 'Person', 'Share amount'],
    report.expenses.flatMap((e) => e.shares.map((s) => [e.date, e.description, s.name, s.amount]))));
  sections.push(csvSection('Settlements', ['Date', 'From', 'To', 'Currency', 'Amount', 'Status'],
    report.settlements.map((s) => [s.date, s.from, s.to, s.currency, s.amount, s.status])));
  sections.push(csvSection('Outstanding balances', ['Name', 'Currency', 'Outstanding (positive = owed to them)'],
    report.balances.map((b) => [b.name, b.currency, b.outstanding])));
  return sections.join('\r\n\r\n') + '\r\n';
}

function toJson(report) {
  return JSON.stringify(report, null, 2);
}

// One workbook, one worksheet per table — mirrors the CSV's sections exactly (same rows, same
// column order), so the two formats can never silently disagree about what they show.
//
// CSV-injection lesson carried forward (BT-014-06, security note): unlike CSV, a real XLSX
// (OOXML) file has an explicit, separate cell-type model. A formula lives only in a `<f>` element;
// a plain value written here (`cell.value = 'some string'`) is always stored as inline/shared
// text (Excel's own type inference never runs the way it does when it re-parses a loose CSV file).
// Confirmed directly in exceljs's own source (lib/doc/cell.js): the value-type switch checks
// `typeof value === 'string'` and resolves to `Cell.Types.String` BEFORE it ever looks at
// `value.formula` — a plain string, whatever it starts with, can only become Types.Formula by
// passing an object shaped `{ formula: '...' }`, which this module never does. A round-trip test
// (api/test/sharedexport.test.js) also inspects the generated .xlsx's own worksheet XML directly to
// prove a description starting with `=` lands as literal text with no `<f>` element. Given that
// evidence, the CSV file's leading-apostrophe neutralization is deliberately NOT reapplied here:
// it is unneeded for this format, and would visibly alter the stored text (an extra leading `'`)
// for no protective benefit.
async function toXlsx(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BudgetTracker';
  wb.created = report.generatedAt ? new Date(report.generatedAt) : new Date();

  const sheet = (name, columns, rows) => {
    const ws = wb.addWorksheet(name);
    ws.columns = columns.map((header) => ({ header, width: Math.max(12, header.length + 2) }));
    for (const r of rows) ws.addRow(r);
    ws.getRow(1).font = { bold: true };
    return ws;
  };

  sheet('Participants', ['Name', 'Type', 'Active'], report.participants.map((p) => [p.name, p.type, p.active ? 'yes' : 'no']));
  sheet('Expenses', ['Date', 'Description', 'Currency', 'Amount', 'Status', 'Paid by', 'Split method'],
    report.expenses.map((e) => [e.date, e.description, e.currency, e.amount, e.status, e.payers.map((p) => `${p.name} ${p.amount}`).join('; '), e.splitMethod]));
  sheet('Expense shares', ['Expense date', 'Expense description', 'Person', 'Share amount'],
    report.expenses.flatMap((e) => e.shares.map((s) => [e.date, e.description, s.name, s.amount])));
  sheet('Settlements', ['Date', 'From', 'To', 'Currency', 'Amount', 'Status'],
    report.settlements.map((s) => [s.date, s.from, s.to, s.currency, s.amount, s.status]));
  sheet('Outstanding balances', ['Name', 'Currency', 'Outstanding (positive = owed to them)'],
    report.balances.map((b) => [b.name, b.currency, b.outstanding]));

  return wb.xlsx.writeBuffer();
}

// A simple, readable, sectioned document mirroring the CSV/XLSX section structure. Every value
// reaches pdfkit's `.text()` as plain page content. Confirmed directly (a generated file was
// inspected byte for byte, and api/test/sharedexport.test.js proves it on every run): pdfkit draws
// text runs as HEX strings (`<48656c6c6f> Tj`, one byte per WinAnsi character code) rather than
// parenthesized literal strings, so a description's raw characters — letters, digits, `(`, `)`,
// `\`, a leading `=`, anything — never appear in the content stream at all, only their hex byte
// codes; those cannot be parsed as a PDF string delimiter or operator under any circumstance. (Had
// pdfkit instead used literal `(...)` strings, its own `escapable`/`escapableRe` table already
// escapes `(`, `)`, `\` and control characters before writing them, so the outcome would be safe
// either way.) There is no reachable path from a description or name to raw content-stream
// injection, and PDF has no formula-evaluation model to begin with, so CSV-style formula
// neutralization does not apply to this format.
function toPdf(report) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    // compress: false keeps the content stream as plain bytes rather than flate-deflated — these
    // exports are small, and leaving the stream uncompressed lets both this module's own tests and
    // anyone auditing a downloaded file confirm directly (without inflating first) that user text
    // was written as literal page content, never as a raw, unescaped control sequence.
    const docPdf = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true, compress: false });
    docPdf.on('data', (c) => chunks.push(c));
    docPdf.on('end', () => resolve(Buffer.concat(chunks)));
    docPdf.on('error', reject);

    const h1 = (t) => docPdf.moveDown(0.5).fontSize(16).text(t, { underline: false }).moveDown(0.3);
    const h2 = (t) => docPdf.moveDown(0.6).fontSize(13).text(t).moveDown(0.2);
    const row = (t) => docPdf.fontSize(10).text(t);

    try {
      docPdf.fontSize(18).text('Shared expenses export', { align: 'left' });
      docPdf.fontSize(9).fillColor('#555').text(report.generatedAt ? `Generated ${report.generatedAt}` : '');
      docPdf.fillColor('#000');

      h1('Participants');
      if (!report.participants.length) row('None.');
      for (const p of report.participants) row(`${p.name} — ${p.type}${p.active ? '' : ' (inactive)'}`);

      h1('Expenses');
      if (!report.expenses.length) row('None.');
      for (const e of report.expenses) {
        h2(`${e.date} — ${e.description || '(no description)'}`);
        row(`${e.amount} ${e.currency} — ${e.status}`);
        row(`Paid by: ${e.payers.map((p) => `${p.name} ${p.amount}`).join(', ') || '—'}`);
        row(`Split (${e.splitMethod || '—'}): ${e.shares.map((s) => `${s.name} ${s.amount}`).join(', ') || '—'}`);
      }

      h1('Settlements');
      if (!report.settlements.length) row('None.');
      for (const s of report.settlements) row(`${s.date} — ${s.from} to ${s.to}: ${s.amount} ${s.currency} (${s.status})`);

      h1('Outstanding balances');
      if (!report.balances.length) row('None.');
      for (const b of report.balances) row(`${b.name}: ${b.outstanding} ${b.currency}`);

      docPdf.end();
    } catch (err) {
      reject(err);
    }
  });
}

const FORMATS = {
  csv: { mime: 'text/csv; charset=utf-8', ext: 'csv', render: toCsv, binary: false },
  json: { mime: 'application/json', ext: 'json', render: toJson, binary: false },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx', render: toXlsx, binary: true },
  pdf: { mime: 'application/pdf', ext: 'pdf', render: toPdf, binary: true },
};

// Always async now (XLSX/PDF rendering is inherently asynchronous); CSV/JSON simply resolve
// immediately. Binary formats come back base64-encoded, because this codebase's one shared HTTP
// responder (api/_shared/http.js `respond`) always JSON-encodes `body` for every route (see
// api/group/handler.js) — `encoding` tells the caller which decoding the `content` field needs.
async function render(doc, principal, format, nowIso) {
  const spec = FORMATS[format];
  if (!spec) return null;
  const report = buildReport(doc, principal);
  report.generatedAt = nowIso;
  const rendered = await spec.render(report);
  const body = spec.binary ? Buffer.from(rendered).toString('base64') : rendered;
  return { body, mime: spec.mime, filename: `shared-expenses-${doc.id}.${spec.ext}`, encoding: spec.binary ? 'base64' : 'text' };
}

module.exports = { buildReport, toCsv, toJson, toXlsx, toPdf, render, FORMATS: Object.keys(FORMATS) };
