'use strict';
// Shared-expenses download before deletion/disconnection (BT-014, Terry 2026-09-17): "Before
// either deletion or disconnection, offer the deleting workspace a download of its authorized
// shared-expense information in PDF, CSV, or XLSX format. Include participants, dates,
// descriptions, currencies, amounts, splits, settlements, and outstanding balances. Downloading
// is optional and must not execute or confirm deletion."
//
// No PDF/CSV/XLSX/JSON export infrastructure existed anywhere in this codebase before this
// module (confirmed by search). CSV and JSON are built here with no new dependency (both are
// plain text formats the existing stack already handles). XLSX and PDF are deliberately NOT
// built in this change — see docs/REQUIREMENTS.md BT-014-05 and PROJECT_STATE.md for the
// reasoning: a correct XLSX/PDF writer is real engineering risk (subtly-wrong files, e.g. XML
// content-type/relationship errors or PDF stream/font issues) that a small vetted dependency
// mitigates better than a hand-rolled writer would, but adding one is a call for whoever picks
// this up next, not assumed here.
//
// This module only reads (never mutates) the workspace document and only returns what the
// caller is already authorized to see (every participant, expense and settlement the workspace's
// own Shared-expenses page already shows them) — the same one-model-per-concept data
// `api/group/handler.js` renders, reused here rather than re-derived.
const groups = require('./groups');
const money = require('./money');

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

  const balances = groups.balances(doc, parts.map((p) => p.ref), { ensureCurrency: null })
    .flatMap((b) => b.rows
      .filter((r) => r.netMinor !== 0 || r.paidMinor !== 0 || r.shareMinor !== 0)
      .map((r) => ({ name: label(r.ref), currency: b.currency, outstanding: money.toDecimal(r.netMinor, b.currency) })));

  return {
    generatedAt: null, // filled by the caller with ctx.nowIso(), kept out of the pure builder for testability
    participants: parts.map((p) => ({ name: p.name, type: p.type, active: p.active })),
    expenses, settlements, balances,
  };
}

function csvCell(value) {
  const s = String(value ?? '');
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

const FORMATS = { csv: { mime: 'text/csv; charset=utf-8', ext: 'csv', render: toCsv }, json: { mime: 'application/json', ext: 'json', render: toJson } };

function render(doc, principal, format, nowIso) {
  const spec = FORMATS[format];
  if (!spec) return null;
  const report = buildReport(doc, principal);
  report.generatedAt = nowIso;
  return { body: spec.render(report), mime: spec.mime, filename: `shared-expenses-${doc.id}.${spec.ext}` };
}

module.exports = { buildReport, toCsv, toJson, render, FORMATS: Object.keys(FORMATS) };
