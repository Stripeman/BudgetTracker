'use strict';
// BT-014 Part A/BT-014-06 (Terry, 2026-09-17): "Before either deletion or disconnection, offer the
// deleting workspace a download of its authorized shared-expense information in PDF, CSV, or XLSX
// format. Include participants, dates, descriptions, currencies, amounts, splits, settlements, and
// outstanding balances." All four formats are built — see api/_shared/sharedexport.js. All data is
// fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { harness, USERS } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const equal = (...refs) => ({ method: 'equal', lines: refs.map((ref) => ({ ref })) });

async function fixture(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Trip', kind: 'group', reportingCurrency: 'EUR' } }), 201).workspace;
  const q = { workspaceId: ws.id };
  const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: q, body: { email: USERS.bob.email, role: 'member' } }), 201);
  ok(await h.call('invitations', 'POST', { user: USERS.bob, query: { action: 'accept' }, body: { workspaceId: ws.id, token: inv.token } }));
  const members = ok(await h.call('members', 'GET', { as: 'alice', query: q })).members;
  const ref = (name) => `member:${members.find((m) => m.name.startsWith(name)).id}`;
  return { ws, q, refs: { alice: ref('Alice'), bob: ref('Bob') } };
}

describe('BT-014 Part A: shared-expenses export (CSV/JSON)', () => {
  test('JSON export includes participants, expenses (with splits), settlements and outstanding balances; CSV mirrors the same data', async () => {
    const h = harness();
    const f = await fixture(h);
    await ok(await h.call('group', 'POST', {
      as: 'alice', query: f.q,
      body: { description: 'Fictional dinner', amount: '90.00', date: '2026-09-10', payers: [{ ref: f.refs.alice, amount: '90.00' }], split: equal(f.refs.alice, f.refs.bob) },
    }), 201);
    ok(await h.call('group', 'POST', { as: 'bob', query: { ...f.q, action: 'settle' }, body: { from: f.refs.bob, to: f.refs.alice, amount: '20.00', currency: 'EUR', date: '2026-09-11', method: 'cash' } }), 201);

    const jsonRes = ok(await h.call('group', 'GET', { as: 'alice', query: { ...f.q, action: 'export', format: 'json' } }));
    assert.equal(jsonRes.format, 'json');
    assert.equal(jsonRes.mime, 'application/json');
    assert.match(jsonRes.filename, /\.json$/);
    const report = JSON.parse(jsonRes.content);
    assert.ok(report.participants.some((p) => p.name.startsWith('Alice')));
    assert.ok(report.participants.some((p) => p.name.startsWith('Bob')));
    const exp = report.expenses.find((e) => e.description === 'Fictional dinner');
    assert.equal(exp.currency, 'EUR');
    assert.equal(exp.amount, '90.00');
    assert.equal(exp.splitMethod, 'equal');
    assert.deepEqual(exp.shares.map((s) => s.amount).sort(), ['45.00', '45.00']);
    const settlement = report.settlements.find((s) => s.amount === '20.00');
    assert.equal(settlement.status, 'reported');
    assert.ok(report.balances.length, 'outstanding balances are included');
    // Never a raw internal ref in place of a resolved name.
    assert.equal(JSON.stringify(report).includes('member:'), false);

    const csvRes = ok(await h.call('group', 'GET', { as: 'bob', query: { ...f.q, action: 'export', format: 'csv' } }));
    assert.equal(csvRes.format, 'csv');
    assert.match(csvRes.mime, /^text\/csv/);
    assert.match(csvRes.content, /# Participants/);
    assert.match(csvRes.content, /# Expenses/);
    assert.match(csvRes.content, /Fictional dinner/);
    assert.match(csvRes.content, /# Settlements/);
    assert.match(csvRes.content, /# Outstanding balances/);
  });

  test('BT-009-13: a foreign-currency expense keeps its original amount, currency and rate visible in JSON, CSV and XLSX exports, alongside the converted reporting figure', async () => {
    const h = harness();
    const f = await fixture(h);
    await ok(await h.call('group', 'POST', {
      as: 'alice', query: f.q,
      body: { description: 'Fictional souvenirs', amount: '50.00', currency: 'USD', rate: '0.90', date: '2026-09-10', payers: [{ ref: f.refs.alice, amount: '45.00' }], split: equal(f.refs.alice, f.refs.bob) },
    }), 201);

    const jsonRes = ok(await h.call('group', 'GET', { as: 'alice', query: { ...f.q, action: 'export', format: 'json' } }));
    const report = JSON.parse(jsonRes.content);
    const exp = report.expenses.find((e) => e.description === 'Fictional souvenirs');
    assert.equal(exp.currency, 'EUR');
    assert.equal(exp.amount, '45.00');
    assert.deepEqual(exp.original, { amount: '50.00', currency: 'USD', rate: '0.90', rateSource: 'manual', rateDate: '2026-09-10' });

    const csvRes = ok(await h.call('group', 'GET', { as: 'alice', query: { ...f.q, action: 'export', format: 'csv' } }));
    assert.match(csvRes.content, /Original amount,Original currency,Exchange rate/);
    assert.match(csvRes.content, /Fictional souvenirs,EUR,45\.00,50\.00,USD,0\.90/);

    const ExcelJS_ = require('exceljs');
    const xlsxRes = ok(await h.call('group', 'GET', { as: 'alice', query: { ...f.q, action: 'export', format: 'xlsx' } }));
    const wb = new ExcelJS_.Workbook();
    await wb.xlsx.load(Buffer.from(xlsxRes.content, 'base64'));
    const expenses = wb.getWorksheet('Expenses');
    let row = null;
    expenses.eachRow((r, i) => { if (i > 1 && r.getCell(2).value === 'Fictional souvenirs') row = r; });
    assert.ok(row, 'the foreign-currency expense appears in the Expenses sheet');
    assert.equal(row.getCell(5).value, '50.00');
    assert.equal(row.getCell(6).value, 'USD');
    assert.equal(row.getCell(7).value, '0.90');
  });

  test('a description starting with a formula character is neutralized in CSV, so Excel/Sheets never treat it as a formula (security review fix, 2026-09-17)', async () => {
    const h = harness();
    const f = await fixture(h);
    await ok(await h.call('group', 'POST', {
      as: 'alice', query: f.q,
      body: { description: '=HYPERLINK("http://attacker.example")', amount: '10.00', date: '2026-09-10', payers: [{ ref: f.refs.alice, amount: '10.00' }], split: equal(f.refs.alice, f.refs.bob) },
    }), 201);
    const csvRes = ok(await h.call('group', 'GET', { as: 'alice', query: { ...f.q, action: 'export', format: 'csv' } }));
    // Every field is delimited by a comma or CRLF (or starts a quoted field, "..."); a formula
    // character right after one of those, with no neutralizing apostrophe, is what a spreadsheet
    // application would execute. None may appear unprefixed.
    assert.doesNotMatch(csvRes.content, /(^|[,\r\n]"?)=HYPERLINK/, 'a bare, unprefixed formula must never reach the file');
    // Doubled internal quotes: the cell's own literal " characters are CSV-escaped per RFC 4180,
    // same as any other quoted cell — that escaping is unrelated to, and unaffected by, the
    // leading-apostrophe neutralization this test is about.
    assert.match(csvRes.content, /'=HYPERLINK\(""http:\/\/attacker\.example""\)/, 'neutralized with a leading apostrophe, still human-readable — the raw text is expected to still appear, just as literal data');
    // JSON is plain data, never opened as a spreadsheet, so it needs no neutralization.
    const jsonRes = ok(await h.call('group', 'GET', { as: 'alice', query: { ...f.q, action: 'export', format: 'json' } }));
    assert.match(jsonRes.content, /"description": "=HYPERLINK/);
  });

  test('downloading never deletes, disconnects or requires a confirmation — a viewer-less member can export and the workspace is unchanged', async () => {
    const h = harness();
    const f = await fixture(h);
    const before = JSON.parse((await h.storage.getBytes(`workspaces/${f.ws.id}/workspace.json`)).bytes.toString());
    ok(await h.call('group', 'GET', { as: 'bob', query: { ...f.q, action: 'export', format: 'json' } }));
    const after = JSON.parse((await h.storage.getBytes(`workspaces/${f.ws.id}/workspace.json`)).bytes.toString());
    assert.deepEqual(before, after, 'a read-only export never mutates the workspace document');
  });

  test('an outsider cannot export; an unsupported format is refused', async () => {
    const h = harness();
    const f = await fixture(h);
    assert.equal((await h.call('group', 'GET', { as: 'eve', query: { ...f.q, action: 'export', format: 'json' } })).status, 404);
    const bad = await h.call('group', 'GET', { as: 'alice', query: { ...f.q, action: 'export', format: 'xml' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'invalid_format');
    assert.match(bad.body.error.message, /csv, json, xlsx, pdf/);
  });

  test('XLSX export includes the same data as CSV/JSON, with the correct mime type, filename and base64 encoding, and mirrors the export authorization', async () => {
    const h = harness();
    const f = await fixture(h);
    await ok(await h.call('group', 'POST', {
      as: 'alice', query: f.q,
      body: { description: 'Fictional dinner', amount: '90.00', date: '2026-09-10', payers: [{ ref: f.refs.alice, amount: '90.00' }], split: equal(f.refs.alice, f.refs.bob) },
    }), 201);
    ok(await h.call('group', 'POST', { as: 'bob', query: { ...f.q, action: 'settle' }, body: { from: f.refs.bob, to: f.refs.alice, amount: '20.00', currency: 'EUR', date: '2026-09-11', method: 'cash' } }), 201);

    // An outsider cannot export XLSX either (same authorization as CSV/JSON above).
    assert.equal((await h.call('group', 'GET', { as: 'eve', query: { ...f.q, action: 'export', format: 'xlsx' } })).status, 404);

    const res = ok(await h.call('group', 'GET', { as: 'alice', query: { ...f.q, action: 'export', format: 'xlsx' } }));
    assert.equal(res.format, 'xlsx');
    assert.equal(res.mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.match(res.filename, /\.xlsx$/);
    assert.equal(res.encoding, 'base64');
    const buf = Buffer.from(res.content, 'base64');
    // A real ZIP/OOXML file, not a stub: starts with the ZIP local-file-header signature.
    assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const sheetNames = wb.worksheets.map((ws) => ws.name);
    assert.deepEqual(sheetNames, ['Participants', 'Expenses', 'Expense shares', 'Settlements', 'Outstanding balances']);

    const participants = wb.getWorksheet('Participants');
    const names = [];
    participants.eachRow((row, i) => { if (i > 1) names.push(row.getCell(1).value); });
    assert.ok(names.some((n) => n.startsWith('Alice')));
    assert.ok(names.some((n) => n.startsWith('Bob')));

    const expenses = wb.getWorksheet('Expenses');
    let expenseRow = null;
    expenses.eachRow((row, i) => { if (i > 1 && row.getCell(2).value === 'Fictional dinner') expenseRow = row; });
    assert.ok(expenseRow, 'the expense appears in the Expenses sheet');
    assert.equal(expenseRow.getCell(3).value, 'EUR');
    assert.equal(expenseRow.getCell(4).value, '90.00');
    // BT-009-13: "Original amount"/"Original currency"/"Exchange rate" sit between Amount and
    // Status, blank for a plain (non-foreign-currency) expense like this one.
    assert.equal(expenseRow.getCell(5).value, '');
    assert.equal(expenseRow.getCell(6).value, '');
    assert.equal(expenseRow.getCell(7).value, '');
    assert.equal(expenseRow.getCell(10).value, 'equal');

    const settlements = wb.getWorksheet('Settlements');
    let settleRow = null;
    settlements.eachRow((row, i) => { if (i > 1 && row.getCell(5).value === '20.00') settleRow = row; });
    assert.ok(settleRow, 'the settlement appears in the Settlements sheet');
    assert.equal(settleRow.getCell(6).value, 'reported');

    const balances = wb.getWorksheet('Outstanding balances');
    let balanceRows = 0;
    balances.eachRow((row, i) => { if (i > 1) balanceRows += 1; });
    assert.ok(balanceRows > 0, 'outstanding balances are included');
  });

  test('a description starting with a formula character is never turned into an XLSX formula (security review lesson carried forward, 2026-09-17)', async () => {
    const h = harness();
    const f = await fixture(h);
    await ok(await h.call('group', 'POST', {
      as: 'alice', query: f.q,
      body: { description: '=HYPERLINK("http://attacker.example")', amount: '10.00', date: '2026-09-10', payers: [{ ref: f.refs.alice, amount: '10.00' }], split: equal(f.refs.alice, f.refs.bob) },
    }), 201);
    const res = ok(await h.call('group', 'GET', { as: 'alice', query: { ...f.q, action: 'export', format: 'xlsx' } }));
    const buf = Buffer.from(res.content, 'base64');

    // Object-model proof: exceljs reads the cell back as a plain string, never as a formula, and
    // the text is stored byte-for-byte as written (no apostrophe or other neutralization applied
    // or needed for this format — see the comment above toXlsx() in sharedexport.js).
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const expenses = wb.getWorksheet('Expenses');
    let cell = null;
    expenses.eachRow((row, i) => { if (i > 1 && String(row.getCell(2).value).startsWith('=HYPERLINK')) cell = row.getCell(2); });
    assert.ok(cell, 'the hostile description is present as plain data');
    assert.equal(cell.value, '=HYPERLINK("http://attacker.example")');
    assert.equal(cell.type, ExcelJS.ValueType.String);
    assert.equal(cell.formula, undefined);

    // File-level proof: unzip the OOXML package and confirm the worksheet XML holds the text as a
    // shared/inline string, never inside a <f> (formula) element.
    const zip = await JSZip.loadAsync(buf);
    const sheetFiles = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    let sawFormulaTag = false;
    let sawTextSomewhere = false;
    for (const name of sheetFiles) {
      const xml = await zip.files[name].async('string');
      if (/<f[ >]/.test(xml)) sawFormulaTag = true;
    }
    const sharedStrings = zip.files['xl/sharedStrings.xml'] ? await zip.files['xl/sharedStrings.xml'].async('string') : '';
    if (sharedStrings.includes('HYPERLINK')) sawTextSomewhere = true;
    for (const name of sheetFiles) {
      const xml = await zip.files[name].async('string');
      if (xml.includes('HYPERLINK')) sawTextSomewhere = true;
    }
    assert.equal(sawFormulaTag, false, 'no worksheet XML may contain a <f> formula element anywhere in this workbook');
    assert.ok(sawTextSomewhere, 'the literal text is present somewhere in the package (shared strings or inline)');
  });

  test('PDF export includes the same data, with the correct mime type, filename and base64 encoding, and mirrors the export authorization; hostile text renders as plain content, never breaking out of the stream', async () => {
    const h = harness();
    const f = await fixture(h);
    await ok(await h.call('group', 'POST', {
      as: 'alice', query: f.q,
      body: { description: 'Fictional dinner (with parens) \\ and a =HYPERLINK("x") prefix', amount: '90.00', date: '2026-09-10', payers: [{ ref: f.refs.alice, amount: '90.00' }], split: equal(f.refs.alice, f.refs.bob) },
    }), 201);

    assert.equal((await h.call('group', 'GET', { as: 'eve', query: { ...f.q, action: 'export', format: 'pdf' } })).status, 404);

    const res = ok(await h.call('group', 'GET', { as: 'alice', query: { ...f.q, action: 'export', format: 'pdf' } }));
    assert.equal(res.format, 'pdf');
    assert.equal(res.mime, 'application/pdf');
    assert.match(res.filename, /\.pdf$/);
    assert.equal(res.encoding, 'base64');
    const buf = Buffer.from(res.content, 'base64');
    assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.match(buf.toString('latin1'), /%%EOF\s*$/, 'a well-formed, complete PDF trailer');

    // The content stream is written uncompressed (see toPdf()), so it can be inspected directly.
    // pdfkit's default font here (Helvetica/WinAnsi, drawn via `.text()`) writes every text run as
    // a HEX string (`<...>` before a Tj/TJ operator), not a parenthesized literal — confirmed by
    // generating this exact PDF and inspecting its bytes. That is a stronger guarantee than
    // character-escaping: raw text characters (letters, digits, `(`, `)`, `\`, `=`) never appear in
    // the content stream at all, only their hex byte codes, which cannot be interpreted as PDF
    // stream syntax (a string delimiter, an operator name, or anything else) under any
    // circumstance. Decoding every hex run in document order and concatenating them (TJ's numeric
    // kerning adjustments between runs never drop characters) recovers the original text exactly,
    // proving nothing was lost, corrupted or reinterpreted — while the RAW literal text is absent
    // from the stream bytes, proving it never took the literal-string path this test first assumed.
    const text = buf.toString('latin1');
    assert.equal(text.includes('Fictional dinner (with parens)'), false, 'hostile/plain text never appears unencoded in the content stream (it is always hex-encoded)');
    const hexRuns = [...text.matchAll(/<([0-9a-fA-F]+)>/g)].map((m) => m[1]);
    let decoded = '';
    for (const h of hexRuns) for (let i = 0; i < h.length; i += 2) decoded += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
    assert.ok(decoded.includes('Fictional dinner (with parens) \\ and a =HYPERLINK("x") prefix'), 'the exact original text is recoverable from the hex-encoded page content, byte for byte');
  });

  test('an unsupported format is refused for XLSX and PDF requests the same way as for CSV/JSON', async () => {
    const h = harness();
    const f = await fixture(h);
    const bad = await h.call('group', 'GET', { as: 'alice', query: { ...f.q, action: 'export', format: 'doc' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'invalid_format');
  });
});
