'use strict';
// BT-009-26 (Terry, 2026-09-19): in-app reminders / payment requests — "begin with authorized
// in-app functionality. If external delivery needs a provider or credentials, identify that exact
// dependency and finish the in-app workflow meanwhile. Do not send real messages to contacts
// without explicit authorization." This record is fully in-app: it sends no email, SMS or push (no
// delivery provider or credentials are configured for this workspace — that exact dependency is
// documented, never silently faked) and never moves money or changes a balance itself; only an
// actual ?action=settle does that. All data is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, USERS } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };

async function fixture(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Reminder Club', kind: 'group', reportingCurrency: 'EUR' } }), 201).workspace;
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
  return { ws, q, refs };
}
const G = (h, f, as, method, opts = {}) => h.call('group', method, { as, query: { ...f.q, ...(opts.query || {}) }, body: opts.body });
const act = (h, f, as, action, body) => G(h, f, as, 'POST', { query: { action }, body });
const requests = async (h, f, as = 'alice') => ok(await G(h, f, as, 'GET', { query: { action: 'payment-requests' } })).paymentRequests;

describe('BT-009-26 in-app payment reminders / requests', () => {
  test('the person owed money sends a reminder to the person who owes it; a viewer may not; it moves no money', async () => {
    const h = harness();
    const f = await fixture(h);
    const viewerTry = await act(h, f, 'carol', 'create-payment-request', { from: f.refs.bob, to: f.refs.carol, amount: '20.00' });
    assert.equal(viewerTry.status, 403);
    const wrongPerson = await act(h, f, 'alice', 'create-payment-request', { from: f.refs.bob, to: f.refs.carol, amount: '20.00' });
    assert.equal(wrongPerson.status, 403, 'Alice cannot send a reminder on Carol\'s behalf — Carol is not a contact she manages');
    const r = ok(await act(h, f, 'alice', 'create-payment-request', { from: f.refs.bob, to: f.refs.alice, amount: '20.00', note: 'Fictional dinner split' }), 201).paymentRequest;
    assert.equal(r.status, 'open');
    assert.equal(r.amount, '20.00');
    assert.equal(r.from, f.refs.bob);
    assert.equal(r.to, f.refs.alice);
    assert.equal(r.createdBySelf, true, "Alice sent it, so it reads as her own from her own view");
    const bobsView = (await requests(h, f, 'bob')).find((x) => x.id === r.id);
    assert.equal(bobsView.createdBySelf, false, "Bob did not send it");
    const list = await requests(h, f);
    assert.equal(list.length, 1);
    const v = ok(await G(h, f, 'alice', 'GET'));
    assert.equal(v.paymentRequests.length, 1, 'embedded in the main view too');
    // Never appears as a transaction, expense, settlement or balance change anywhere — no route
    // here touches any of them.
    const balances = ok(await G(h, f, 'alice', 'GET', { query: { action: 'balances' } })).balances[0];
    assert.ok(balances.rows.every((row) => row.netMinor === 0), 'no shared expense or payment exists yet, so there is nothing to owe — a reminder alone changes nothing');
  });

  test('the same two people cannot be named twice, and needs two different people', async () => {
    const h = harness();
    const f = await fixture(h);
    const same = await act(h, f, 'alice', 'create-payment-request', { from: f.refs.alice, to: f.refs.alice, amount: '10.00' });
    assert.equal(same.status, 400);
    assert.equal(same.body.error.code, 'invalid_request');
  });

  test('only the person being reminded can dismiss it; only its sender or a manager/owner can cancel it; a resolved one cannot be resolved again', async () => {
    const h = harness();
    const f = await fixture(h);
    const r = ok(await act(h, f, 'alice', 'create-payment-request', { from: f.refs.bob, to: f.refs.alice, amount: '20.00' }), 201).paymentRequest;
    const aliceTryDismiss = await act(h, f, 'alice', 'dismiss-payment-request', { requestId: r.id });
    assert.equal(aliceTryDismiss.status, 403, 'only Bob (the one being reminded) may dismiss it');
    const bobTryCancel = await act(h, f, 'bob', 'cancel-payment-request', { requestId: r.id });
    assert.equal(bobTryCancel.status, 403, 'Bob did not send it and is not a manager or owner');
    const dismissed = ok(await act(h, f, 'bob', 'dismiss-payment-request', { requestId: r.id })).paymentRequest;
    assert.equal(dismissed.status, 'dismissed');
    assert.ok(dismissed.respondedAt);
    const again = await act(h, f, 'bob', 'dismiss-payment-request', { requestId: r.id });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'already_resolved');
  });

  test('its own sender (a manager or owner) can cancel an open reminder', async () => {
    const h = harness();
    const f = await fixture(h);
    const r = ok(await act(h, f, 'alice', 'create-payment-request', { from: f.refs.bob, to: f.refs.alice, amount: '20.00' }), 201).paymentRequest;
    const cancelled = ok(await act(h, f, 'alice', 'cancel-payment-request', { requestId: r.id })).paymentRequest;
    assert.equal(cancelled.status, 'cancelled');
  });

  test('a manager or owner may send a reminder on behalf of a contact who is owed money', async () => {
    const h = harness();
    const f = await fixture(h);
    const contact = ok(await h.call('contacts', 'POST', { as: 'alice', body: { scope: 'workspace', workspaceId: f.ws.id, name: 'Fictional Dana' } }), 201).contact;
    const dana = `contact:${contact.id}`;
    const r = ok(await act(h, f, 'alice', 'create-payment-request', { from: f.refs.bob, to: dana, amount: '15.00' }), 201).paymentRequest;
    assert.equal(r.to, dana);
    assert.equal(r.status, 'open');
  });

  test('groups.invariantProblem refuses two identical people, an invalid amount, or an unknown status', () => {
    const groups = require('../_shared/groups');
    const base = { members: [{ id: 'a', subject: 's:a' }, { id: 'b', subject: 's:b' }], contacts: [], categories: [], groupExpenses: [], groupSettlements: [], groupRefunds: [], groupContributions: [] };
    const good = { id: 'gpr_1', from: 'member:a', to: 'member:b', amountMinor: 1000, currency: 'EUR', status: 'open' };
    assert.equal(groups.invariantProblem({ ...base, groupPaymentRequests: [{ ...good, from: 'member:b' }] }), 'group payment request people');
    assert.equal(groups.invariantProblem({ ...base, groupPaymentRequests: [{ ...good, amountMinor: 0 }] }), 'group payment request amount');
    assert.equal(groups.invariantProblem({ ...base, groupPaymentRequests: [{ ...good, status: 'not-a-status' }] }), 'group payment request status');
    assert.equal(groups.invariantProblem({ ...base, groupPaymentRequests: [good] }), null);
  });
});
