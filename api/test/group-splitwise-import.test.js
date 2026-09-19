'use strict';
// BT-009-26 (Terry, 2026-09-19): Splitwise import — "start with the specified Splitwise import,
// including mapping, validation, duplicate detection and a non-mutating preview before confirmed
// import." No live Splitwise API/credentials are used or needed: this reads the plain CSV a member
// exports from Splitwise themselves (Date, Description, Category, Cost, Currency, then one column
// per person holding their own net change for the row). All data is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, USERS } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const csv = (header, rows) => [header.join(','), ...rows.map((r) => r.join(','))].join('\n');

async function fixture(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Import Club', kind: 'group', reportingCurrency: 'EUR' } }), 201).workspace;
  const q = { workspaceId: ws.id };
  const join = async (w, role) => {
    const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: q, body: { email: USERS[w].email, role } }), 201);
    ok(await h.call('invitations', 'POST', { as: w, query: { action: 'accept' }, body: { workspaceId: ws.id, token: inv.token } }));
  };
  await join('bob', 'member');
  await join('carol', 'viewer');
  const members = ok(await h.call('members', 'GET', { as: 'alice', query: q })).members;
  const mid = (name) => members.find((m) => m.name.startsWith(name)).id;
  const refs = { alice: `member:${mid('Alice')}`, bob: `member:${mid('Bob')}`, carol: `member:${mid('Carol')}` };
  const mapping = { Alice: refs.alice, Bob: refs.bob, Carol: refs.carol };
  return { ws, q, refs, mapping };
}
const G = (h, f, as, method, opts = {}) => h.call('group', method, { as, query: { ...f.q, ...(opts.query || {}) }, body: opts.body });
const act = (h, f, as, action, body) => G(h, f, as, 'POST', { query: { action }, body });
const HEADER = ['Date', 'Description', 'Category', 'Cost', 'Currency', 'Alice', 'Bob', 'Carol'];

describe('BT-009-26 Splitwise import', () => {
  test('preview never mutates anything; a viewer may not preview or confirm', async () => {
    const h = harness();
    const f = await fixture(h);
    const file = csv(HEADER, [['2026-09-01', 'Fictional Dinner', 'Food', '90.00', 'EUR', '60.00', '-30.00', '-30.00']]);
    const viewerTry = await act(h, f, 'carol', 'preview-import', { csv: file, mapping: f.mapping });
    assert.equal(viewerTry.status, 403);
    const preview = ok(await act(h, f, 'alice', 'preview-import', { csv: file, mapping: f.mapping }));
    assert.equal(preview.rows.length, 1);
    assert.equal(preview.rows[0].ok, true);
    assert.equal(preview.rows[0].kind, 'expense');
    const expensesAfter = ok(await G(h, f, 'alice', 'GET')).expenses;
    assert.equal(expensesAfter.length, 0, 'preview never creates a real expense');
    const viewerConfirmTry = await act(h, f, 'carol', 'confirm-import', { csv: file, mapping: f.mapping, rows: [0] });
    assert.equal(viewerConfirmTry.status, 403);
  });

  test('a single-payer expense row is planned correctly, and confirming it creates the real expense with the real shares', async () => {
    const h = harness();
    const f = await fixture(h);
    const file = csv(HEADER, [['2026-09-01', 'Fictional Dinner', 'Food', '90.00', 'EUR', '60.00', '-30.00', '-30.00']]);
    const preview = ok(await act(h, f, 'alice', 'preview-import', { csv: file, mapping: f.mapping }));
    const row = preview.rows[0];
    assert.equal(row.amount, '90.00');
    assert.equal(row.duplicateOf, null);
    const confirmed = ok(await act(h, f, 'alice', 'confirm-import', { csv: file, mapping: f.mapping, rows: [0] }), 201);
    assert.equal(confirmed.imported.length, 1);
    assert.equal(confirmed.skipped.length, 0);
    const expenses = ok(await G(h, f, 'alice', 'GET')).expenses;
    assert.equal(expenses.length, 1);
    const e = expenses[0];
    assert.equal(e.description, 'Fictional Dinner');
    assert.equal(e.amount, '90.00');
    assert.equal(e.payers.length, 1);
    assert.equal(e.payers[0].ref, f.refs.alice);
    assert.deepEqual(e.shares.map((s) => s.amount).sort(), ['30.00', '30.00', '30.00']);
    assert.match(e.notes, /Imported from Splitwise/);
  });

  test('a payment row (category "Payment") is planned as a settlement, not an expense, and confirming it creates the real payment', async () => {
    const h = harness();
    const f = await fixture(h);
    const file = csv(HEADER, [['2026-09-02', 'Payment', 'Payment', '20.00', 'EUR', '', '20.00', '-20.00']]);
    const preview = ok(await act(h, f, 'alice', 'preview-import', { csv: file, mapping: f.mapping }));
    const row = preview.rows[0];
    assert.equal(row.kind, 'settlement');
    assert.equal(row.from, f.refs.bob);
    assert.equal(row.to, f.refs.carol);
    assert.equal(row.amount, '20.00');
    const confirmed = ok(await act(h, f, 'alice', 'confirm-import', { csv: file, mapping: f.mapping, rows: [0] }), 201);
    assert.equal(confirmed.imported[0].kind, 'settlement');
    const settlements = ok(await G(h, f, 'alice', 'GET')).settlements;
    assert.equal(settlements.length, 1);
    assert.equal(settlements[0].from, f.refs.bob);
    assert.equal(settlements[0].to, f.refs.carol);
    assert.equal(settlements[0].amount, '20.00');
  });

  test('a row in a currency other than the workspace reporting currency is refused, never guessed', async () => {
    const h = harness();
    const f = await fixture(h);
    const file = csv(HEADER, [['2026-09-01', 'Fictional Hotel', 'Travel', '100.00', 'USD', '50.00', '-50.00', '']]);
    const preview = ok(await act(h, f, 'alice', 'preview-import', { csv: file, mapping: f.mapping }));
    assert.equal(preview.rows[0].ok, false);
    assert.equal(preview.rows[0].reason, 'unsupported_currency');
    const confirmed = ok(await act(h, f, 'alice', 'confirm-import', { csv: file, mapping: f.mapping, rows: [0] }), 200);
    assert.equal(confirmed.imported.length, 0);
    assert.equal(confirmed.skipped.length, 1);
    assert.equal(confirmed.skipped[0].reason, 'unsupported_currency');
  });

  test('a row naming a person not yet mapped is refused with a clear message naming that person, and mapping them fixes it', async () => {
    const h = harness();
    const f = await fixture(h);
    const file = csv(HEADER, [['2026-09-01', 'Fictional Snacks', 'Food', '10.00', 'EUR', '5.00', '-5.00', '']]);
    const partialMapping = { Alice: f.refs.alice, Bob: f.refs.bob }; // Carol not mapped, but her column is blank here anyway
    const preview = ok(await act(h, f, 'alice', 'preview-import', { csv: file, mapping: partialMapping }));
    assert.equal(preview.rows[0].ok, true, 'Carol has no value in this row, so she is not actually involved');

    const file3 = csv(HEADER, [['2026-09-01', 'Fictional Snacks', 'Food', '10.00', 'EUR', '', '5.00', '-5.00']]);
    const unmapped = ok(await act(h, f, 'alice', 'preview-import', { csv: file3, mapping: { Alice: f.refs.alice } }));
    assert.equal(unmapped.rows[0].reason, 'unmapped_person');
    assert.match(unmapped.rows[0].message, /Bob/);
    assert.match(unmapped.rows[0].message, /Carol/);

    const fixed = ok(await act(h, f, 'alice', 'preview-import', { csv: file3, mapping: f.mapping }));
    assert.equal(fixed.rows[0].ok, true, 'mapping the missing person fixes the row');
  });

  test('multiple payers on one row cannot be reconstructed automatically and are refused, never guessed', async () => {
    const h = harness();
    const f = await fixture(h);
    const file = csv(HEADER, [['2026-09-01', 'Fictional Groceries', 'Food', '30.00', 'EUR', '10.00', '10.00', '-20.00']]);
    const preview = ok(await act(h, f, 'alice', 'preview-import', { csv: file, mapping: f.mapping }));
    assert.equal(preview.rows[0].ok, false);
    assert.equal(preview.rows[0].reason, 'multiple_payers');
  });

  test('duplicate detection flags a row that matches an expense already recorded, but confirming it anyway is still honored (advisory, never a hard block)', async () => {
    const h = harness();
    const f = await fixture(h);
    const equal3 = { method: 'equal', lines: [{ ref: f.refs.alice }, { ref: f.refs.bob }, { ref: f.refs.carol }] };
    const existing = ok(await G(h, f, 'alice', 'POST', { body: { description: 'Fictional Dinner', date: '2026-09-01', amount: '90.00', payers: [{ ref: f.refs.alice }], split: equal3 } }), 201).expense;
    const file = csv(HEADER, [['2026-09-01', 'Fictional Dinner', 'Food', '90.00', 'EUR', '60.00', '-30.00', '-30.00']]);
    const preview = ok(await act(h, f, 'alice', 'preview-import', { csv: file, mapping: f.mapping }));
    assert.equal(preview.rows[0].duplicateOf, existing.id);
    assert.equal(preview.summary.duplicates, 1);
    const confirmed = ok(await act(h, f, 'alice', 'confirm-import', { csv: file, mapping: f.mapping, rows: [0] }), 201);
    assert.equal(confirmed.imported.length, 1, 'flagged as a likely duplicate, but the explicit choice to import it anyway is honored');
    const expenses = ok(await G(h, f, 'alice', 'GET')).expenses;
    assert.equal(expenses.length, 2, 'both the original and the imported copy exist — nothing was silently merged or dropped');
  });

  test('Splitwise\'s own running-total summary row is recognized and skipped, never treated as a transaction', async () => {
    const h = harness();
    const f = await fixture(h);
    const rows = [['', 'Total balance', '', '', 'EUR', '10.00', '-5.00', '-5.00'], ['2026-09-01', 'Fictional Coffee', 'Food', '6.00', 'EUR', '3.00', '-3.00', '']];
    const file = csv(HEADER, rows);
    const preview = ok(await act(h, f, 'alice', 'preview-import', { csv: file, mapping: f.mapping }));
    assert.equal(preview.rows.length, 2);
    assert.equal(preview.rows[0].skip, true);
    assert.equal(preview.rows[0].reason, 'summary_row');
    assert.equal(preview.rows[1].ok, true);
  });

  test('a file missing a required Splitwise column, or with no person columns at all, is refused up front', async () => {
    const h = harness();
    const f = await fixture(h);
    const noCoreCol = 'Date,Description,Category,Currency,Alice,Bob\n2026-09-01,Fictional,Food,EUR,5.00,-5.00';
    const missing = await act(h, f, 'alice', 'preview-import', { csv: noCoreCol, mapping: f.mapping });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.code, 'invalid_csv');

    const noPeople = 'Date,Description,Category,Cost,Currency\n2026-09-01,Fictional,Food,5.00,EUR';
    const noOne = await act(h, f, 'alice', 'preview-import', { csv: noPeople, mapping: {} });
    assert.equal(noOne.status, 400);
    assert.equal(noOne.body.error.code, 'invalid_csv');
  });

  test('confirming a mix of importable and refused rows imports only the real ones, and reports the rest as skipped with a reason', async () => {
    const h = harness();
    const f = await fixture(h);
    const rows = [
      ['2026-09-01', 'Fictional Dinner', 'Food', '90.00', 'EUR', '60.00', '-30.00', '-30.00'],
      ['2026-09-02', 'Fictional Taxi', 'Travel', '100.00', 'USD', '50.00', '-50.00', ''],
    ];
    const file = csv(HEADER, rows);
    const confirmed = ok(await act(h, f, 'alice', 'confirm-import', { csv: file, mapping: f.mapping, rows: [0, 1] }), 201);
    assert.equal(confirmed.imported.length, 1);
    assert.equal(confirmed.skipped.length, 1);
    assert.equal(confirmed.skipped[0].index, 1);
    assert.equal(confirmed.skipped[0].reason, 'unsupported_currency');
  });
});
