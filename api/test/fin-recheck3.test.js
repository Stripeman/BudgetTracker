'use strict';
// Financial recheck of 53cf181 (N-1 to N-4 and the personal-defaults note). Every expected value is
// computed by hand in the comments. All people, accounts and amounts are fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, USERS } = require('./helpers');

const FRANK = Object.freeze({ userId: 'g-frank', email: 'frank@example.com', name: 'Frank Fictional' });
const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const who = (w) => (typeof w === 'string' ? { as: w } : { user: w });

// Alice owner, Bob member, Carol viewer, Frank manager, Eve member, Dana a shared contact.
async function fixture(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Recheck Three', kind: 'group', reportingCurrency: 'EUR' } }), 201).workspace;
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
const view = async (h, f, w = 'alice') => ok(await G(h, f, w, 'GET'));

describe('N-4: "Anyone who can confirm payments" says plainly that it includes the person who paid', () => {
  test('both settings that offer it return the option\'s explanation "This includes the person who paid."; no other option carries one', async () => {
    const h = harness();
    const f = await fixture(h);
    const settings = (await view(h, f)).groupSettings.settings;
    const explained = settings.flatMap((s) => (s.options || []).filter((o) => o.explanation).map((o) => [s.key, o.value, o.explanation]));
    assert.deepEqual(explained, [
      ['withdrawPayments', 'confirmers', 'This includes the person who paid.'],
      ['settleDisputes', 'confirmers', 'This includes the person who paid.'],
    ]);
  });
});

const act = (h, f, w, action, body) => G(h, f, w, 'POST', { query: { action }, body });
const setSettings = (h, f, w, changes) => act(h, f, w, 'settings', { changes });
const equal = (...refs) => ({ method: 'equal', lines: refs.map((ref) => ({ ref })) });
const addExpense = async (h, f, w, body) => ok(await G(h, f, w, 'POST', { body }), 201).expense;
const settle = async (h, f, w, body) => ok(await act(h, f, w, 'settle', body), 201).settlement;

describe('N-3: "Keep who owes whom" counts a reported payment only up to what is owed, like the suggestions', () => {
  // 90.00 paid by Alice, shared by Alice, Bob and Carol: 30.00 each. Bob owes Alice 30.00, Carol 30.00.
  async function dinner() {
    const h = harness();
    const f = await fixture(h);
    const { alice, bob, carol } = f.refs;
    await addExpense(h, f, 'alice', { description: 'Fictional dinner', amount: '90.00', payers: [{ ref: alice }], split: equal(alice, bob, carol) });
    return { h, f, alice, bob, carol };
  }
  const tables = async (x) => { const t = (await view(x.h, x.f)).balances.find((b) => b.currency === 'EUR'); const pairs = (l) => l.map((p) => [p.from, p.to, p.amount]); return { direct: pairs(t.direct), suggestions: pairs(t.suggestions) }; };

  test('Bob reports 50.00 against his 30.00 debt: both views show only Carol pays Alice 30.00, never Alice pays Bob', async () => {
    const x = await dinner();
    await settle(x.h, x.f, 'bob', { from: x.bob, to: x.alice, amount: '50.00' });
    assert.deepEqual(await tables(x), { direct: [[x.carol, x.alice, '30.00']], suggestions: [[x.carol, x.alice, '30.00']] });
  });

  test('a report below the debt counts in full; two reports count in order, the second only up to what is left', async () => {
    const x = await dinner();
    await settle(x.h, x.f, 'bob', { from: x.bob, to: x.alice, amount: '10.00' });
    // 30.00 − 10.00 = 20.00 left from Bob; Carol 30.00.
    assert.deepEqual((await tables(x)).direct, [[x.bob, x.alice, '20.00'], [x.carol, x.alice, '30.00']]);
    const y = await dinner();
    await settle(y.h, y.f, 'bob', { from: y.bob, to: y.alice, amount: '20.00' });
    await settle(y.h, y.f, 'bob', { from: y.bob, to: y.alice, amount: '20.00' });
    // 20.00 counts in full, the second only up to the 10.00 left: Bob owes nothing more.
    assert.deepEqual((await tables(y)).direct, [[y.carol, y.alice, '30.00']]);
  });

  test('with reported payments not counted (setting e off), the direct view counts confirmed payments only', async () => {
    const x = await dinner();
    await settle(x.h, x.f, 'bob', { from: x.bob, to: x.alice, amount: '50.00' });
    ok(await setSettings(x.h, x.f, 'alice', { countReported: false }));
    assert.deepEqual((await tables(x)).direct, [[x.bob, x.alice, '30.00'], [x.carol, x.alice, '30.00']]);
  });
});
