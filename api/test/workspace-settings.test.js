'use strict';
// Workspace settings (Terry, 2026-09-14: "the user should be able to decide", then "build all 10").
// One validated list in the workspace document; every default is today's behaviour. Expected values
// here are written out by hand, never computed with the code under test. Fictional data only.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const docPath = (id) => `workspaces/${id}/workspace.json`;
const readDoc = async (h, id) => (await h.storage.getJson(docPath(id))).value;
async function editDoc(h, id, fn) {
  const { value } = await h.storage.getJson(docPath(id));
  fn(value);
  await h.storage.putJson(docPath(id), value);
}
const getWs = (h, as, id) => h.call('workspaces', 'GET', { as, query: { id } });
const patchSettings = (h, as, id, settings, reason) => h.call('workspaces', 'PATCH', { as, query: { id }, body: { settings, ...(reason ? { reason } : {}) } });
const valueOf = (ws, key) => { const s = ws.settingsList.find((x) => x.key === key); return s ? s.value : undefined; };

async function setup() {
  const h = harness();
  const f = await household(h);
  return { h, f, id: f.ws.id };
}

describe('Workspace settings: one list, today\'s behaviour by default', () => {
  test('every member gets every setting from the one list with a label, a plain explanation and its default; only owners and managers may change them', async () => {
    const { h, f, id } = await setup();
    const alice = ok(await getWs(h, 'alice', id)).workspace;
    const keys = alice.settingsList.map((s) => s.key);
    assert.ok(keys.includes('budgetPeriod') && keys.includes('weekStart'), keys.join(','));
    for (const s of alice.settingsList) {
      assert.ok(s.label.length > 5, `${s.key} label`);
      assert.ok(s.explanation.length > 40, `${s.key} explanation`);
      assert.deepEqual(s.value, s.default, `${s.key}: a new workspace has the default`);
    }
    assert.equal(valueOf(alice, 'budgetPeriod'), 'monthly');
    assert.equal(valueOf(alice, 'weekStart'), 1);
    // Only what budgets support is offered (the workspace used to accept "custom", which budgets refuse).
    assert.deepEqual(alice.settingsList.find((s) => s.key === 'budgetPeriod').options.map((o) => o.value), ['monthly', 'weekly', 'biweekly']);
    assert.deepEqual(alice.settingsList.find((s) => s.key === 'weekStart').options.map((o) => o.value), [1, 0, 6]);
    assert.ok(alice.settingsList.every((s) => s.canChange === true), 'the owner may change every setting');
    const bob = ok(await getWs(h, 'bob', id)).workspace;
    const carol = ok(await getWs(h, 'carol', id)).workspace;
    assert.ok(bob.settingsList.every((s) => s.canChange === false), 'a member sees them but cannot change them');
    assert.ok(carol.settingsList.every((s) => s.canChange === false), 'a viewer sees them but cannot change them');
    // The site administrator and an outsider learn nothing, not even that the workspace exists.
    assert.equal((await getWs(h, 'dave', id)).status, 404);
    assert.equal((await getWs(h, 'eve', id)).status, 404);
    void f;
  });

  test('the workspace summary carries the current values, so the app knows them without another request', async () => {
    const { h, id } = await setup();
    const listed = ok(await h.call('workspaces', 'GET', { as: 'bob' })).workspaces.find((w) => w.id === id);
    assert.equal(listed.settingValues.budgetPeriod, 'monthly');
    assert.equal(listed.settingValues.weekStart, 1);
    const me = ok(await h.call('me', 'GET', { as: 'carol' })).workspaces.find((w) => w.id === id);
    assert.equal(me.settingValues.budgetPeriod, 'monthly');
  });

  test('an owner\'s change is stored, kept in the workspace history with before, after, who and why, and audited in the same write; an unchanged save records nothing', async () => {
    const { h, id } = await setup();
    ok(await patchSettings(h, 'alice', id, { budgetPeriod: 'weekly', weekStart: 0 }, 'We plan by the week'));
    const doc = await readDoc(h, id);
    assert.equal(doc.settings.budgetPeriod, 'weekly');
    assert.equal(doc.settings.weekStart, 0);
    const last = doc.history[doc.history.length - 1];
    assert.deepEqual(last.changes, [{ field: 'settings.budgetPeriod', from: 'monthly', to: 'weekly' }, { field: 'settings.weekStart', from: 1, to: 0 }]);
    assert.equal(last.reason, 'We plan by the week');
    assert.equal(last.by, 'google:g-alice');
    const audits = doc.audit.filter((a) => a.action === 'workspace.update');
    assert.deepEqual(audits[audits.length - 1].fields, ['settings.budgetPeriod', 'settings.weekStart']);
    const historyLength = doc.history.length;
    const revision = doc.revision;
    ok(await patchSettings(h, 'alice', id, { budgetPeriod: 'weekly' }));
    const again = await readDoc(h, id);
    assert.equal(again.history.length, historyLength, 'no history entry for a save that changes nothing');
    assert.equal(again.revision, revision, 'nothing written');
    const seen = ok(await getWs(h, 'bob', id)).workspace;
    assert.equal(valueOf(seen, 'budgetPeriod'), 'weekly');
    assert.equal(valueOf(seen, 'weekStart'), 0);
  });

  test('members and viewers cannot change settings; the site administrator and outsiders get not found; nothing is written', async () => {
    const { h, id } = await setup();
    const before = (await readDoc(h, id)).revision;
    assert.equal((await patchSettings(h, 'bob', id, { budgetPeriod: 'weekly' })).status, 403);
    assert.equal((await patchSettings(h, 'carol', id, { budgetPeriod: 'weekly' })).status, 403);
    assert.equal((await patchSettings(h, 'dave', id, { budgetPeriod: 'weekly' })).status, 404);
    assert.equal((await patchSettings(h, 'eve', id, { budgetPeriod: 'weekly' })).status, 404);
    assert.equal((await readDoc(h, id)).revision, before);
  });

  test('unknown settings and values that are not allowed are refused and nothing is written', async () => {
    const { h, id } = await setup();
    const before = (await readDoc(h, id)).revision;
    const refused = [
      [{ budgetPeriod: 'custom' }, 'invalid_setting'], // accepted before, but budgets never supported it
      [{ budgetPeriod: 'daily' }, 'invalid_setting'],
      [{ weekStart: 3 }, 'invalid_setting'],
      [{ weekStart: '1' }, 'invalid_setting'],
      [{ noSuchSetting: true }, 'unknown_setting'],
      [{ budgetPeriod: 'weekly', noSuchSetting: 1 }, 'unknown_setting'],
    ];
    for (const [settings, code] of refused) {
      const res = await patchSettings(h, 'alice', id, settings);
      assert.equal(res.status, 400, JSON.stringify(settings));
      assert.equal(res.body.error.code, code, JSON.stringify(settings));
    }
    assert.equal((await readDoc(h, id)).revision, before);
  });
});

// ---- (a) shared expenses on or off -----------------------------------------------------------------
const groupGet = (h, as, id, extra = {}) => h.call('group', 'GET', { as, query: { workspaceId: id, ...extra } });
const sharedValue = async (h, id) => valueOf(ok(await getWs(h, 'alice', id)).workspace, 'sharedExpenses');

describe('(a) Shared expenses on or off', () => {
  test('by default on for households, groups and trips and off for personal workspaces, as the app showed it; off means the routes refuse', async () => {
    const { h, id } = await setup();
    assert.equal(await sharedValue(h, id), true, 'household');
    ok(await groupGet(h, 'bob', id));
    for (const [kind, on] of [['group', true], ['trip', true], ['personal', false]]) {
      const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: `Fictional ${kind}`, kind, reportingCurrency: 'EUR' } }), 201).workspace;
      assert.equal(ws.settingValues.sharedExpenses, on, kind);
      assert.equal((await groupGet(h, 'alice', ws.id)).status, on ? 200 : 403, kind);
    }
  });

  test('turned off: every group route refuses with a clear message and nothing is removed; turned on again it all comes back', async () => {
    const { h, f, id } = await setup();
    const [A, B] = [`member:${f.memberId('Alice')}`, `member:${f.memberId('Bob')}`];
    const expense = ok(await h.call('group', 'POST', { as: 'alice', query: f.q, body: { description: 'Fictional dinner', amount: '60.00', payers: [{ ref: A }], split: { method: 'equal', lines: [{ ref: A }, { ref: B }] } } }), 201).expense;
    ok(await patchSettings(h, 'alice', id, { sharedExpenses: false }, 'We settle up elsewhere'));
    const tries = {
      get: await groupGet(h, 'bob', id),
      balances: await groupGet(h, 'bob', id, { action: 'balances' }),
      history: await groupGet(h, 'bob', id, { action: 'history', expenseId: expense.id }),
      add: await h.call('group', 'POST', { as: 'alice', query: f.q, body: { description: 'Fictional taxi', amount: '10.00', payers: [{ ref: A }], split: { method: 'equal', lines: [{ ref: A }] } } }),
      correct: await h.call('group', 'PATCH', { as: 'alice', query: f.q, body: { expenseId: expense.id, revision: expense.revision, reason: 'x', amount: '61.00' } }),
      settle: await h.call('group', 'POST', { as: 'bob', query: { ...f.q, action: 'settle' }, body: { from: B, to: A, amount: '30.00' } }),
      viewer: await groupGet(h, 'carol', id),
    };
    for (const [name, res] of Object.entries(tries)) {
      assert.equal(res.status, 403, name);
      assert.equal(res.body.error.code, 'shared_expenses_off', name);
    }
    assert.match(tries.get.body.error.message, /turned off in this workspace.*nothing recorded has been removed/);
    // Someone outside the workspace learns nothing new: still not found.
    assert.equal((await groupGet(h, 'eve', id)).status, 404);
    assert.equal((await groupGet(h, 'dave', id)).status, 404);
    const doc = await readDoc(h, id);
    assert.deepEqual(doc.groupExpenses.map((e) => [e.id, e.description, e.amountMinor]), [[expense.id, 'Fictional dinner', 6000]], 'kept as it was');
    ok(await patchSettings(h, 'alice', id, { sharedExpenses: true }));
    const back = ok(await groupGet(h, 'bob', id));
    assert.deepEqual(back.expenses.map((e) => [e.id, e.description]), [[expense.id, 'Fictional dinner']]);
  });

  test('a personal workspace can turn Shared expenses on; members cannot change the setting', async () => {
    const { h, id } = await setup();
    const personal = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional side', kind: 'personal', reportingCurrency: 'EUR' } }), 201).workspace;
    ok(await patchSettings(h, 'alice', personal.id, { sharedExpenses: true }));
    ok(await groupGet(h, 'alice', personal.id));
    assert.equal((await patchSettings(h, 'bob', id, { sharedExpenses: false })).status, 403);
  });

  test('the site administrator\'s switch is the upper bound: off for the site is off in every workspace; the workspace value is kept', async () => {
    const { h, id } = await setup();
    ok(await h.call('site-settings', 'PUT', { as: 'dave', body: { modules: { sharedExpenses: false } } }));
    const refused = await groupGet(h, 'alice', id);
    assert.equal(refused.status, 403);
    assert.match(refused.body.error.message, /turned off for this site by the site administrator/);
    const s = ok(await getWs(h, 'alice', id)).workspace.settingsList.find((x) => x.key === 'sharedExpenses');
    assert.deepEqual([s.value, s.offForSite], [true, true]);
    ok(await h.call('site-settings', 'PUT', { as: 'dave', body: { modules: { sharedExpenses: true } } }));
    ok(await groupGet(h, 'alice', id));
    assert.equal(ok(await getWs(h, 'alice', id)).workspace.settingsList.find((x) => x.key === 'sharedExpenses').offForSite, undefined);
  });
});

// ---- (f) changing other members' entries on shared accounts --------------------------------------
// Fixture: Alice (owner) recorded "Fictional Grocer" 82.40 on the shared Joint account; Bob is a member,
// Carol a viewer; Alice Savings is Alice's private account.
const editEntry = (h, as, f, t, extra) => h.call('transactions', 'PATCH', { as, query: f.q, body: { transactionId: t.id, revision: t.revision, ...extra } });
const entryOf = async (h, id, txId) => (await readDoc(h, id)).transactions.find((t) => t.id === txId);
const canEditAs = async (h, as, f, txId) => ok(await h.call('transactions', 'GET', { as, query: f.q })).transactions.find((t) => t.id === txId).canEdit;

describe("(f) Members may change other members' entries on shared accounts", () => {
  test('by default a member changes only their own entries on a shared account, as before', async () => {
    const { h, f } = await setup();
    assert.equal(await canEditAs(h, 'bob', f, f.grocery.id), false);
    assert.equal((await editEntry(h, 'bob', f, f.grocery, { amount: '90.00', reason: 'Fictional receipt' })).status, 403);
    const mine = ok(await h.call('transactions', 'POST', { as: 'bob', query: f.q, body: { accountId: f.joint.id, kind: 'expense', amount: '12.00', date: '2026-09-12' } }), 201).transactions[0];
    ok(await editEntry(h, 'bob', f, mine, { amount: '13.00', reason: 'Fictional typo' }));
  });

  test('"Any entry": a member corrects and deletes another member\'s shared entry; each change keeps who, when and why; nothing is removed', async () => {
    const { h, f, id } = await setup();
    ok(await patchSettings(h, 'alice', id, { memberEditsOthers: 'any' }, 'We share the bookkeeping'));
    assert.equal(await canEditAs(h, 'bob', f, f.grocery.id), true);
    ok(await editEntry(h, 'bob', f, f.grocery, { amount: '90.00', reason: 'Fictional receipt' }));
    const t = await entryOf(h, id, f.grocery.id);
    assert.equal(t.amountMinor, -9000);
    const a = t.amendments[t.amendments.length - 1];
    assert.equal(a.by, 'google:g-bob');
    assert.equal(a.reason, 'Fictional receipt');
    assert.deepEqual(a.changes.find((c) => c.field === 'amountMinor'), { field: 'amountMinor', from: -8240, to: -9000 });
    assert.equal(t.createdBy, 'google:g-alice', 'the entry is still Alice\'s');
    const other = ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.joint.id, kind: 'expense', amount: '5.00', date: '2026-09-12' } }), 201).transactions[0];
    ok(await h.call('transactions', 'DELETE', { as: 'bob', query: f.q, body: { transactionId: other.id, revision: other.revision, reason: 'Entered twice' } }));
    const gone = await entryOf(h, id, other.id);
    assert.ok(gone && gone.deletedAt, 'kept, marked deleted');
    assert.equal(gone.deletedBy, 'google:g-bob');
  });

  test('"Any entry" never reaches viewers, private accounts or locked entries', async () => {
    const { h, f, id } = await setup();
    const privateEntry = ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.aliceSavings.id, kind: 'expense', amount: '20.00', date: '2026-09-12' } }), 201).transactions[0];
    ok(await editEntry(h, 'alice', f, f.grocery, { status: 'reconciled' }));
    const reconciled = await entryOf(h, id, f.grocery.id);
    ok(await patchSettings(h, 'alice', id, { memberEditsOthers: 'any' }));
    assert.equal((await editEntry(h, 'carol', f, reconciled, { notes: 'viewer' })).status, 403, 'a viewer still cannot');
    const priv = await editEntry(h, 'bob', f, privateEntry, { amount: '1.00', reason: 'x' });
    assert.ok(priv.status === 404 || priv.status === 403, `Alice's private account stays hers (${priv.status})`);
    assert.equal((await entryOf(h, id, privateEntry.id)).amountMinor, -2000);
    const locked = await editEntry(h, 'bob', f, reconciled, { amount: '1.00', reason: 'x' });
    assert.equal(locked.status, 409);
    assert.equal(locked.body.error.code, 'reconciled_locked');
  });

  test('bills on a shared account follow the same setting', async () => {
    const { h, f, id } = await setup();
    const bill = ok(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: { name: 'Fictional internet', accountId: f.joint.id, amount: '40.00', schedule: { freq: 'monthly', interval: 1, startDate: '2026-09-20' } } }), 201).recurring;
    const rename = () => h.call('recurring', 'PATCH', { as: 'bob', query: f.q, body: { recurringId: bill.id, revision: bill.revision, name: 'Fictional fibre' } });
    assert.equal((await rename()).status, 403);
    ok(await patchSettings(h, 'alice', id, { memberEditsOthers: 'any' }));
    assert.equal(ok(await rename()).recurring.name, 'Fictional fibre');
  });
});

// ---- (g) who manages shared lists ----------------------------------------------------------------
// Fixture: Alice (owner) created the shared Joint account and the shared merchant "Fictional Grocer".
async function sharedLists(h, f) {
  const cat = await categoryId(h, f.q);
  const contact = ok(await h.call('contacts', 'POST', { as: 'alice', body: { scope: 'workspace', workspaceId: f.ws.id, name: 'Dana Fictional' } }), 201).contact;
  const budget = ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'Fictional food', scope: 'shared', lines: [{ categoryId: cat, amount: '400.00' }] } }), 201).budget;
  const privateBudget = ok(await h.call('budgets', 'POST', { as: 'alice', query: f.q, body: { name: 'Alice only', scope: 'private', lines: [{ categoryId: cat, amount: '50.00' }] } }), 201).budget;
  const grocer = ok(await h.call('payees', 'GET', { as: 'alice', query: f.q })).payees.find((p) => p.id === f.merchants.grocer.id);
  const joint = ok(await h.call('accounts', 'GET', { as: 'alice', query: f.q })).accounts.find((a) => a.id === f.joint.id);
  // Each attempt by `as`: the HTTP status of every shared-list action.
  return async (as) => {
    const s = {};
    s.addAccount = (await h.call('accounts', 'POST', { as, query: f.q, body: { name: `Shared by ${as}`, type: 'checking', currency: 'EUR', visibility: 'shared' } })).status;
    s.editAccount = (await h.call('accounts', 'PATCH', { as, query: f.q, body: { accountId: joint.id, revision: (await h.call('accounts', 'GET', { as: 'alice', query: f.q })).body.accounts.find((a) => a.id === joint.id).revision, notes: `note by ${as}` } })).status;
    s.addBudget = (await h.call('budgets', 'POST', { as, query: f.q, body: { name: `Budget by ${as}`, scope: 'shared', lines: [{ categoryId: cat, amount: '10.00' }] } })).status;
    const b = ok(await h.call('budgets', 'GET', { as: 'alice', query: f.q })).budgets.find((x) => x.id === budget.id);
    s.editBudget = (await h.call('budgets', 'PATCH', { as, query: f.q, body: { budgetId: b.id, revision: b.revision, name: `Food ${as}` } })).status;
    s.addCategory = (await h.call('categories', 'POST', { as, query: f.q, body: { name: `Category ${as}` } })).status;
    s.editCategory = (await h.call('categories', 'PATCH', { as, query: f.q, body: { categoryId: cat, name: `Groceries ${as}` } })).status;
    const g = ok(await h.call('payees', 'GET', { as: 'alice', query: f.q })).payees.find((p) => p.id === grocer.id);
    s.editMerchant = (await h.call('payees', 'PATCH', { as, query: f.q, body: { payeeId: g.id, revision: g.revision, notes: `note ${as}` } })).status;
    s.editContact = (await h.call('contacts', 'PATCH', { as, body: { scope: 'workspace', workspaceId: f.ws.id, contactId: contact.id, notes: `note ${as}` } })).status;
    s.addContact = (await h.call('contacts', 'POST', { as, body: { scope: 'workspace', workspaceId: f.ws.id, name: `Contact by ${as}` } })).status;
    s.addMerchant = (await h.call('payees', 'POST', { as, query: f.q, body: { name: `Merchant by ${as}`, visibility: 'shared' } })).status;
    const pb = (await h.call('budgets', 'PATCH', { as, query: f.q, body: { budgetId: privateBudget.id, revision: privateBudget.revision, name: 'Not yours' } })).status;
    s.privateBudget = pb === 404 ? 'not found' : pb;
    const pa = (await h.call('accounts', 'PATCH', { as, query: f.q, body: { accountId: f.aliceSavings.id, revision: 1, notes: 'Not yours' } })).status;
    s.privateAccount = pa === 404 ? 'not found' : pa;
    return s;
  };
}

describe('(g) Who manages shared lists', () => {
  test('by default managers and owners manage the shared lists; members add shared merchants and contacts only; viewers nothing', async () => {
    const { h, f } = await setup();
    const attempt = await sharedLists(h, f);
    assert.deepEqual(await attempt('bob'), {
      addAccount: 403, editAccount: 403, addBudget: 403, editBudget: 403, addCategory: 403, editCategory: 403, editMerchant: 403, editContact: 403,
      addContact: 201, addMerchant: 201, privateBudget: 'not found', privateAccount: 'not found',
    });
    assert.deepEqual(await attempt('carol'), {
      addAccount: 403, editAccount: 403, addBudget: 403, editBudget: 403, addCategory: 403, editCategory: 403, editMerchant: 403, editContact: 403,
      addContact: 403, addMerchant: 403, privateBudget: 'not found', privateAccount: 'not found',
    });
  });

  test('"Any member who can add entries": members manage every shared list; viewers still nothing; private items stay their owner\'s', async () => {
    const { h, f, id } = await setup();
    const attempt = await sharedLists(h, f);
    ok(await patchSettings(h, 'alice', id, { sharedListManagers: 'members' }));
    assert.deepEqual(await attempt('bob'), {
      addAccount: 201, editAccount: 200, addBudget: 201, editBudget: 200, addCategory: 201, editCategory: 200, editMerchant: 200, editContact: 200,
      addContact: 201, addMerchant: 201, privateBudget: 'not found', privateAccount: 'not found',
    });
    assert.deepEqual(await attempt('carol'), {
      addAccount: 403, editAccount: 403, addBudget: 403, editBudget: 403, addCategory: 403, editCategory: 403, editMerchant: 403, editContact: 403,
      addContact: 403, addMerchant: 403, privateBudget: 'not found', privateAccount: 'not found',
    });
    const budgets = ok(await h.call('budgets', 'GET', { as: 'bob', query: f.q })).budgets;
    assert.ok(budgets.filter((b) => b.scope === 'shared').every((b) => b.canEdit === true), 'the budget list says Bob may edit shared budgets');
    const grocer = ok(await h.call('payees', 'GET', { as: 'bob', query: f.q })).payees.find((p) => p.id === f.merchants.grocer.id);
    assert.equal(grocer.canEdit, true);
    // Every change Bob made is kept with his name (the audit log records who did it).
    const doc = await readDoc(h, id);
    const bobs = doc.audit.filter((a) => a.actor === 'google:g-bob').map((a) => a.action);
    for (const action of ['account.create', 'account.update', 'budget.create', 'budget.update', 'category.create', 'category.update', 'payee.update', 'contact.update']) assert.ok(bobs.includes(action), action);
  });
});

// ---- (h) restores by members -----------------------------------------------------------------------
// Bob (member) rolls his own private card back from Alice's backup: each replace sets aside the entry
// he added since, so it changes something and counts.
async function memberRestoreSetup() {
  const { h, f, id } = await setup();
  h.clock.advance(60000);
  const archiveId = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201).archive.archiveId;
  let n = 0;
  const addToCard = async () => { n += 1; h.clock.advance(60000); ok(await h.call('transactions', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, kind: 'expense', amount: `${n}.00`, date: '2026-09-12' } }), 201); };
  const preview = (as, mode, extra = {}) => h.call('restore', 'POST', { as, query: { action: 'preview' }, body: { workspaceId: id, archiveId, mode, ...extra } });
  const replace = async (as = 'bob') => {
    const pv = await preview(as, 'replace');
    if (pv.status !== 200) return pv;
    return h.call('restore', 'POST', { as, query: { action: 'execute' }, body: { workspaceId: id, archiveId, mode: 'replace', confirm: 'REPLACE', expectedEtag: pv.body.expectedEtag } });
  };
  return { h, f, id, archiveId, addToCard, preview, replace };
}

describe('(h) Restores by members: how many a day and which kinds (owners only)', () => {
  test('by default a member may use every kind of restore, as before', async () => {
    const x = await memberRestoreSetup();
    for (const mode of ['merge', 'replace', 'create-new']) assert.equal((await x.preview('bob', mode)).status, 200, mode);
    assert.equal((await x.preview('bob', 'merge', { restoreDeleted: true })).status, 200);
    await x.addToCard();
    assert.equal((await x.replace()).status, 200);
  });

  test('one a day: the second merge or replace that day is refused with the number; the next day it is allowed again', async () => {
    const x = await memberRestoreSetup();
    ok(await patchSettings(x.h, 'alice', x.id, { memberRestoresPerDay: 1 }));
    await x.addToCard();
    assert.equal((await x.replace()).status, 200);
    await x.addToCard();
    const second = await x.replace();
    assert.equal(second.status, 429);
    assert.equal(second.body.error.code, 'restore_limit');
    assert.match(second.body.error.message, /at most 1 time a day/);
    x.h.clock.advance(24 * 60 * 60 * 1000);
    assert.equal((await x.replace()).status, 200, 'a day later');
  });

  test('0 a day turns merge and replace off for members (preview included); a workspace from a backup is still allowed; managers and owners are not limited', async () => {
    const x = await memberRestoreSetup();
    ok(await patchSettings(x.h, 'alice', x.id, { memberRestoresPerDay: 0 }));
    await x.addToCard();
    for (const mode of ['merge', 'replace']) {
      const res = await x.preview('bob', mode);
      assert.equal(res.status, 403, mode);
      assert.equal(res.body.error.code, 'member_restores_off', mode);
    }
    assert.equal((await x.replace()).status, 403);
    assert.equal((await x.preview('bob', 'create-new')).status, 200);
    // The owner's own scope must differ from the backup for a replace to change anything.
    ok(await x.h.call('transactions', 'POST', { as: 'alice', query: x.f.q, body: { accountId: x.f.joint.id, kind: 'expense', amount: '7.00', date: '2026-09-12' } }), 201);
    assert.equal((await x.replace('alice')).status, 200, 'the owner restores as before');
  });

  test('kinds: a kind the owners switched off is refused for members; bringing back deleted entries needs its own tick', async () => {
    const x = await memberRestoreSetup();
    ok(await patchSettings(x.h, 'alice', x.id, { memberRestoreModes: ['create-new', 'merge'] }));
    const replaced = await x.preview('bob', 'replace');
    assert.equal(replaced.status, 403);
    assert.equal(replaced.body.error.code, 'restore_mode_off');
    assert.equal((await x.preview('bob', 'merge')).status, 200);
    assert.equal((await x.preview('bob', 'merge', { restoreDeleted: true })).body.error.code, 'restore_mode_off');
    ok(await patchSettings(x.h, 'alice', x.id, { memberRestoreModes: ['replace'] }));
    assert.equal((await x.preview('bob', 'create-new')).body.error.code, 'restore_mode_off');
    assert.equal((await x.preview('alice', 'merge', { restoreDeleted: true })).status, 200, 'the owner is not limited');
  });

  test('only owners change these: a manager is refused, naming who can; values outside 0–3 and deleted entries without Merge are refused', async () => {
    const x = await memberRestoreSetup();
    const carol = x.f.memberId('Carol');
    ok(await x.h.call('members', 'PATCH', { as: 'alice', query: x.f.q, body: { memberId: carol, role: 'manager' } }));
    const byManager = await patchSettings(x.h, 'carol', x.id, { memberRestoresPerDay: 1 });
    assert.equal(byManager.status, 403);
    assert.match(byManager.body.error.message, /Only owners can change/);
    assert.equal((await patchSettings(x.h, 'carol', x.id, { memberRestoreModes: ['merge'] })).status, 403);
    ok(await patchSettings(x.h, 'carol', x.id, { billReminderDays: 5 })); // a manager still changes the other settings
    const seen = ok(await getWs(x.h, 'carol', x.id)).workspace.settingsList;
    assert.deepEqual(seen.filter((s) => !s.canChange).map((s) => s.key), ['memberRestoresPerDay', 'memberRestoreModes']);
    for (const bad of [{ memberRestoresPerDay: 4 }, { memberRestoresPerDay: -1 }, { memberRestoreModes: ['restore-deleted'] }, { memberRestoreModes: ['merge', 'merge'] }, { memberRestoreModes: 'merge' }]) {
      assert.equal((await patchSettings(x.h, 'alice', x.id, bad)).body.error.code, 'invalid_setting', JSON.stringify(bad));
    }
    // Stored in the order of the list, whatever order it was sent in.
    ok(await patchSettings(x.h, 'alice', x.id, { memberRestoreModes: ['replace', 'create-new'] }));
    assert.deepEqual((await readDoc(x.h, x.id)).settings.memberRestoreModes, ['create-new', 'replace']);
  });
});

// ---- (i) budget defaults and backdating -----------------------------------------------------------
// The harness clock starts on Sunday 2026-09-13: the latest Monday on or before it is 2026-09-07, the
// latest Saturday 2026-09-12, and the current monthly period starts 2026-09-01.
async function categoryId(h, q) {
  return ok(await h.call('categories', 'GET', { as: 'alice', query: q })).categories.find((c) => c.name === 'Groceries').id;
}
const newBudget = async (h, q, body) => ok(await h.call('budgets', 'POST', { as: 'alice', query: q, body: { name: 'Fictional food', scope: 'shared', lines: [{ categoryId: await categoryId(h, q), amount: '400.00' }], ...body } }), 201).budget;

describe('(i) Budget period, week start and changes to past periods', () => {
  test('by default a new budget is monthly from the first of the month, as before', async () => {
    const { h, f } = await setup();
    const b = await newBudget(h, f.q, {});
    assert.deepEqual([b.period, b.startDate], ['monthly', '2026-09-01']);
  });

  test('the workspace period and week start become the defaults for new budgets; what is sent wins; existing budgets keep their own', async () => {
    const { h, f, id } = await setup();
    const before = await newBudget(h, f.q, {});
    ok(await patchSettings(h, 'alice', id, { budgetPeriod: 'weekly' }));
    const weekly = await newBudget(h, f.q, {});
    assert.deepEqual([weekly.period, weekly.startDate], ['weekly', '2026-09-07'], 'weeks start on Monday by default');
    ok(await patchSettings(h, 'alice', id, { weekStart: 6, budgetPeriod: 'biweekly' }));
    const biweekly = await newBudget(h, f.q, {});
    assert.deepEqual([biweekly.period, biweekly.startDate], ['biweekly', '2026-09-12'], 'Saturday');
    ok(await patchSettings(h, 'alice', id, { weekStart: 0, budgetPeriod: 'weekly' }));
    assert.equal((await newBudget(h, f.q, {})).startDate, '2026-09-13', 'Sunday is today');
    const chosen = await newBudget(h, f.q, { period: 'monthly', startDate: '2026-09-15' });
    assert.deepEqual([chosen.period, chosen.startDate], ['monthly', '2026-09-15'], 'what is sent wins');
    assert.deepEqual([(await newBudget(h, f.q, { period: 'monthly' })).startDate], ['2026-09-01'], 'a monthly budget still starts on the first');
    const list = ok(await h.call('budgets', 'GET', { as: 'alice', query: f.q })).budgets;
    const earlier = list.find((b) => b.id === before.id);
    assert.deepEqual([earlier.period, earlier.startDate], ['monthly', '2026-09-01'], 'the earlier budget is unchanged');
  });

  test('"Only after confirming" (default) keeps today\'s rule; "Never" refuses any change that reaches finished periods, confirmed or not', async () => {
    const { h, f, id } = await setup();
    const cat = await categoryId(h, f.q);
    const b = await newBudget(h, f.q, { startDate: '2026-08-01' });
    const change = (budget, extra) => h.call('budgets', 'PATCH', { as: 'alice', query: f.q, body: { budgetId: budget.id, revision: budget.revision, lines: [{ categoryId: cat, amount: '450.00' }], ...extra } });
    // Default: before the current period needs a confirmation, and with it the change is accepted.
    assert.equal((await change(b, { effectiveFrom: '2026-08-15' })).body.error.code, 'backdate_unconfirmed');
    const confirmed = ok(await change(b, { effectiveFrom: '2026-08-15', confirmBackdate: true })).budget;
    assert.equal(confirmed.versions[confirmed.versions.length - 1].backdated, true);
    ok(await patchSettings(h, 'alice', id, { budgetBackdating: 'never' }));
    const refused = await change(confirmed, { effectiveFrom: '2026-08-20', confirmBackdate: true });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'backdate_off');
    assert.match(refused.body.error.message, /Start the change on 2026-09-01 or later/);
    // A new period type whose first period starts before the change takes effect counts days twice: refused too.
    const periodChange = await h.call('budgets', 'PATCH', { as: 'alice', query: f.q, body: { budgetId: b.id, revision: confirmed.revision, period: 'weekly', startDate: '2026-09-07', effectiveFrom: '2026-09-10', confirmBackdate: true } });
    assert.equal(periodChange.body.error.code, 'backdate_off');
    // A change in the current period is still fine.
    const current = ok(await change(confirmed, { effectiveFrom: '2026-09-01' })).budget;
    assert.equal(current.versions[current.versions.length - 1].backdated, false);
    assert.equal(current.lines[0].amount, '450.00');
  });
});

// ---- (j) bill defaults ----------------------------------------------------------------------------
// A monthly bill from 2026-09-01, tracked from then: on 2026-09-13 its 09-01 payment is overdue.
const newBill = async (h, f, extra = {}) => ok(await h.call('recurring', 'POST', { as: 'alice', query: f.q, body: {
  name: 'Fictional rent', accountId: f.joint.id, amount: '950.00', schedule: { freq: 'monthly', interval: 1, startDate: '2026-09-01' }, trackFrom: '2026-09-01', ...extra,
} }), 201).recurring;
const recordBill = async (h, f, bill, extra = {}) => ok(await h.call('recurring', 'POST', { as: 'alice', query: { ...f.q, action: 'record' }, body: { recurringId: bill.id, occurrence: '2026-09-01', ...extra } }), 201).transactions[0];
const draftDate = async (h, f, bill) => ok(await h.call('recurring', 'GET', { as: 'alice', query: { ...f.q, action: 'draft', recurringId: bill.id, occurrence: '2026-09-01' } })).draft.date;

describe('(j) Bill defaults: due-soon days and the date of a late payment', () => {
  test('by default a new bill shows as due soon 3 days ahead and a late payment is recorded today, as before', async () => {
    const { h, f } = await setup();
    const bill = await newBill(h, f);
    assert.equal(bill.reminderDays, 3);
    assert.equal(await draftDate(h, f, bill), '2026-09-13');
    assert.equal((await recordBill(h, f, bill)).date, '2026-09-13');
  });

  test('the workspace\'s due-soon days are the default for new bills; a bill\'s own value wins; existing bills keep theirs', async () => {
    const { h, f, id } = await setup();
    const before = await newBill(h, f);
    ok(await patchSettings(h, 'alice', id, { billReminderDays: 10 }));
    assert.equal((await newBill(h, f, { name: 'Fictional water' })).reminderDays, 10);
    assert.equal((await newBill(h, f, { name: 'Fictional power', reminderDays: 0 })).reminderDays, 0, 'the bill\'s own value wins');
    const listed = ok(await h.call('recurring', 'GET', { as: 'alice', query: f.q })).recurring.find((r) => r.id === before.id);
    assert.equal(listed.reminderDays, 3, 'the earlier bill is unchanged');
    for (const bad of [61, -1, 2.5, '5']) assert.equal((await patchSettings(h, 'alice', id, { billReminderDays: bad })).body.error.code, 'invalid_setting', String(bad));
  });

  test('"Its due date": a late payment is recorded on its due date unless another date is entered', async () => {
    const { h, f, id } = await setup();
    ok(await patchSettings(h, 'alice', id, { overdueRecordDate: 'due' }));
    const bill = await newBill(h, f);
    assert.equal(await draftDate(h, f, bill), '2026-09-01');
    assert.equal((await recordBill(h, f, bill)).date, '2026-09-01');
    const other = await newBill(h, f, { name: 'Fictional water' });
    assert.equal((await recordBill(h, f, other, { date: '2026-09-10' })).date, '2026-09-10', 'an entered date wins');
  });
});

// ---- UX/accessibility review of eefd115 (fix/workspace-settings-ux) --------------------------------
// Texts are the reviewer's, written out here.
const settingOf = (ws, key) => ws.settingsList.find((s) => s.key === key);

describe('UX review: errors name the setting, plain wording, option labels, a unit, and a read-only history', () => {
  test('a refused value says which setting and what to do, and names it for the app (details.setting)', async () => {
    const { h, id } = await setup();
    const cases = [
      [{ memberRestoreModes: ['restore-deleted'] }, 'memberRestoreModes', '“Merge that also brings back deleted entries” needs “Merge” ticked as well.'],
      [{ billReminderDays: 61 }, 'billReminderDays', '“Days before the due date a new bill shows as Due soon”: enter a whole number from 0 to 60.'],
      [{ memberRestoresPerDay: 4 }, 'memberRestoresPerDay', '“How often a member may restore their own records”: choose one of the options shown.'],
      [{ budgetBackdating: 'sometimes' }, 'budgetBackdating', '“Changing a budget for periods that have finished”: choose one of the options shown.'],
      [{ sharedExpenses: 'yes' }, 'sharedExpenses', '“Use Shared expenses in this workspace”: choose one of the options shown.'],
    ];
    for (const [settings, key, message] of cases) {
      const res = await patchSettings(h, 'alice', id, settings);
      assert.equal(res.status, 400, key);
      assert.deepEqual([res.body.error.code, res.body.error.message, res.body.error.details], ['invalid_setting', message, { setting: key }], key);
    }
  });

  test('labels and options are the reviewed wording; the restore number has option labels, the due-soon days a unit, the restores a note', async () => {
    const { h, id } = await setup();
    const ws = ok(await getWs(h, 'alice', id)).workspace;
    const wording = (key) => { const s = settingOf(ws, key); return [s.label, (s.options || []).map((o) => o.label)]; };
    assert.deepEqual(wording('sharedExpenses'), ['Use Shared expenses in this workspace', []]);
    assert.deepEqual(wording('memberEditsOthers'), ['Which entries a member may correct on shared accounts', ['Only entries they added', 'Any entry']]);
    assert.match(settingOf(ws, 'memberEditsOthers').explanation, /^Owners and managers can always correct any entry on shared accounts\./);
    assert.deepEqual(wording('sharedListManagers'), ['Who can add and change shared accounts, budgets and categories', ['Owners and managers only', 'Owners, managers and members']]);
    assert.match(settingOf(ws, 'sharedListManagers').explanation, /merchants/);
    assert.match(settingOf(ws, 'sharedListManagers').explanation, /contacts/);
    assert.deepEqual(wording('budgetBackdating'), ['Changing a budget for periods that have finished', ['Allowed after a confirmation', 'Not allowed']]);
    assert.deepEqual(wording('billReminderDays'), ['Days before the due date a new bill shows as Due soon', []]);
    assert.equal(settingOf(ws, 'billReminderDays').unit, 'days');
    const perDay = settingOf(ws, 'memberRestoresPerDay');
    assert.deepEqual([perDay.label, perDay.type, perDay.options.map((o) => [o.value, o.label])], ['How often a member may restore their own records', 'integer',
      [[0, 'Not allowed'], [1, 'Once a day'], [2, 'Up to 2 a day'], [3, 'Up to 3 a day']]]);
    assert.match(perDay.explanation, /Each restore first saves a safety copy of the workspace, which is why 3 a day is the most\./);
    assert.equal(perDay.groupNote, "Members can't restore from the app yet; this applies to restores through the API.");
    // Every explanation opens with a sentence that stands on its own (the card shows it first).
    for (const s of ws.settingsList) assert.match(s.explanation, /^[^.]{12,}\./, s.key);
  });

  test('members and viewers read the settings history (who, when, from, to, why), never name or lifecycle changes; managers keep the full history', async () => {
    const { h, id } = await setup();
    ok(await h.call('workspaces', 'PATCH', { as: 'alice', query: { id }, body: { name: 'Fictional Home', settings: { weekStart: 0 }, reason: 'Sunday people' } }));
    ok(await patchSettings(h, 'alice', id, { billReminderDays: 5 }));
    for (const who of ['bob', 'carol']) {
      const ws = ok(await getWs(h, who, id)).workspace;
      assert.equal(ws.history, undefined, `${who}: no full history`);
      assert.equal(ws.lifecycle, undefined, `${who}: no lifecycle`);
      assert.deepEqual(ws.settingsHistory.map((e) => [e.by, e.changes, e.reason]), [
        ['Alice Fictional', [{ field: 'settings.weekStart', from: 1, to: 0 }], 'Sunday people'],
        ['Alice Fictional', [{ field: 'settings.billReminderDays', from: 3, to: 5 }], ''],
      ], who);
      assert.ok(ws.settingsHistory.every((e) => typeof e.at === 'string'));
    }
    const alice = ok(await getWs(h, 'alice', id)).workspace;
    assert.deepEqual(alice.history[alice.history.length - 2].changes.map((c) => c.field), ['name', 'settings.weekStart']);
    assert.equal(alice.settingsHistory.length, 2);
    assert.equal((await getWs(h, 'eve', id)).status, 404);
  });

  test('group settings: a refused value names the setting the same way', async () => {
    const { h, f } = await setup();
    const res = await h.call('group', 'POST', { as: 'alice', query: { ...f.q, action: 'settings' }, body: { changes: { changeExpenses: 'everyone' } } });
    assert.equal(res.status, 400);
    assert.deepEqual([res.body.error.message, res.body.error.details], ['“Who can correct or void a shared expense”: choose one of the options shown.', { setting: 'changeExpenses' }]);
    const labels = ok(await h.call('group', 'GET', { as: 'carol', query: f.q })).groupSettings.settings.map((s) => s.label);
    for (const label of ['Who can correct or void a shared expense', 'Who can withdraw a confirmed payment', 'Who can dispute a reported payment']) assert.ok(labels.includes(label), label);
  });
});

describe('Workspace settings: older documents, backups and restores', () => {
  test('a document without the settings reads the defaults; a stored "custom" budget period reads as monthly and still backs up', async () => {
    const { h, id } = await setup();
    await editDoc(h, id, (doc) => { delete doc.settings.budgetPeriod; delete doc.settings.weekStart; });
    let ws = ok(await getWs(h, 'alice', id)).workspace;
    assert.equal(valueOf(ws, 'budgetPeriod'), 'monthly');
    assert.equal(valueOf(ws, 'weekStart'), 1);
    await editDoc(h, id, (doc) => { doc.settings.budgetPeriod = 'custom'; });
    ws = ok(await getWs(h, 'alice', id)).workspace;
    assert.equal(valueOf(ws, 'budgetPeriod'), 'monthly');
    ok(await h.call('backups', 'POST', { as: 'alice', query: { workspaceId: id }, body: {} }), 201);
    // Choosing Monthly then stores it and records what was there before.
    ok(await patchSettings(h, 'alice', id, { budgetPeriod: 'monthly' }));
    const doc = await readDoc(h, id);
    assert.equal(doc.settings.budgetPeriod, 'monthly');
    assert.deepEqual(doc.history[doc.history.length - 1].changes, [{ field: 'settings.budgetPeriod', from: 'custom', to: 'monthly' }]);
  });

  test('a backup refuses a document whose settings hold a value no version accepted', async () => {
    const { h, id } = await setup();
    await editDoc(h, id, (doc) => { doc.settings.weekStart = 'someday'; });
    const res = await h.call('backups', 'POST', { as: 'alice', query: { workspaceId: id }, body: {} });
    assert.equal(res.status, 422);
    assert.match(res.body.error.message, /workspace settings/);
    await editDoc(h, id, (doc) => { doc.settings = ['not', 'an', 'object']; });
    assert.equal((await h.call('backups', 'POST', { as: 'alice', query: { workspaceId: id }, body: {} })).status, 422);
  });

  test('a create-new restore carries the settings like other workspace data; merge keeps the settings the workspace has now', async () => {
    const { h, id } = await setup();
    ok(await patchSettings(h, 'alice', id, { budgetPeriod: 'biweekly', weekStart: 6 }));
    h.clock.advance(60000);
    const archiveId = ok(await h.call('backups', 'POST', { as: 'alice', query: { workspaceId: id }, body: {} }), 201).archive.archiveId;
    h.clock.advance(60000);
    const created = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: id, archiveId, mode: 'create-new' } }), 201).workspace;
    const copy = ok(await getWs(h, 'alice', created.id)).workspace;
    assert.equal(valueOf(copy, 'budgetPeriod'), 'biweekly');
    assert.equal(valueOf(copy, 'weekStart'), 6);
    // Changed after the backup: a merge brings back missing records, never older settings.
    ok(await patchSettings(h, 'alice', id, { budgetPeriod: 'monthly' }));
    const pv = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: id, archiveId, mode: 'merge' } }));
    if (pv.canExecute) ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: id, archiveId, mode: 'merge', expectedEtag: pv.expectedEtag } }));
    assert.equal(valueOf(ok(await getWs(h, 'alice', id)).workspace, 'budgetPeriod'), 'monthly');
  });
});
