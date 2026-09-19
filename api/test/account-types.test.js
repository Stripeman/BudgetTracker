'use strict';
// BT-019-02 (Terry, 2026-09-19): workspace-scoped account TYPE definitions — a name, an editable
// colour and an optional icon, each mapped to one of the fixed underlying accounting classes this
// codebase already has (api/_shared/ledger.js ACCOUNT_TYPES). The type is presentation; the
// accounting class drives every balance/direction/opening-balance/liability rule, kept strictly
// separate — renaming or recolouring a type never touches a single account or transaction, and
// changing a type's own accounting class once it is in use is refused, explained, never silently
// applied. All data is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household, USERS } = require('./helpers');
const ledger = require('../_shared/ledger');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const types = async (h, q, as = 'alice') => ok(await h.call('account-types', 'GET', { as, query: q })).types;
const createType = (h, q, as, body) => h.call('account-types', 'POST', { as, query: q, body });
const patchType = (h, q, as, body) => h.call('account-types', 'PATCH', { as, query: q, body });
const createAccount = (h, q, as, body) => h.call('accounts', 'POST', { as, query: q, body });
const patchAccount = (h, q, as, body) => h.call('accounts', 'PATCH', { as, query: q, body });

describe('BT-019-02 account types', () => {
  test('every fixed accounting class has a real, named, coloured, iconed system default, even before any real write has touched them', async () => {
    const h = harness();
    const f = await household(h);
    const list = await types(h, f.q);
    assert.equal(new Set(list.map((t) => t.accountingClass)).size, ledger.ACCOUNT_TYPES.length, 'one system type per fixed accounting class');
    for (const c of ledger.ACCOUNT_TYPES) {
      const t = list.find((x) => x.accountingClass === c);
      assert.ok(t, `system type for ${c}`);
      assert.equal(t.system, true);
      assert.equal(t.retired, false);
      assert.match(t.color, /^#[0-9a-f]{6}$/);
      assert.ok(t.icon, `${c} has a default icon`);
    }
    const checking = list.find((t) => t.accountingClass === 'checking');
    assert.equal(checking.name, 'Checking');
    // The household fixture already created a checking, savings and credit-card account (by raw
    // `type`, with no accountTypeId — every existing caller keeps working unchanged) — those do NOT
    // count toward a system type's own inUse/usageCount, since they were never linked to it by id.
    assert.equal(checking.inUse, false);
  });

  test('a viewer may not create or change an account type; owners and managers may', async () => {
    const h = harness();
    const f = await household(h);
    code(await createType(h, f.q, 'carol', { name: 'Store Card', accountingClass: 'credit-card' }), 403, 'forbidden');
    const t = ok(await createType(h, f.q, 'alice', { name: 'Store Card', accountingClass: 'credit-card' }), 201).type;
    code(await patchType(h, f.q, 'carol', { typeId: t.id, name: 'x' }), 403, 'forbidden');
    const renamed = ok(await patchType(h, f.q, 'alice', { typeId: t.id, name: 'Retail Card' })).type;
    assert.equal(renamed.name, 'Retail Card');
  });

  test('a custom type is coloured/iconed like a category, validated the same way, and reset to its own default', async () => {
    const h = harness();
    const f = await household(h);
    code(await createType(h, f.q, 'alice', { name: 'Store Card', accountingClass: 'credit-card', color: 'blue' }), 400, 'invalid_color');
    code(await createType(h, f.q, 'alice', { name: 'Store Card', accountingClass: 'credit-card', color: '#ffff00' }), 400, 'color_contrast');
    const t = ok(await createType(h, f.q, 'alice', { name: 'Store Card', accountingClass: 'credit-card', color: '#DC2626' }), 201).type;
    assert.deepEqual([t.color, t.colorSource], ['#dc2626', 'workspace']);
    const reset = ok(await patchType(h, f.q, 'alice', { typeId: t.id, color: null })).type;
    assert.equal(reset.colorSource, 'default');
  });

  test('a system type can never be retired, and its own accounting class can never change', async () => {
    const h = harness();
    const f = await household(h);
    const checking = (await types(h, f.q)).find((t) => t.accountingClass === 'checking');
    code(await patchType(h, f.q, 'alice', { typeId: checking.id, retired: true }), 400, 'system_type_locked');
    code(await patchType(h, f.q, 'alice', { typeId: checking.id, accountingClass: 'savings' }), 400, 'system_type_locked');
    // Renaming and recolouring a system type is still allowed — only its own identity/behaviour is locked.
    const renamed = ok(await patchType(h, f.q, 'alice', { typeId: checking.id, name: 'Everyday Checking' })).type;
    assert.equal(renamed.name, 'Everyday Checking');
  });

  test('a custom type\'s own accounting class can change only while unused; once an account uses it, the change is refused and explained, never silently applied', async () => {
    const h = harness();
    const f = await household(h);
    const t = ok(await createType(h, f.q, 'alice', { name: 'Store Card', accountingClass: 'credit-card' }), 201).type;
    const changed = ok(await patchType(h, f.q, 'alice', { typeId: t.id, accountingClass: 'loan' })).type;
    assert.equal(changed.accountingClass, 'loan');
    const account = ok(await createAccount(h, f.q, 'alice', { name: 'Fictional Store Card', accountTypeId: t.id, currency: 'EUR' }), 201).account;
    assert.equal(account.type, 'loan');
    const inUse = (await types(h, f.q)).find((x) => x.id === t.id);
    assert.equal(inUse.inUse, true);
    assert.equal(inUse.usageCount, 1);
    code(await patchType(h, f.q, 'alice', { typeId: t.id, accountingClass: 'credit-card' }), 409, 'account_type_in_use');
    // Renaming/recolouring the same, now-in-use type is still completely unaffected by that lock —
    // and never changes the account's own stored accounting class, checked directly.
    const recoloured = ok(await patchType(h, f.q, 'alice', { typeId: t.id, name: 'Retail Card', color: '#16a34a' })).type;
    assert.deepEqual([recoloured.name, recoloured.color, recoloured.accountingClass], ['Retail Card', '#16a34a', 'loan']);
    const accountAfter = ok(await h.call('accounts', 'GET', { as: 'alice', query: f.q })).accounts.find((a) => a.id === account.id);
    assert.equal(accountAfter.type, 'loan', 'the account\'s own canonical accounting class never moved, only the type\'s own display changed');
    assert.deepEqual([accountAfter.accountType.name, accountAfter.accountType.color], ['Retail Card', '#16a34a'], 'the account\'s resolved type display DOES follow the rename/recolour — that is the whole point of the type being separate presentation');
  });

  test('creating an account from a real accountTypeId derives and validates its canonical type; a mismatched or retired type is refused', async () => {
    const h = harness();
    const f = await household(h);
    const savings = (await types(h, f.q)).find((t) => t.accountingClass === 'savings');
    const account = ok(await createAccount(h, f.q, 'alice', { name: 'Fictional Vacation Fund', accountTypeId: savings.id, currency: 'EUR' }), 201).account;
    assert.equal(account.type, 'savings');
    assert.equal(account.accountTypeId, savings.id);
    assert.equal(account.accountType.name, 'Savings');
    code(await createAccount(h, f.q, 'alice', { name: 'Bad', accountTypeId: savings.id, type: 'checking', currency: 'EUR' }), 400, 'account_type_mismatch');
    code(await createAccount(h, f.q, 'alice', { name: 'Bad', accountTypeId: 'atype_nosuch', currency: 'EUR' }), 400, 'invalid_account_type');
    const t = ok(await createType(h, f.q, 'alice', { name: 'Store Card', accountingClass: 'credit-card' }), 201).type;
    ok(await patchType(h, f.q, 'alice', { typeId: t.id, retired: true }));
    code(await createAccount(h, f.q, 'alice', { name: 'Bad', accountTypeId: t.id, currency: 'EUR' }), 400, 'invalid_account_type');
  });

  test('plain `type` with no accountTypeId still works exactly as before (every existing caller), and shows no resolved account type', async () => {
    const h = harness();
    const f = await household(h);
    const account = ok(await createAccount(h, f.q, 'alice', { name: 'Fictional Cash', type: 'cash', currency: 'EUR' }), 201).account;
    assert.equal(account.type, 'cash');
    assert.equal(account.accountTypeId, null);
    assert.equal(account.accountType, null);
  });

  test('an account\'s accountTypeId can be changed only while it has no entries yet, exactly like the raw type it derives — once locked, both are locked together', async () => {
    const h = harness();
    const f = await household(h);
    const checking = (await types(h, f.q)).find((t) => t.accountingClass === 'checking');
    const savings = (await types(h, f.q)).find((t) => t.accountingClass === 'savings');
    const account = ok(await createAccount(h, f.q, 'alice', { name: 'Fictional New Account', accountTypeId: checking.id, currency: 'EUR' }), 201).account;
    const changed = ok(await patchAccount(h, f.q, 'alice', { accountId: account.id, revision: account.revision, accountTypeId: savings.id })).account;
    assert.equal(changed.type, 'savings');
    assert.equal(changed.accountTypeId, savings.id);
    // Give it one real entry, then the same change is refused, exactly like a bare `type` change already is.
    await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: account.id, kind: 'income', amount: '50.00', date: '2026-09-12' } });
    code(await patchAccount(h, f.q, 'alice', { accountId: account.id, revision: changed.revision, accountTypeId: checking.id }), 409, 'has_entries_locked');
  });

  test('account types survive a backup and a create-new restore', async () => {
    const h = harness();
    const f = await household(h);
    ok(await createType(h, f.q, 'alice', { name: 'Store Card', accountingClass: 'credit-card', color: '#8b5cf6' }), 201);
    const backup = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201);
    const archiveId = backup.archive.archiveId;
    const pv = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode: 'create-new' } }));
    const res = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId, mode: 'create-new', expectedEtag: pv.expectedEtag } }), 201);
    const newQ = { workspaceId: res.workspace.id };
    const restoredTypes = await types(h, newQ, 'alice');
    const restoredCustom = restoredTypes.find((x) => x.name === 'Store Card');
    assert.ok(restoredCustom, 'the custom type survived the restore');
    assert.equal(restoredCustom.color, '#8b5cf6');
  });
});
