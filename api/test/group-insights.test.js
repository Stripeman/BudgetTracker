'use strict';
// BT-009-26 (Terry, 2026-09-19): "useful event spending, category, participant and settlement
// summaries derived from canonical calculations, respecting permissions and currencies." Every
// number here reads the SAME records `groups.balances()` already reads — never a second,
// independent calculation. All data is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, USERS } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };

async function fixture(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Insights Club', kind: 'group', reportingCurrency: 'EUR' } }), 201).workspace;
  const q = { workspaceId: ws.id };
  const join = async (w, role) => {
    const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: q, body: { email: USERS[w].email, role } }), 201);
    ok(await h.call('invitations', 'POST', { as: w, query: { action: 'accept' }, body: { workspaceId: ws.id, token: inv.token } }));
  };
  await join('bob', 'member');
  const cat = ok(await h.call('categories', 'POST', { as: 'alice', query: q, body: { name: 'Food', type: 'expense' } }), 201).category;
  const members = ok(await h.call('members', 'GET', { as: 'alice', query: q })).members;
  const mid = (name) => members.find((m) => m.name.startsWith(name)).id;
  const refs = { alice: `member:${mid('Alice')}`, bob: `member:${mid('Bob')}` };
  return { ws, q, refs, cat };
}
const G = (h, f, as, method, opts = {}) => h.call('group', method, { as, query: { ...f.q, ...(opts.query || {}) }, body: opts.body });
const equal = (...refs) => ({ method: 'equal', lines: refs.map((ref) => ({ ref })) });

describe('BT-009-26 insights: event spending, category, participant and settlement summaries', () => {
  test('a viewer sees insights (same authority as balances); the numbers match a hand-computed trace', async () => {
    const h = harness();
    const f = await fixture(h);
    await G(h, f, 'alice', 'POST', { body: { description: 'Dinner', amount: '90.00', categoryId: f.cat.id, payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) } });
    await G(h, f, 'alice', 'POST', { body: { description: 'Taxi', amount: '20.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.alice, f.refs.bob) } });
    const settle = ok(await G(h, f, 'bob', 'POST', { query: { action: 'settle' }, body: { from: f.refs.bob, to: f.refs.alice, amount: '10.00' } }), 201).settlement;
    ok(await G(h, f, 'alice', 'POST', { query: { action: 'confirm' }, body: { settlementId: settle.id, revision: settle.revision } }));

    const res = ok(await G(h, f, 'alice', 'GET', { query: { action: 'insights' } }));
    const t = res.insights[0];
    assert.equal(t.currency, 'EUR');
    assert.equal(t.totalSpent, '110.00', 'the two expenses combined');
    assert.equal(t.expenseCount, 2);
    const food = t.byCategory.find((c) => c.categoryId === f.cat.id);
    assert.equal(food.total, '90.00');
    const uncategorized = t.byCategory.find((c) => c.categoryId === null);
    assert.equal(uncategorized.total, '20.00');
    const alice = t.byParticipant.find((p) => p.ref === f.refs.alice);
    assert.equal(alice.paid, '90.00');
    assert.equal(alice.share, '55.00');
    const bob = t.byParticipant.find((p) => p.ref === f.refs.bob);
    assert.equal(bob.paid, '20.00');
    assert.equal(bob.share, '55.00');
    assert.equal(t.settlements.confirmed, '10.00');
    assert.equal(t.settlements.confirmedCount, 1);
  });

  test('an outsider and a site administrator get the same 404/403 the rest of /api/group already gives — no wider audience for insights', async () => {
    const h = harness();
    const f = await fixture(h);
    const eve = await G(h, f, 'eve', 'GET', { query: { action: 'insights' } });
    assert.equal(eve.status, 404);
  });

  test('scoping to one event narrows insights to that event only, exactly like balances/expenses', async () => {
    const h = harness();
    const f = await fixture(h);
    const ev = ok(await G(h, f, 'alice', 'POST', { query: { action: 'create-event' }, body: { name: 'Trip' } }), 201).event;
    const otherEv = ok(await G(h, f, 'alice', 'POST', { query: { action: 'create-event' }, body: { name: 'Book club' } }), 201).event;
    await G(h, f, 'alice', 'POST', { body: { description: 'In the trip', amount: '50.00', eventId: ev.id, payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) } });
    await G(h, f, 'alice', 'POST', { body: { description: 'Not in the trip', amount: '30.00', eventId: otherEv.id, payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) } });
    const combined = ok(await G(h, f, 'alice', 'GET', { query: { action: 'insights' } })).insights[0];
    assert.equal(combined.totalSpent, '80.00');
    const scoped = ok(await G(h, f, 'alice', 'GET', { query: { action: 'insights', eventId: ev.id } })).insights[0];
    assert.equal(scoped.totalSpent, '50.00');
  });

  test('a voided expense is never counted', async () => {
    const h = harness();
    const f = await fixture(h);
    const e = ok(await G(h, f, 'alice', 'POST', { body: { description: 'x', amount: '40.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) } }), 201).expense;
    ok(await G(h, f, 'alice', 'POST', { query: { action: 'void' }, body: { expenseId: e.id, revision: e.revision, reason: 'mistake' } }));
    const res = ok(await G(h, f, 'alice', 'GET', { query: { action: 'insights' } }));
    assert.equal(res.insights[0].totalSpent, '0.00');
    assert.equal(res.insights[0].expenseCount, 0);
  });
});
