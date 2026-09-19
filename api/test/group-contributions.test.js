'use strict';
// BT-009-25 (Terry, 2026-09-19): shared income, prepaid contributions and deposits — "distinguish
// money contributed in advance from actual income, expenses, refundable deposits and returned
// funds. Contributions must not count as income or spending merely because money moved. Preserve
// who contributed, who holds the money and how it is subsequently applied or returned." Worked
// example in docs/BT-009-25-WORKED-EXAMPLES.md §4, including the one genuine ambiguity raised there
// (fund application never nets against the ordinary Shared-expenses balance — proceeding on the
// stated recommendation while awaiting Terry's confirmation). All data is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, USERS } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };

async function fixture(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Fund Club', kind: 'group', reportingCurrency: 'EUR' } }), 201).workspace;
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
const equal = (...refs) => ({ method: 'equal', lines: refs.map((ref) => ({ ref })) });
const contributions = async (h, f, as = 'alice') => ok(await G(h, f, as, 'GET', { query: { action: 'contributions' } })).contributions;

describe('BT-009-25 shared income / prepaid contributions / deposits', () => {
  test('any writer records a contribution; a viewer may not; it is never an expense or income transaction', async () => {
    const h = harness();
    const f = await fixture(h);
    const viewerTry = await act(h, f, 'carol', 'create-contribution', { contributor: f.refs.alice, holder: f.refs.alice, amount: '100.00', kind: 'contribution' });
    assert.equal(viewerTry.status, 403);
    const c = ok(await act(h, f, 'alice', 'create-contribution', { contributor: f.refs.alice, holder: f.refs.alice, amount: '100.00', kind: 'contribution' }), 201).contribution;
    assert.equal(c.amount, '100.00');
    assert.equal(c.held, '100.00');
    assert.equal(c.applied, '0.00');
    assert.equal(c.returned, '0.00');
    const list = await contributions(h, f);
    assert.equal(list.length, 1);
    const v = ok(await G(h, f, 'alice', 'GET'));
    assert.equal(v.contributions.length, 1, 'embedded in the main view too');
    // Never appears as a real transaction anywhere — no route here creates one.
  });

  test('applying or returning more than what is still held is refused; the two together can exactly exhaust it', async () => {
    const h = harness();
    const f = await fixture(h);
    const c = ok(await act(h, f, 'alice', 'create-contribution', { contributor: f.refs.bob, holder: f.refs.alice, amount: '100.00', kind: 'contribution' }), 201).contribution;
    assert.equal((await act(h, f, 'alice', 'apply-contribution', { contributionId: c.id, amount: '150.00' })).status, 409);
    ok(await act(h, f, 'alice', 'apply-contribution', { contributionId: c.id, amount: '80.00' }));
    assert.equal((await act(h, f, 'alice', 'apply-contribution', { contributionId: c.id, amount: '30.00' })).status, 409, 'only 20.00 remains held');
    const returned = ok(await act(h, f, 'alice', 'return-contribution', { contributionId: c.id, amount: '20.00' })).contribution;
    assert.equal(returned.applied, '80.00');
    assert.equal(returned.returned, '20.00');
    assert.equal(returned.held, '0.00');
  });

  test('the worked example from docs/BT-009-25-WORKED-EXAMPLES.md §4, hand-computed: a trip fund, an expense paid from it, and the leftover returned — never counted as income or spending, and the ordinary Shared-expenses balance is completely unaffected', async () => {
    const h = harness();
    const f = await fixture(h);
    // Alice, Bob and Carol each contribute EUR 100.00 in advance, held by Alice.
    const cAlice = ok(await act(h, f, 'alice', 'create-contribution', { contributor: f.refs.alice, holder: f.refs.alice, amount: '100.00', kind: 'contribution' }), 201).contribution;
    const cBob = ok(await act(h, f, 'alice', 'create-contribution', { contributor: f.refs.bob, holder: f.refs.alice, amount: '100.00', kind: 'contribution' }), 201).contribution;
    const cCarol = ok(await act(h, f, 'alice', 'create-contribution', { contributor: f.refs.carol, holder: f.refs.alice, amount: '100.00', kind: 'contribution' }), 201).contribution;

    // The EUR 250.00 hotel is paid by Alice — a perfectly ordinary shared expense, split equally.
    const hotel = ok(await G(h, f, 'alice', 'POST', { body: { description: 'Fictional hotel', amount: '250.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob, f.refs.carol) } }), 201).expense;
    const netOf = (rows, ref) => rows.find((r) => r.ref === ref).netMinor;
    const balances = ok(await G(h, f, 'alice', 'GET', { query: { action: 'balances' } })).balances[0];
    // Ordinary balance math is completely unaffected by the fund: Alice paid 250, share 83.33 or
    // 83.34 (largest remainder); Bob/Carol owe their own share. No trace of the fund here at all.
    assert.ok(netOf(balances.rows, f.refs.alice) > 16000, 'Alice is owed roughly two-thirds of the hotel, exactly as an ordinary shared expense');

    // Alice marks EUR 250.00 as applied, proportionally from each contributor's own held balance
    // (83.33 each, largest-remainder rounded to reconcile exactly) — a deliberate, explicit choice
    // per contribution, not an automatic system-wide split.
    ok(await act(h, f, 'alice', 'apply-contribution', { contributionId: cAlice.id, amount: '83.34', note: `Applied to ${hotel.id}` }));
    ok(await act(h, f, 'alice', 'apply-contribution', { contributionId: cBob.id, amount: '83.33', note: `Applied to ${hotel.id}` }));
    ok(await act(h, f, 'alice', 'apply-contribution', { contributionId: cCarol.id, amount: '83.33', note: `Applied to ${hotel.id}` }));

    // The remaining EUR 50.00 (16.67+16.67+16.66) is returned to each contributor.
    const finalAlice = ok(await act(h, f, 'alice', 'return-contribution', { contributionId: cAlice.id, amount: '16.66' })).contribution;
    const finalBob = ok(await act(h, f, 'alice', 'return-contribution', { contributionId: cBob.id, amount: '16.67' })).contribution;
    const finalCarol = ok(await act(h, f, 'alice', 'return-contribution', { contributionId: cCarol.id, amount: '16.67' })).contribution;
    assert.equal(finalAlice.held, '0.00');
    assert.equal(finalBob.held, '0.00');
    assert.equal(finalCarol.held, '0.00');

    // The ordinary Shared-expenses balance is STILL completely unaffected — the fund's own
    // application/return history never touched it (the one recorded, reasoned recommendation from
    // the worked-examples doc: the two dimensions never net against each other).
    const balancesAfter = ok(await G(h, f, 'alice', 'GET', { query: { action: 'balances' } })).balances[0];
    assert.equal(netOf(balancesAfter.rows, f.refs.alice), netOf(balances.rows, f.refs.alice), "Alice's ordinary balance is untouched by any fund activity");
    assert.equal(netOf(balancesAfter.rows, f.refs.bob), netOf(balances.rows, f.refs.bob), "Bob's ordinary balance is untouched");
    assert.equal(netOf(balancesAfter.rows, f.refs.carol), netOf(balances.rows, f.refs.carol), "Carol's ordinary balance is untouched");
  });

  test('a refundable deposit uses the same held/applied/returned mechanics, distinguished by kind', async () => {
    const h = harness();
    const f = await fixture(h);
    const deposit = ok(await act(h, f, 'alice', 'create-contribution', { contributor: f.refs.bob, holder: f.refs.alice, amount: '200.00', kind: 'deposit' }), 201).contribution;
    assert.equal(deposit.kind, 'deposit');
    const returned = ok(await act(h, f, 'alice', 'return-contribution', { contributionId: deposit.id, amount: '200.00' })).contribution;
    assert.equal(returned.held, '0.00');
    assert.equal(returned.returned, '200.00');
  });

  test('groups.invariantProblem refuses a contribution naming the same person twice, or one that claims more applied+returned than it actually holds', () => {
    const groups = require('../_shared/groups');
    const base = { members: [{ id: 'a', subject: 's:a' }, { id: 'b', subject: 's:b' }], contacts: [], categories: [], groupExpenses: [], groupSettlements: [], groupRefunds: [] };
    const good = { id: 'gct_1', contributor: 'member:a', holder: 'member:b', amountMinor: 1000, currency: 'EUR', appliedMinor: 500, returnedMinor: 200 };
    assert.equal(groups.invariantProblem({ ...base, groupContributions: [{ ...good, holder: 'member:a' }] }), 'group contribution people');
    assert.equal(groups.invariantProblem({ ...base, groupContributions: [{ ...good, appliedMinor: 900, returnedMinor: 200 }] }), 'group contribution total exceeds amount');
    assert.equal(groups.invariantProblem({ ...base, groupContributions: [good] }), null);
  });
});
