'use strict';
// BT-006-05 Remove an account (Terry, 2026-09-14: "i need a way to delete an account if there are no
// transactions against it" / "i just created the wrong one and now i cant remove it"). Removing is the
// existing soft removal (BT-001-05): never erased, reason required, kept in the account's history and
// recoverable. The account view says whether the account has anything recorded against it, only to
// people who can see its entries, and the list says how many removed accounts the caller may bring back.
// All data is fictional; expected values are worked out by hand.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const list = async (h, q, as, extra = {}) => ok(await h.call('accounts', 'GET', { as, query: { ...q, ...extra } }));
const remove = (h, q, as, body) => h.call('accounts', 'DELETE', { as, query: q, body });
const restore = (h, q, as, body) => h.call('accounts', 'POST', { as, query: { ...q, action: 'restore' }, body });
const create = async (h, q, as, body) => ok(await h.call('accounts', 'POST', { as, query: q, body }), 201).account;
const rawDoc = async (h, wsId) => JSON.parse((await h.storage.getBytes(`workspaces/${wsId}/workspace.json`)).bytes.toString());
const eurTotal = (body) => (body.totals.find((t) => t.currency === 'EUR') || {}).amount;

describe('BT-006-05 remove an account created by mistake', () => {
  test('a new account has no entries; the owner removes it with a reason and it leaves the list, the entry choices and the totals', async () => {
    const h = harness();
    const f = await household(h);
    // Alice sees Joint (1000.00 − 82.40 = 917.60) and Alice Savings (5000.00): 5917.60.
    assert.equal(eurTotal(await list(h, f.q, 'alice')), '5917.60');
    const mistake = await create(h, f.q, 'alice', { name: 'Wrong wallet', type: 'cash', currency: 'EUR', openingBalance: '25.00' });
    assert.equal(mistake.hasEntries, false, 'nothing recorded against a new account');
    const before = await list(h, f.q, 'alice');
    assert.equal(eurTotal(before), '5942.60', '5917.60 + 25.00');
    assert.equal(before.removedCount, 0);

    const out = ok(await remove(h, f.q, 'alice', { accountId: mistake.id, reason: 'Created by mistake' })).account;
    assert.ok(out.deletedAt, 'marked removed');

    const after = await list(h, f.q, 'alice');
    assert.equal(after.accounts.some((a) => a.id === mistake.id), false, 'not in the account list, so in no picker or dashboard');
    assert.equal(eurTotal(after), '5917.60', 'its 25.00 is out of the totals');
    assert.equal(after.removedCount, 1);
    const withRemoved = await list(h, f.q, 'alice', { includeDeleted: '1' });
    assert.deepEqual(withRemoved.accounts.filter((a) => a.deletedAt).map((a) => a.name), ['Wrong wallet']);
    assert.equal(eurTotal(withRemoved), '5917.60', 'listing removed accounts never counts them');
    // No new entries or bills on it.
    assert.equal((await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: mistake.id, kind: 'expense', amount: '1.00' } })).status, 404);
    assert.equal((await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: { name: 'Gym', accountId: mistake.id, amount: '1.00', schedule: { freq: 'monthly', startDate: '2026-10-01' } } })).status, 404);

    // Nothing is erased: the stored record keeps who, when and why.
    const stored = (await rawDoc(h, f.ws.id)).accounts.find((a) => a.id === mistake.id);
    assert.equal(stored.name, 'Wrong wallet');
    assert.equal(stored.deletedBy, 'google:g-alice');
    assert.deepEqual(stored.history.map((x) => [x.changes[0].field, x.changes[0].from, x.changes[0].to, x.reason]), [['deleted', false, true, 'Created by mistake']]);
  });

  test('bringing it back keeps its history and puts it back in the list and the totals', async () => {
    const h = harness();
    const f = await household(h);
    const mistake = await create(h, f.q, 'alice', { name: 'Wrong wallet', type: 'cash', currency: 'EUR', openingBalance: '25.00' });
    ok(await remove(h, f.q, 'alice', { accountId: mistake.id, reason: 'Created by mistake' }));
    const back = ok(await restore(h, f.q, 'alice', { accountId: mistake.id })).account;
    assert.equal(back.deletedAt, null);
    const after = await list(h, f.q, 'alice');
    assert.equal(after.accounts.find((a) => a.id === mistake.id).name, 'Wrong wallet');
    assert.equal(eurTotal(after), '5942.60');
    assert.equal(after.removedCount, 0);
    const stored = (await rawDoc(h, f.ws.id)).accounts.find((a) => a.id === mistake.id);
    assert.deepEqual(stored.history.map((x) => [x.changes[0].from, x.changes[0].to, x.reason]), [[false, true, 'Created by mistake'], [true, false, '']]);
    const log = (await rawDoc(h, f.ws.id)).audit.filter((e) => e.targetId === mistake.id).map((e) => e.action);
    assert.deepEqual(log, ['account.create', 'account.delete', 'account.restore']);
  });

  test('hasEntries: any entry (deleted ones too), a bill from or into it, or a grant given counts; it is shown only to people who can see the entries', async () => {
    const h = harness();
    const f = await household(h);
    const fresh = async (name, as = 'alice', visibility = 'private') => create(h, f.q, as, { name, type: 'checking', currency: 'EUR', visibility });
    const viewOf = async (id, as = 'alice') => (await list(h, f.q, as, { includeDeleted: '1' })).accounts.find((a) => a.id === id);

    const withDeleted = await fresh('Entry then deleted');
    const t = ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: withDeleted.id, kind: 'expense', amount: '4.00' } }), 201).transactions[0];
    ok(await h.call('transactions', 'DELETE', { as: 'alice', query: f.q, body: { transactionId: t.id, revision: t.revision, reason: 'Typed in the wrong account' } }));
    assert.equal((await viewOf(withDeleted.id)).hasEntries, true, 'a deleted entry is still an entry: it is kept');

    const billFrom = await fresh('Bill from');
    ok(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: { name: 'Fictional gym', accountId: billFrom.id, amount: '9.00', schedule: { freq: 'monthly', startDate: '2026-10-01' } } }), 201);
    assert.equal((await viewOf(billFrom.id)).hasEntries, true);

    const billInto = await fresh('Bill into');
    ok(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: { name: 'Fictional saving', accountId: f.aliceSavings.id, toAccountId: billInto.id, amount: '50.00', schedule: { freq: 'monthly', startDate: '2026-10-01' } } }), 201);
    assert.equal((await viewOf(billInto.id)).hasEntries, true);

    const granted = await fresh('Shared with Bob');
    ok(await h.call('grants', 'POST', { as: 'alice', query: f.q, body: { accountId: granted.id, memberId: f.memberId('Bob'), capabilities: ['view-balances'] } }), 201);
    assert.equal((await viewOf(granted.id)).hasEntries, true);
    const bobsView = (await list(h, f.q, 'bob')).accounts.find((a) => a.id === granted.id);
    assert.ok(bobsView, 'Bob sees the account through his grant');
    assert.equal('hasEntries' in bobsView, false, 'without view-transactions Bob is not told whether anything is recorded');

    const empty = await fresh('Still empty');
    assert.equal((await viewOf(empty.id)).hasEntries, false);
    // The shared Joint has Alice's grocery entry: every member who sees its entries is told.
    for (const who of ['alice', 'bob', 'carol']) assert.equal((await list(h, f.q, who)).accounts.find((a) => a.id === f.joint.id).hasEntries, true, who);
  });

  test('a manager removes a shared account; a member, a viewer, another member, the site administrator and an outsider cannot', async () => {
    const h = harness();
    const f = await household(h);
    const shared = await create(h, f.q, 'alice', { name: 'Shared by mistake', type: 'savings', currency: 'EUR', visibility: 'shared' });
    const reason = { accountId: shared.id, reason: 'Created by mistake' };
    assert.equal((await remove(h, f.q, 'bob', reason)).status, 403, 'a plain member does not manage shared lists by default');
    assert.equal((await remove(h, f.q, 'carol', reason)).status, 403, 'a viewer never');
    assert.equal((await remove(h, f.q, 'dave', reason)).status, 404, 'the site administrator is not a member');
    assert.equal((await remove(h, f.q, 'eve', reason)).status, 404, 'an outsider');
    assert.equal((await remove(h, f.q, 'bob', { accountId: f.aliceSavings.id, reason: 'x' })).status, 404, "Alice's private account is not found for Bob");
    assert.equal((await remove(h, f.q, 'alice', { accountId: f.bobCard.id, reason: 'x' })).status, 404, "the workspace owner cannot reach Bob's private card");
    assert.equal((await list(h, f.q, 'bob')).removedCount, 0);

    ok(await h.call('members', 'PATCH', { as: 'alice', query: f.q, body: { memberId: f.memberId('Bob'), role: 'manager' } }));
    ok(await remove(h, f.q, 'bob', reason));
    assert.equal((await list(h, f.q, 'carol')).accounts.some((a) => a.id === shared.id), false, 'gone for everyone');
    assert.equal((await list(h, f.q, 'carol')).removedCount, 0, 'a viewer may not bring it back, so it is not counted for her');
    assert.equal((await list(h, f.q, 'carol', { includeDeleted: '1' })).accounts.some((a) => a.id === shared.id), false);
    assert.equal((await list(h, f.q, 'bob')).removedCount, 1);
    assert.equal((await list(h, f.q, 'alice')).removedCount, 1);
    assert.equal((await restore(h, f.q, 'carol', { accountId: shared.id })).status, 403);
    ok(await restore(h, f.q, 'alice', { accountId: shared.id }));
    assert.equal((await list(h, f.q, 'carol')).accounts.some((a) => a.id === shared.id), true);
  });

  test('another member never learns of a removed private account', async () => {
    const h = harness();
    const f = await household(h);
    const mistake = await create(h, f.q, 'alice', { name: 'Wrong wallet', type: 'cash', currency: 'EUR' });
    ok(await remove(h, f.q, 'alice', { accountId: mistake.id, reason: 'Created by mistake' }));
    for (const who of ['bob', 'carol']) {
      const body = await list(h, f.q, who, { includeDeleted: '1' });
      assert.equal(body.accounts.some((a) => a.id === mistake.id), false, who);
      assert.equal(body.removedCount, 0, who);
    }
    assert.equal((await restore(h, f.q, 'bob', { accountId: mistake.id })).status, 404);
  });
});
