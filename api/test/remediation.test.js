'use strict';
// Regression tests for the independent milestone reviews of be22642 (financial F1–F12, security
// S1–S9). Expected values are computed by hand from the fictional fixtures, not from the code.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { harness, household } = require('./helpers');
const money = require('../_shared/money');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };

async function personal(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Alice Personal', kind: 'personal', reportingCurrency: 'EUR' } }), 201).workspace;
  const q = { workspaceId: ws.id };
  const acc = async (body) => ok(await h.call('accounts', 'POST', { as: 'alice', query: q, body }), 201).account;
  return {
    ws, q,
    checking: await acc({ name: 'Checking', type: 'checking', currency: 'EUR', openingBalance: '1500.00' }),
    card: await acc({ name: 'Card', type: 'credit-card', currency: 'EUR' }),
    yen: await acc({ name: 'Yen', type: 'cash', currency: 'JPY' }),
  };
}
const post = (h, f, body, as = 'alice', headers) => h.call('transactions', 'POST', { as, query: f.q, body, headers });
const balances = async (h, q, as = 'alice') => Object.fromEntries(ok(await h.call('accounts', 'GET', { as, query: q })).accounts.map((a) => [a.name, a.balance]));
const summaryFor = async (h, q, extra = {}) => ok(await h.call('transactions', 'GET', { as: 'alice', query: { ...q, ...extra } })).summary;

describe('financial review remediation', () => {
  test('F1 same-currency transfer cannot be unbalanced by toAmount; backups keep working', async () => {
    const h = harness();
    const f = await personal(h);
    const [out] = ok(await post(h, f, { accountId: f.checking.id, kind: 'transfer', amount: '120.00', transfer: { toAccountId: f.card.id } }), 201).transactions;
    const res = await h.call('transactions', 'PATCH', { as: 'alice', query: f.q, body: { transactionId: out.id, revision: 1, toAmount: '100.00' } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'invalid_transfer_edit');
    assert.deepEqual(await balances(h, f.q), { Checking: '1380.00', Card: '120.00', Yen: '0' });
    ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201);
  });

  test('F2 an entry that would overflow a balance is refused and the workspace stays readable', async () => {
    const h = harness();
    const f = await personal(h);
    const chf = ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Francs', type: 'savings', currency: 'CHF' } }), 201).account;
    ok(await post(h, f, { accountId: chf.id, kind: 'income', amount: '9999999999999.99' }), 201);
    const second = await post(h, f, { accountId: chf.id, kind: 'income', amount: '9999999999999.99' });
    assert.equal(second.status, 400);
    assert.equal(second.body.error.code, 'balance_out_of_range');
    assert.equal((await balances(h, f.q)).Francs, '9999999999999.99');
    ok(await h.call('transactions', 'GET', { as: 'alice', query: f.q }));
  });

  test('F3 a loan opens with the amount owed, never a positive balance', async () => {
    const h = harness();
    const f = await personal(h);
    const bad = await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Car loan', type: 'loan', currency: 'EUR', openingBalance: '20000.00' } });
    assert.equal(bad.body.error.code, 'invalid_opening_balance');
    ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Car loan', type: 'loan', currency: 'EUR', openingBalance: '-20000.00' } }), 201);
    const totals = ok(await h.call('accounts', 'GET', { as: 'alice', query: f.q })).totals;
    // 1500.00 checking + 0.00 card - 20000.00 loan = -18500.00
    assert.equal(totals.find((t) => t.currency === 'EUR').amount, '-18500.00');
  });

  test('F4 advances, reimbursements and adjustments are neither spending nor income', async () => {
    const h = harness();
    const f = await personal(h);
    for (const [kind, amount] of [['advance', '225.00'], ['reimbursement', '225.00'], ['adjustment', '-3.00']]) {
      ok(await post(h, f, { accountId: f.checking.id, kind, amount }), 201);
    }
    assert.deepEqual(await summaryFor(h, f.q), [{
      currency: 'EUR', count: 3, gross: '0.00', refunds: '0.00', net: '0.00', income: '0.00',
      adjustments: '-3.00', advances: '225.00', reimbursements: '225.00',
    }]);
    // 1500.00 - 225.00 + 225.00 - 3.00 = 1497.00
    assert.equal((await balances(h, f.q)).Checking, '1497.00');
  });

  test('F5 a merge preview reports what merging will actually produce', async () => {
    const h = harness();
    const f = await household(h);
    const archiveId = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201).archive.archiveId;
    ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.joint.id, kind: 'expense', amount: '10.00' } }), 201);
    const pv = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode: 'merge' } }));
    // Joint 1000.00 - 82.40 - 10.00 = 907.60, plus Alice Savings 5000.00 = 5907.60
    assert.deepEqual(pv.totalsAfter, [{ currency: 'EUR', amount: '5907.60' }]);
    assert.equal(pv.changes.remove, 0);
    assert.equal(pv.changes.add, 0);
  });

  test('F6 editing a cross-currency transfer refreshes its exchange context', async () => {
    const h = harness();
    const f = await personal(h);
    const [out] = ok(await post(h, f, { accountId: f.checking.id, kind: 'transfer', amount: '100.00', transfer: { toAccountId: f.yen.id, rate: '161.235' } }), 201).transactions;
    const edited = ok(await h.call('transactions', 'PATCH', { as: 'alice', query: f.q, body: { transactionId: out.id, revision: 1, amount: '50.00', toAmount: '9000' } })).transactions;
    const incoming = edited.find((t) => t.currency === 'JPY');
    assert.deepEqual(incoming.original, { amountMinor: 5000, currency: 'EUR', rate: null, rateSource: 'bank-posted', rateDate: incoming.date });
    const b = await balances(h, f.q);
    assert.equal(b.Checking, '1450.00');
    assert.equal(b.Yen, '9000');
  });

  test('F7 a category filter summarizes only the matching split lines', async () => {
    const h = harness();
    const f = await personal(h);
    const cats = ok(await h.call('categories', 'GET', { as: 'alice', query: f.q })).categories;
    const groceries = cats.find((c) => c.name === 'Groceries').id;
    const housing = cats.find((c) => c.name === 'Housing').id;
    ok(await post(h, f, { accountId: f.checking.id, kind: 'expense', amount: '50.00', splits: [{ categoryId: groceries, amount: '30.00' }, { categoryId: housing, amount: '20.00' }] }), 201);
    assert.equal((await summaryFor(h, f.q, { categoryId: housing }))[0].gross, '20.00');
    assert.equal((await summaryFor(h, f.q, { categoryId: groceries }))[0].gross, '30.00');
  });

  test('F8 account edits need the current revision; opening values lock once entries are reconciled', async () => {
    const h = harness();
    const f = await personal(h);
    const edit = (body) => h.call('accounts', 'PATCH', { as: 'alice', query: f.q, body: { accountId: f.checking.id, ...body } });
    assert.equal((await edit({ name: 'Main' })).body.error.code, 'missing_revision');
    assert.equal(ok(await edit({ revision: 1, name: 'Main' })).account.revision, 2);
    assert.equal((await edit({ revision: 1, name: 'Stale' })).body.error.code, 'stale_revision');
    const t = ok(await post(h, f, { accountId: f.checking.id, kind: 'expense', amount: '5.00' }), 201).transactions[0];
    ok(await h.call('transactions', 'PATCH', { as: 'alice', query: f.q, body: { transactionId: t.id, revision: 1, status: 'reconciled' } }));
    assert.equal((await edit({ revision: 2, openingBalance: '1400.00' })).body.error.code, 'reconciled_locked');
    assert.equal(ok(await edit({ revision: 2, name: 'Everyday' })).account.name, 'Everyday', 'non-financial edits still allowed');
  });

  test('F9 idempotency keys are bound to the operation and the request body', async () => {
    const h = harness();
    const f = await personal(h);
    ok(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: 'Wallet', type: 'cash', currency: 'EUR' }, headers: { 'Idempotency-Key': 'shared-key-0001' } }), 201);
    const crossRoute = await post(h, f, { accountId: f.checking.id, kind: 'expense', amount: '1.00' }, 'alice', { 'Idempotency-Key': 'shared-key-0001' });
    assert.equal(crossRoute.status, 409);
    assert.equal(crossRoute.body.error.code, 'idempotency_key_reused');
    const body = { accountId: f.checking.id, kind: 'expense', amount: '2.00' };
    const first = ok(await post(h, f, body, 'alice', { 'Idempotency-Key': 'txn-key-00001' }), 201);
    const again = ok(await post(h, f, body, 'alice', { 'Idempotency-Key': 'txn-key-00001' }), 201);
    assert.equal(again.replayed, true);
    assert.equal(again.transactions[0].id, first.transactions[0].id);
    const different = await post(h, f, { ...body, amount: '999.00' }, 'alice', { 'Idempotency-Key': 'txn-key-00001' });
    assert.equal(different.body.error.code, 'idempotency_key_reused');
    assert.equal((await balances(h, f.q)).Checking, '1498.00');
  });

  test('F10 amount filters work when currencies have different precision', async () => {
    const h = harness();
    const f = await personal(h);
    for (const [accountId, amount] of [[f.checking.id, '12.00'], [f.checking.id, '5.00'], [f.yen.id, '100']]) ok(await post(h, f, { accountId, kind: 'expense', amount }), 201);
    const atLeast = ok(await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, min: '10.50' } }));
    assert.deepEqual(atLeast.transactions.map((t) => t.amount).sort(), ['-100', '-12.00']);
    assert.equal(ok(await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, max: '10.50' } })).total, 1);
  });

  test('F11 backup integrity rejects wrong direction, broken counterparts and mixed-sign splits', async () => {
    const tampers = [
      (doc) => { doc.transactions.find((t) => t.kind === 'expense').amountMinor = 8240; },
      (doc, ids) => { doc.transactions.find((t) => t.transferId).counterpartAccountId = ids.bobCard; },
      (doc) => { const t = doc.transactions.find((x) => (x.splits || []).length); t.splits[0].amountMinor = -7000; t.splits[1].amountMinor = 2000; },
    ];
    for (const tamper of tampers) {
      const h = harness();
      const f = await household(h);
      ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.joint.id, kind: 'transfer', amount: '5.00', transfer: { toAccountId: f.aliceSavings.id } } }), 201);
      const cats = ok(await h.call('categories', 'GET', { as: 'alice', query: f.q })).categories;
      ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.joint.id, kind: 'expense', amount: '50.00', splits: [{ categoryId: cats[0].id, amount: '30.00' }, { categoryId: cats[1].id, amount: '20.00' }] } }), 201);
      const name = `workspaces/${f.ws.id}/workspace.json`;
      const { value } = await h.storage.getJson(name);
      tamper(value, { bobCard: f.bobCard.id });
      await h.storage.putJson(name, value);
      const res = await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} });
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'backup_invalid');
    }
  });

  test('F12 sums do not depend on the order of their inputs', () => {
    assert.equal(money.sum([1e15, 1, -1]), 1e15);
    assert.equal(money.sum([1, -1, 1e15]), 1e15);
    assert.throws(() => money.sum([1e15, 1]), /out of range/);
  });
});

describe('security review remediation', () => {
  test('S1 a member quota stops one person filling the workspace; removal still works at the cap', async () => {
    const h = harness({ env: { BT_MEMBER_QUOTA_BYTES: '6000' } });
    const f = await household(h);
    const carolCash = ok(await h.call('accounts', 'POST', { as: 'carol', query: f.q, body: { name: 'Carol Cash', type: 'cash', currency: 'EUR' } }), 201).account;
    let refused = null;
    for (let i = 0; i < 20 && !refused; i += 1) {
      const res = await h.call('transactions', 'POST', { as: 'carol', query: f.q, body: { accountId: carolCash.id, kind: 'expense', amount: '1.00', notes: 'x'.repeat(1000) } });
      if (res.status !== 201) refused = res;
    }
    assert.ok(refused, 'quota was reached');
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'member_quota_exceeded');

    const size = (await h.storage.getBytes(`workspaces/${f.ws.id}/workspace.json`)).bytes.length;
    h.env.BT_WORKSPACE_MAX_BYTES = String(size + 100);
    const full = await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.joint.id, kind: 'expense', amount: '1.00', notes: 'y'.repeat(2000) } });
    assert.equal(full.body.error.code, 'workspace_full');
    assert.equal((await h.call('members', 'DELETE', { as: 'alice', query: f.q, body: { memberId: f.memberId('Carol') } })).status, 200, 'owner can still remove a member at the cap');
  });

  test('S2 create-new copies no attachment that is not referenced by a restored record', async () => {
    const h = harness();
    const f = await household(h);
    const bytes = Buffer.from('FICTIONAL RECEIPT FOR ALICE');
    const sha = createHash('sha256').update(bytes).digest('hex');
    await h.storage.putBytes(`workspaces/${f.ws.id}/attachments/${sha}`, bytes);
    const archiveId = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201).archive.archiveId;
    const res = ok(await h.call('restore', 'POST', { as: 'bob', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId, mode: 'create-new' } }), 201);
    assert.deepEqual(await h.storage.list(`workspaces/${res.workspace.id}/attachments/`), []);
  });

  test('S3/S4 listings and member previews expose no out-of-scope counts; backup audit is manager-only', async () => {
    const h = harness();
    const f = await household(h);
    const archiveId = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201).archive.archiveId;
    const pv = ok(await h.call('restore', 'POST', { as: 'bob', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode: 'create-new' } }));
    for (const value of Object.values(pv.excluded)) assert.equal(typeof value, 'boolean');
    assert.ok(!JSON.stringify(pv).includes('archivedInvitations'));
    const bobAudit = ok(await h.call('audit', 'GET', { as: 'bob', query: f.q })).entries;
    const aliceAudit = ok(await h.call('audit', 'GET', { as: 'alice', query: f.q })).entries;
    assert.ok(!bobAudit.some((e) => e.action === 'backup.create'));
    assert.ok(aliceAudit.some((e) => e.action === 'backup.create'));
  });

  test('S5 a grantee sees the owner and their own access, not other grantees', async () => {
    const h = harness();
    const f = await household(h);
    for (const [name, caps] of [['Carol', ['view-balances']], ['Bob', ['view-transactions']]]) {
      ok(await h.call('grants', 'POST', { as: 'alice', query: f.q, body: { accountId: f.aliceSavings.id, memberId: f.memberId(name), capabilities: caps } }), 201);
    }
    const carolView = ok(await h.call('grants', 'GET', { as: 'carol', query: { ...f.q, accountId: f.aliceSavings.id } }));
    assert.deepEqual(carolView.people.map((p) => p.source).sort(), ['grant', 'owner']);
    assert.ok(carolView.people.find((p) => p.source === 'grant').member.self);
    assert.equal(carolView.grants, undefined);
    assert.equal(ok(await h.call('grants', 'GET', { as: 'alice', query: { ...f.q, accountId: f.aliceSavings.id } })).people.length, 3);
  });

  test('S6 site invitation and on-demand backup policies are enforced; recovery points still happen', async () => {
    const h = harness();
    const f = await household(h);
    const archiveId = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201).archive.archiveId;
    ok(await h.call('site-settings', 'PUT', { as: 'dave', body: { invitationPolicy: 'owners-only', backupPolicy: { onDemand: false } } }));
    ok(await h.call('members', 'PATCH', { as: 'alice', query: f.q, body: { memberId: f.memberId('Bob'), role: 'manager' } }));
    assert.equal((await h.call('invitations', 'POST', { as: 'bob', query: f.q, body: { email: 'new@example.com', role: 'viewer' } })).status, 403);
    ok(await h.call('invitations', 'POST', { as: 'alice', query: f.q, body: { email: 'new@example.com', role: 'viewer' } }), 201);
    assert.equal((await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} })).status, 403);
    const pv = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode: 'merge' } }));
    const done = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId, mode: 'merge', expectedEtag: pv.expectedEtag } }));
    assert.ok(done.recoveryPoint, 'the pre-restore recovery point is not an on-demand backup');
  });

  test('S7 the anonymous roles endpoint matches site administrators by subject only', async () => {
    const h = harness({ env: { BT_SITE_ADMINS: 'dave@example.com,google:g-root' } });
    const roles = async (body) => ok(await h.call('roles', 'POST', { body })).roles;
    assert.deepEqual(await roles({ identityProvider: 'google', userId: 'g-dave', userDetails: 'dave@example.com' }), []);
    assert.deepEqual(await roles({ identityProvider: 'google', userId: 'g-root', userDetails: 'someone@example.com' }), ['siteadmin']);
    assert.equal(ok(await h.call('me', 'GET', { as: 'dave' })).user.siteAdmin, true, 'the API still honours the configured email');
  });

  test('S8 a replace cannot split a cross-currency transfer that crosses the caller\'s scope', async () => {
    const h = harness();
    const f = await household(h);
    const bobYen = ok(await h.call('accounts', 'POST', { as: 'bob', query: f.q, body: { name: 'Bob Yen', type: 'cash', currency: 'JPY' } }), 201).account;
    const [out] = ok(await h.call('transactions', 'POST', { as: 'bob', query: f.q, body: { accountId: f.joint.id, kind: 'transfer', amount: '50.00', transfer: { toAccountId: bobYen.id, rate: '160' } } }), 201).transactions;
    const archiveId = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201).archive.archiveId;
    ok(await h.call('transactions', 'PATCH', { as: 'bob', query: f.q, body: { transactionId: out.id, revision: 1, amount: '40.00', toAmount: '6400' } }));
    const pv = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode: 'replace' } }));
    assert.equal(pv.canExecute, false);
    assert.match(pv.blockers[0], /recovery operator/);
  });

  test('S9 reference-only payees show only a name; a grantee\'s payee belongs to the account owner', async () => {
    const h = harness();
    const f = await household(h);
    ok(await h.call('payees', 'PATCH', { as: 'bob', query: f.q, body: { payeeId: f.secret.payeeId, notes: 'fictional private note', aliases: ['SJ'] } }));
    const grant = ok(await h.call('grants', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, memberId: f.memberId('Alice'), capabilities: ['view-transactions', 'create'] } }), 201).grant;
    const seen = ok(await h.call('payees', 'GET', { as: 'alice', query: f.q })).payees.find((p) => p.id === f.secret.payeeId);
    assert.equal(seen.name, 'Secret Jeweller');
    assert.equal(seen.notes, '');
    assert.deepEqual(seen.aliases, []);
    assert.equal(seen.referenceOnly, true);
    ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.bobCard.id, kind: 'expense', amount: '3.00', payeeName: 'Alice Shop' } }), 201);
    ok(await h.call('grants', 'DELETE', { as: 'bob', query: f.q, body: { grantId: grant.id } }));
    assert.ok(!ok(await h.call('payees', 'GET', { as: 'alice', query: f.q })).payees.some((p) => p.name === 'Alice Shop'));
    assert.ok(ok(await h.call('payees', 'GET', { as: 'bob', query: f.q })).payees.find((p) => p.name === 'Alice Shop').ownedBySelf);
  });
});
