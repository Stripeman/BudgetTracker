'use strict';
// BT-014 Part A (Terry, 2026-09-17): "Before either deletion or disconnection, offer the deleting
// workspace a download of its authorized shared-expense information in PDF, CSV, or XLSX format.
// Include participants, dates, descriptions, currencies, amounts, splits, settlements, and
// outstanding balances." CSV and JSON only in this version — see api/_shared/sharedexport.js for
// why XLSX/PDF are deferred. All data is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
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
    const bad = await h.call('group', 'GET', { as: 'alice', query: { ...f.q, action: 'export', format: 'pdf' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'invalid_format');
  });
});
