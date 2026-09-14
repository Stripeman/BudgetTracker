'use strict';
// BT-009 shared-expense workflow settings (Terry, 2026-09-14: "build all 10"; this branch builds b to e,
// the group-level ones). Every setting's default is today's behaviour; each other value changes one
// rule, enforced by the server; viewers are never given more. Every expected value is computed by hand
// in the comments. All people, amounts and names are fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, USERS } = require('./helpers');

const FRANK = Object.freeze({ userId: 'g-frank', email: 'frank@example.com', name: 'Frank Fictional' });
const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const who = (w) => (typeof w === 'string' ? { as: w } : { user: w });

// Alice owner, Bob member, Carol viewer, Frank manager, Eve member, Dana a shared contact: six active people.
async function fixture(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Settings Club', kind: 'group', reportingCurrency: 'EUR' } }), 201).workspace;
  const q = { workspaceId: ws.id };
  const join = async (w, role) => {
    const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: q, body: { email: (typeof w === 'string' ? USERS[w] : w).email, role } }), 201);
    ok(await h.call('invitations', 'POST', { ...who(w), query: { action: 'accept' }, body: { workspaceId: ws.id, token: inv.token } }));
  };
  await join('bob', 'member');
  await join('carol', 'viewer');
  await join(FRANK, 'manager');
  await join('eve', 'member');
  const members = ok(await h.call('members', 'GET', { as: 'alice', query: q })).members;
  const mid = (name) => members.find((m) => m.name.startsWith(name)).id;
  const dana = ok(await h.call('contacts', 'POST', { as: 'alice', body: { scope: 'workspace', workspaceId: ws.id, name: 'Dana Contact' } }), 201).contact;
  const refs = { alice: `member:${mid('Alice')}`, bob: `member:${mid('Bob')}`, carol: `member:${mid('Carol')}`, frank: `member:${mid('Frank')}`, eve: `member:${mid('Eve')}`, dana: dana.ref };
  return { ws, q, refs, mid };
}

const G = (h, f, w, method, { query = {}, body } = {}) => h.call('group', method, { ...who(w), query: { ...f.q, ...query }, body });
const act = (h, f, w, action, body) => G(h, f, w, 'POST', { query: { action }, body });
const setSettings = (h, f, w, changes, reason) => act(h, f, w, 'settings', { changes, ...(reason ? { reason } : {}) });
const view = async (h, f, w = 'alice') => ok(await G(h, f, w, 'GET'));
const equal = (...refs) => ({ method: 'equal', lines: refs.map((ref) => ({ ref })) });
const addExpense = async (h, f, w, body) => ok(await G(h, f, w, 'POST', { body }), 201).expense;
const settle = async (h, f, w, body) => ok(await act(h, f, w, 'settle', body), 201).settlement;
const confirm = (h, f, w, s) => act(h, f, w, 'confirm', { settlementId: s.id, revision: s.revision });
const voidPayment = (h, f, w, s) => act(h, f, w, 'void', { settlementId: s.id, revision: s.revision, reason: 'Probe' });
const dispute = (h, f, w, s) => act(h, f, w, 'dispute', { settlementId: s.id, revision: s.revision, reason: 'Not received' });
const latest = async (h, f, s) => (await view(h, f)).settlements.find((x) => x.id === s.id);
const nets = async (h, f) => Object.fromEntries((await view(h, f)).balances.find((b) => b.currency === 'EUR').rows.map((r) => [r.name, r.net]));
const stored = async (h, f) => (await h.storage.getJson(`workspaces/${f.ws.id}/workspace.json`)).value;

describe('the ten settings: the group-level ones, their defaults and older documents', () => {
  test('every new setting is listed with today\'s behaviour as its default and a one-sentence explanation; a group that never changed them reads the defaults', async () => {
    const h = harness();
    const f = await fixture(h);
    const gs = (await view(h, f)).groupSettings;
    // With "Who can settle a disputed payment" (financial recheck F1) among the payment rules.
    assert.deepEqual(gs.settings.map((s) => [s.key, s.value, s.default]), [
      ['anyoneConfirms', true, true], ['ownedEntries', 'shared-only', 'shared-only'],
      ['splitMethod', 'equal', 'equal'], ['splitWho', 'everyone', 'everyone'], ['paidBy', 'me', 'me'],
      ['changeExpenses', 'author-or-manager', 'author-or-manager'],
      ['withdrawPayments', 'receiver-or-manager', 'receiver-or-manager'], ['disputePayments', 'receiver', 'receiver'], ['settleDisputes', 'receiver', 'receiver'], ['receiverConfirms', true, true],
      ['countReported', true, true],
    ]);
    for (const s of gs.settings.slice(2)) assert.match(s.explanation, /^[A-Z][^.]{20,}\.$/, `${s.key}: one plain sentence`);
    assert.deepEqual(gs.settings.find((s) => s.key === 'withdrawPayments').options.map((o) => o.value), ['receiver-or-manager', 'receiver', 'confirmers']);
    // Nothing was ever stored for this group: the document has no settings object at all.
    assert.equal((await stored(h, f)).groupSettings, undefined);
  });

  test('a change to two of them is one audited write with both keys, kept in the history; the document\'s schemaVersion is unchanged', async () => {
    const h = harness();
    const f = await fixture(h);
    const before = (await stored(h, f)).schemaVersion;
    ok(await setSettings(h, f, FRANK, { splitWho: 'me', countReported: false }, 'Try it'));
    const doc = await stored(h, f);
    assert.equal(doc.schemaVersion, before);
    assert.deepEqual(doc.audit.filter((a) => a.action === 'group.settings.update').map((a) => a.fields), [['splitWho', 'countReported']]);
    assert.deepEqual((await view(h, f)).groupSettings.history.map((x) => [x.by, x.key, x.from, x.to, x.reason]), [
      ['Frank Fictional', 'splitWho', 'everyone', 'me', 'Try it'], ['Frank Fictional', 'countReported', true, false, 'Try it'],
    ]);
    // Members and viewers cannot change them; unknown values are refused.
    assert.equal((await setSettings(h, f, 'bob', { paidBy: 'nobody' })).status, 403);
    assert.equal((await setSettings(h, f, 'carol', { paidBy: 'nobody' })).status, 403);
    for (const [k, v] of [['splitMethod', 'thirds'], ['splitWho', 'someone'], ['paidBy', 'you'], ['changeExpenses', 'anyone'], ['withdrawPayments', 'nobody'], ['disputePayments', 'payer'], ['receiverConfirms', 'yes'], ['countReported', 1]]) {
      assert.equal((await setSettings(h, f, 'alice', { [k]: v })).status, 400, k);
    }
  });
});

describe('(b) the default split for new expenses', () => {
  test('left out of a request, the payer and split come from the group\'s defaults; given, they are used as given', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob } = f.refs;
    // Defaults: paid by me (Alice), shared equally by everyone active (six people): 60.00 / 6 = 10.00 each.
    // Alice +60.00 − 10.00 = +50.00; everyone else −10.00.
    const e = await addExpense(h, f, 'alice', { description: 'Fictional pizza', amount: '60.00' });
    assert.deepEqual(e.payers.map((p) => [p.ref, p.amount]), [[alice, '60.00']]);
    assert.equal(e.split.method, 'equal');
    assert.deepEqual(await nets(h, f), { 'Alice Fictional': '50.00', 'Bob Fictional': '-10.00', 'Carol Fictional': '-10.00', 'Frank Fictional': '-10.00', 'Eve Outsider': '-10.00', 'Dana Contact': '-10.00' });
    // Only me by default: Bob's 30.00 is his alone, so nobody's balance moves.
    ok(await setSettings(h, f, 'alice', { splitWho: 'me' }));
    const mine = await addExpense(h, f, 'bob', { description: 'Fictional snack', amount: '30.00' });
    assert.deepEqual(mine.shares.map((s) => [s.ref, s.amount]), [[bob, '30.00']]);
    assert.equal((await nets(h, f))['Bob Fictional'], '-10.00');
    // Given explicitly, the request wins over the default: 20.00 split by Alice and Bob, 10.00 each.
    const given = await addExpense(h, f, 'bob', { description: 'Fictional tea', amount: '20.00', payers: [{ ref: bob }], split: equal(alice, bob) });
    assert.deepEqual(given.shares.map((s) => s.amount), ['10.00', '10.00']);
  });

  test('with nobody as the default payer, or a default method that needs amounts, a request that leaves them out is refused; a viewer still cannot add', async () => {
    const h = harness();
    const f = await fixture(h);
    ok(await setSettings(h, f, 'alice', { paidBy: 'nobody' }));
    assert.equal((await G(h, f, 'alice', 'POST', { body: { description: 'Fictional lunch', amount: '10.00' } })).status, 400);
    ok(await setSettings(h, f, 'alice', { paidBy: 'me', splitMethod: 'shares' }));
    assert.equal((await G(h, f, 'alice', 'POST', { body: { description: 'Fictional lunch', amount: '10.00' } })).status, 400);
    assert.equal((await G(h, f, 'carol', 'POST', { body: { description: 'Fictional lunch', amount: '10.00', payers: [{ ref: f.refs.carol }], split: equal(f.refs.carol) } })).status, 403);
    assert.equal((await view(h, f)).expenses.length, 0, 'nothing was written');
  });

  test('each person may keep their own defaults as personal preferences: validated, and cleared back to the group\'s', async () => {
    const h = harness();
    const prefs = { groupSplitMethod: 'shares', groupSplitWho: 'me', groupPaidBy: 'nobody', groupBalanceView: 'direct' };
    const put = (body) => h.call('preferences', 'PUT', { as: 'bob', body });
    ok(await put(prefs));
    const eff = ok(await h.call('preferences', 'GET', { as: 'bob' })).effective;
    assert.deepEqual(Object.fromEntries(Object.keys(prefs).map((k) => [k, eff[k]])), prefs);
    for (const [k, v] of [['groupSplitMethod', 'thirds'], ['groupSplitWho', 'everybody'], ['groupPaidBy', 'you'], ['groupBalanceView', 'fewest']]) assert.equal((await put({ [k]: v })).status, 400, k);
    ok(await put({ groupSplitMethod: null, groupSplitWho: null, groupPaidBy: null, groupBalanceView: null }));
    const cleared = ok(await h.call('preferences', 'GET', { as: 'bob' })).effective;
    assert.deepEqual(Object.keys(prefs).map((k) => cleared[k]), [null, null, null, null], 'back to the group\'s defaults and Fewest payments');
    // Alice's are untouched by Bob's.
    assert.equal(ok(await h.call('preferences', 'GET', { as: 'alice' })).effective.groupBalanceView, null);
  });
});

describe('(c) who may correct or void a shared expense', () => {
  test('by default only the person who added it or a manager or owner; with "any member who can add expenses", Bob corrects and Eve voids Alice\'s expense; a viewer never', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob } = f.refs;
    const e = await addExpense(h, f, 'alice', { description: 'Fictional dinner', amount: '40.00', payers: [{ ref: alice }], split: equal(alice, bob) });
    const correct = (w, rec, description) => G(h, f, w, 'PATCH', { body: { expenseId: rec.id, revision: rec.revision, description, reason: 'Wording' } });
    const voidIt = (w, rec) => act(h, f, w, 'void', { expenseId: rec.id, revision: rec.revision, reason: 'Duplicate' });
    assert.equal((await correct('bob', e, 'Fictional dinner (Bob)')).status, 403);
    assert.equal((await voidIt('eve', e)).status, 403);
    ok(await setSettings(h, f, 'alice', { changeExpenses: 'any-writer' }));
    const fixed = ok(await correct('bob', e, 'Fictional dinner (Bob)')).expense;
    assert.equal(fixed.description, 'Fictional dinner (Bob)');
    assert.equal((await correct('carol', fixed, 'Viewer')).status, 403, 'a viewer never');
    assert.equal((await voidIt('carol', fixed)).status, 403, 'a viewer never');
    const voided = ok(await voidIt('eve', fixed)).expense;
    assert.deepEqual([voided.status, voided.voidedBy], ['void', 'Eve Outsider']);
    const hist = ok(await G(h, f, 'alice', 'GET', { query: { action: 'history', expenseId: e.id } })).history.map((x) => [x.by, x.event]);
    assert.deepEqual(hist.slice(-2), [['Bob Fictional', 'update'], ['Eve Outsider', 'void']], 'each action attributed');
  });
});

describe('(d) payment rules', () => {
  test('a payment recorded by its receiver is confirmed at once by default, and only reported when that is off', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob } = f.refs;
    assert.equal((await settle(h, f, 'alice', { from: bob, to: alice, amount: '20.00' })).status, 'confirmed');
    ok(await setSettings(h, f, 'alice', { receiverConfirms: false }));
    const s = await settle(h, f, 'alice', { from: bob, to: alice, amount: '20.00' });
    assert.equal(s.status, 'reported');
    // Balances count confirmed payments only: Bob paid 20.00 confirmed, so no expense means Bob +20.00, Alice −20.00.
    assert.deepEqual([(await nets(h, f))['Alice Fictional'], (await nets(h, f))['Bob Fictional']], ['-20.00', '20.00']);
    assert.equal(ok(await confirm(h, f, 'alice', s)).settlement.status, 'confirmed');
  });

  test('withdrawing a confirmed payment: receiver or manager (default), receiver only, or anyone who can confirm; a viewer never', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob, dana } = f.refs;
    const confirmed = async (from, to) => { const s = await settle(h, f, 'bob', { from, to, amount: '5.00' }); return ok(await confirm(h, f, 'alice', s)).settlement; };
    // Default: Eve (a member, not the receiver) cannot; Frank (a manager) can.
    const a = await confirmed(bob, alice);
    assert.equal((await voidPayment(h, f, 'eve', a)).status, 403);
    assert.equal(ok(await voidPayment(h, f, FRANK, a)).settlement.withdrawn, true);
    // Receiver only: Frank cannot withdraw Alice's; Alice can; for a contact, a manager acts for them.
    ok(await setSettings(h, f, 'alice', { withdrawPayments: 'receiver' }));
    const b = await confirmed(bob, alice);
    assert.equal((await voidPayment(h, f, FRANK, b)).status, 403);
    assert.equal(ok(await voidPayment(h, f, 'alice', b)).settlement.withdrawn, true);
    const c = await confirmed(bob, dana);
    assert.equal(ok(await voidPayment(h, f, FRANK, c)).settlement.withdrawn, true);
    // Anyone who can confirm (the group setting is on): Eve can; Carol, a viewer, cannot.
    ok(await setSettings(h, f, 'alice', { withdrawPayments: 'confirmers' }));
    const d = await confirmed(bob, alice);
    assert.equal((await voidPayment(h, f, 'carol', d)).status, 403);
    assert.equal(ok(await voidPayment(h, f, 'eve', d)).settlement.withdrawn, true);
    // ... but not someone set to No for confirming.
    ok(await setSettings(h, f, 'alice', { confirmOverrides: { [f.mid('Eve')]: 'no' } }));
    const g = await confirmed(bob, alice);
    assert.equal((await voidPayment(h, f, 'eve', g)).status, 403);
    assert.equal((await latest(h, f, g)).canVoid, true, 'Alice, the receiver, still may');
  });

  test('disputing: the receiver (default), or also a manager or owner; a viewer still disputes a payment made to them', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob, carol } = f.refs;
    const a = await settle(h, f, 'bob', { from: bob, to: alice, amount: '7.00' });
    assert.equal((await dispute(h, f, FRANK, a)).status, 403);
    ok(await setSettings(h, f, 'alice', { disputePayments: 'receiver-or-manager' }));
    assert.equal((await dispute(h, f, 'eve', a)).status, 403, 'a member who is not the receiver');
    assert.equal(ok(await dispute(h, f, FRANK, a)).settlement.status, 'disputed');
    const b = await settle(h, f, 'bob', { from: bob, to: carol, amount: '3.00' });
    assert.equal(ok(await dispute(h, f, 'carol', b)).settlement.status, 'disputed');
  });
});

describe('(e) counting a reported payment when suggesting who pays whom', () => {
  test('on (default): a reported 30.00 from Bob is counted as paid; off: suggestions and the direct view count confirmed payments only', async () => {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob, carol } = f.refs;
    // 90.00 paid by Alice, shared by Alice, Bob and Carol: 30.00 each. Alice +60.00, Bob −30.00, Carol −30.00.
    await addExpense(h, f, 'alice', { description: 'Fictional dinner', amount: '90.00', payers: [{ ref: alice }], split: equal(alice, bob, carol) });
    await settle(h, f, 'bob', { from: bob, to: alice, amount: '30.00' });
    const pairs = (list) => list.map((x) => [x.from, x.to, x.amount]);
    const eur = async () => (await view(h, f)).balances.find((b) => b.currency === 'EUR');
    let t = await eur();
    assert.deepEqual([pairs(t.suggestions), pairs(t.direct)], [[[carol, alice, '30.00']], [[carol, alice, '30.00']]]);
    ok(await setSettings(h, f, 'alice', { countReported: false }));
    t = await eur();
    assert.deepEqual([pairs(t.suggestions), pairs(t.direct)], [[[bob, alice, '30.00'], [carol, alice, '30.00']], [[bob, alice, '30.00'], [carol, alice, '30.00']]]);
    // The balances themselves count confirmed payments only either way.
    assert.deepEqual(t.rows.filter((r) => [alice, bob, carol].includes(r.ref)).map((r) => r.net), ['60.00', '-30.00', '-30.00']);
    assert.match((await view(h, f)).basis, /Reported payments are not counted until they are confirmed/);
  });
});
