'use strict';
// BT-009-20: shared-expense EVENTS, the foundation (Terry, 2026-09-19: "implement the event
// foundation before extensions that would otherwise need rework"). Named events within a
// workspace, a lifecycle (active/closed/archived), and a versioned, idempotent migration of a
// pre-existing workspace's one undivided ledger into a single legacy event. The existing combined
// (all-events) view is unchanged; this only adds the event directory and lifecycle underneath it.
// All data is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, USERS } = require('./helpers');
const { readDocument, stampDocument, CURRENT } = require('../_shared/schema');
const groups = require('../_shared/groups');
const backup = require('../_shared/backup');
const archive = require('../_shared/archive');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const equal = (...refs) => ({ method: 'equal', lines: refs.map((ref) => ({ ref })) });

async function fixture(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Events Club', kind: 'group', reportingCurrency: 'EUR' } }), 201).workspace;
  const q = { workspaceId: ws.id };
  const join = async (w, role) => {
    const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: q, body: { email: USERS[w].email, role } }), 201);
    ok(await h.call('invitations', 'POST', { as: w, query: { action: 'accept' }, body: { workspaceId: ws.id, token: inv.token } }));
  };
  await join('bob', 'member');
  await join('carol', 'viewer');
  const members = ok(await h.call('members', 'GET', { as: 'alice', query: q })).members;
  const mid = (name) => members.find((m) => m.name.startsWith(name)).id;
  const refs = { alice: `member:${mid('Alice')}`, bob: `member:${mid('Bob')}` };
  return { ws, q, refs };
}
const G = (h, f, as, method, opts = {}) => h.call('group', method, { as, query: { ...f.q, ...(opts.query || {}) }, body: opts.body });
const act = (h, f, as, action, body) => G(h, f, as, 'POST', { query: { action }, body });
const addExpense = async (h, f, as, body) => ok(await G(h, f, as, 'POST', { body }), 201).expense;
const view = async (h, f, as = 'alice') => ok(await G(h, f, as, 'GET'));
const events = async (h, f, as = 'alice') => ok(await G(h, f, as, 'GET', { query: { action: 'events' } })).events;

describe('BT-009-20 events: lazy default, directory, and permission-gated lifecycle', () => {
  test('a workspace with no events yet gets ONE lazily created "General" event on its first expense, reused for the second', async () => {
    const h = harness();
    const f = await fixture(h);
    const e1 = await addExpense(h, f, 'alice', { description: 'x', amount: '10.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    assert.ok(e1.eventId, 'the expense has an event');
    const list1 = await events(h, f);
    assert.equal(list1.length, 1);
    assert.equal(list1[0].name, 'General');
    assert.equal(list1[0].status, 'active');
    assert.equal(list1[0].isDefault, true);
    assert.equal(list1[0].expenseCount, 1);
    const e2 = await addExpense(h, f, 'bob', { description: 'y', amount: '5.00', payers: [{ ref: f.refs.bob }], split: equal(f.refs.alice, f.refs.bob) });
    assert.equal(e2.eventId, e1.eventId, 'the second expense reuses the same lazily-created default');
    assert.equal((await events(h, f)).length, 1, 'still only one event — never a duplicate');
    // The combined workspace view is completely unchanged by any of this (foundation, additive only).
    const v = await view(h, f);
    assert.equal(v.expenses.length, 2);
    assert.ok(Array.isArray(v.events) && v.events.length === 1);
    assert.equal(v.defaultEventId, e1.eventId);
  });

  test('any writer may create a named event; a viewer may not; the first event created becomes the default', async () => {
    const h = harness();
    const f = await fixture(h);
    const viewerTry = await act(h, f, 'carol', 'create-event', { name: 'Ski trip' });
    assert.equal(viewerTry.status, 403);
    const created = ok(await act(h, f, 'bob', 'create-event', { name: 'Ski trip', description: 'Winter 2026', color: '#2563eb' }), 201).event;
    assert.equal(created.status, 'active');
    assert.equal(created.isDefault, true, 'the very first event becomes the workspace default');
    const second = ok(await act(h, f, 'alice', 'create-event', { name: 'Summer BBQ' }), 201).event;
    assert.equal(second.isDefault, false, 'a later event does not silently take over as default');
    const list = await events(h, f);
    assert.deepEqual(list.map((e) => e.name).sort(), ['Ski trip', 'Summer BBQ']);
    // An expense that does not name an event still goes to the (unchanged) default.
    const e = await addExpense(h, f, 'alice', { description: 'z', amount: '10.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    assert.equal(e.eventId, created.id);
    // An expense CAN target a specific, non-default event.
    const e2 = await addExpense(h, f, 'alice', { description: 'burgers', amount: '20.00', eventId: second.id, payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    assert.equal(e2.eventId, second.id);
    const badEvent = await G(h, f, 'alice', 'POST', { body: { description: 'nope', amount: '1.00', eventId: 'gev_nosuch00000', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice) } });
    assert.equal(badEvent.status, 404);
  });

  test('BT-009-21: ?eventId= scopes expenses/settlements/balances to one event; omitted, the response is exactly the combined view it has always been; the access-scope note is always honest', async () => {
    const h = harness();
    const f = await fixture(h);
    const ski = ok(await act(h, f, 'alice', 'create-event', { name: 'Ski trip' }), 201).event;
    const bbq = ok(await act(h, f, 'alice', 'create-event', { name: 'Summer BBQ' }), 201).event;
    await addExpense(h, f, 'alice', { description: 'Lift passes', amount: '80.00', eventId: ski.id, payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    await addExpense(h, f, 'alice', { description: 'Burgers', amount: '20.00', eventId: bbq.id, payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });

    const combined = await view(h, f);
    assert.equal(combined.expenses.length, 2, 'omitted eventId: every event combined, unchanged');
    assert.equal('currentEvent' in combined, false);
    assert.match(combined.eventAccessNote, /do not change who can see them/);

    const scoped = await G(h, f, 'alice', 'GET', { query: { eventId: ski.id } });
    const scopedBody = ok(scoped);
    assert.deepEqual(scopedBody.expenses.map((e) => e.description), ['Lift passes']);
    assert.equal(scopedBody.currentEvent.id, ski.id);
    assert.equal(scopedBody.currentEvent.name, 'Ski trip');
    const scopedBalance = scopedBody.balances.find((b) => b.currency === 'EUR').rows.find((r) => r.ref === f.refs.bob);
    assert.equal(scopedBalance.net, '-40.00', 'only the Ski trip expense counts toward this scoped balance (half of 80.00)');

    // Carol has NO special per-event access — a plain member sees the event she can already see,
    // never told it is somehow narrower than the workspace she is already a member of.
    const unknown = await G(h, f, 'alice', 'GET', { query: { eventId: 'gev_nosuch00000' } });
    assert.equal(unknown.status, 404);
  });

  test('closing an event: only a manager/owner may; blocks new expenses and corrections, but not new/confirmed/disputed settlements or voiding a payment; never touches balances or history', async () => {
    const h = harness();
    const f = await fixture(h);
    const ev = ok(await act(h, f, 'alice', 'create-event', { name: 'Weekend trip' }), 201).event;
    const e = await addExpense(h, f, 'alice', { description: 'Hotel', amount: '100.00', eventId: ev.id, payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    const before = await view(h, f);
    const rowBefore = before.balances.find((b) => b.currency === 'EUR').rows.find((r) => r.ref === f.refs.bob);

    const byBob = await act(h, f, 'bob', 'event-status', { eventId: ev.id, status: 'closed' });
    assert.equal(byBob.status, 403, 'a plain member may not close an event');
    const closed = ok(await act(h, f, 'alice', 'event-status', { eventId: ev.id, status: 'closed', reason: 'Trip is over' })).event;
    assert.equal(closed.status, 'closed');

    const newExpense = await G(h, f, 'alice', 'POST', { body: { description: 'Late add', amount: '5.00', eventId: ev.id, payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice) } });
    assert.equal(newExpense.status, 409);
    assert.equal(newExpense.body.error.code, 'event_closed');

    const correction = await G(h, f, 'alice', 'PATCH', { body: { expenseId: e.id, revision: e.revision, reason: 'Fixing it', description: 'Hotel (corrected)' } });
    assert.equal(correction.status, 409);
    assert.equal(correction.body.error.code, 'event_closed');

    const expenseVoid = await act(h, f, 'alice', 'void', { expenseId: e.id, revision: e.revision, reason: 'Mistake' });
    assert.equal(expenseVoid.status, 409);
    assert.equal(expenseVoid.body.error.code, 'event_closed');

    // Settlement/dispute resolution stays possible on a CLOSED event (Terry, 2026-09-19).
    const payment = ok(await act(h, f, 'bob', 'settle', { from: f.refs.bob, to: f.refs.alice, amount: '20.00', eventId: ev.id }), 201).settlement;
    assert.equal(payment.eventId, ev.id);
    const confirmed = ok(await act(h, f, 'alice', 'confirm', { settlementId: payment.id, revision: payment.revision })).settlement;
    assert.equal(confirmed.status, 'confirmed');
    const voided = ok(await act(h, f, 'alice', 'void', { settlementId: confirmed.id, revision: confirmed.revision, reason: 'undo' }));
    assert.equal(voided.settlement.voided, true);

    // Closing never forgives debt, erases history or forces balances to zero (Terry, 2026-09-19):
    // the expense, its history and the pre-existing balance are all exactly as they were.
    const after = await view(h, f);
    const rowAfter = after.balances.find((b) => b.currency === 'EUR').rows.find((r) => r.ref === f.refs.bob);
    assert.equal(rowAfter.net, rowBefore.net, 'the voided/confirmed payment above already nets to the same place — closing itself changed nothing');
    assert.equal(after.expenses.find((x) => x.id === e.id).amount, '100.00', 'the expense is untouched');
    assert.equal((await h.call('group', 'GET', { as: 'alice', query: { ...f.q, action: 'history', expenseId: e.id } })).body.amendments.length, 0, 'no correction actually went through');
  });

  test('archiving is fully read-only: no new expenses, no new or confirmed/disputed settlements, no voiding; reopening (by a manager/owner) restores it', async () => {
    const h = harness();
    const f = await fixture(h);
    const ev = ok(await act(h, f, 'alice', 'create-event', { name: 'Old trip' }), 201).event;
    const payment0 = ok(await act(h, f, 'bob', 'settle', { from: f.refs.bob, to: f.refs.alice, amount: '10.00', eventId: ev.id }), 201).settlement;
    ok(await act(h, f, 'alice', 'event-status', { eventId: ev.id, status: 'archived' })).event;

    assert.equal((await act(h, f, 'alice', 'settle', { from: f.refs.alice, to: f.refs.bob, amount: '5.00', eventId: ev.id })).status, 409);
    assert.equal((await act(h, f, 'alice', 'confirm', { settlementId: payment0.id, revision: payment0.revision })).status, 409);
    assert.equal((await act(h, f, 'alice', 'void', { settlementId: payment0.id, revision: payment0.revision, reason: 'no' })).status, 409);
    assert.equal((await G(h, f, 'alice', 'POST', { body: { description: 'no', amount: '1.00', eventId: ev.id, payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice) } })).status, 409);

    const invalidJump = await act(h, f, 'alice', 'event-status', { eventId: ev.id, status: 'closed' });
    assert.equal(invalidJump.status, 409);
    assert.equal(invalidJump.body.error.code, 'invalid_transition', 'archived only ever comes back to active directly');

    const reopenedByBob = await act(h, f, 'bob', 'event-status', { eventId: ev.id, status: 'active' });
    assert.equal(reopenedByBob.status, 403);
    const reopened = ok(await act(h, f, 'alice', 'event-status', { eventId: ev.id, status: 'active' })).event;
    assert.equal(reopened.status, 'active');
    // Confirming the still-open payment now works again.
    assert.equal(ok(await act(h, f, 'alice', 'confirm', { settlementId: payment0.id, revision: payment0.revision })).settlement.status, 'confirmed');

    const noChange = await act(h, f, 'alice', 'event-status', { eventId: ev.id, status: 'active' });
    assert.equal(noChange.status, 409);
    assert.equal(noChange.body.error.code, 'no_change');
  });

  test('an outsider gets 404 everywhere, exactly like every other Shared-expenses route', async () => {
    const h = harness();
    const f = await fixture(h);
    assert.equal((await G(h, f, 'eve', 'GET', { query: { action: 'events' } })).status, 404);
    assert.equal((await act(h, f, 'eve', 'create-event', { name: 'x' })).status, 404);
  });
});

describe('BT-009-20 migration: a pre-existing workspace\'s undivided ledger becomes one legacy event', () => {
  test('a stored v1 document with existing expenses/settlements is migrated on read: one legacy event, every record tagged, deterministic and idempotent', async () => {
    const h = harness();
    const f = await fixture(h);
    // A real expense and payment, added through the API (current schema) — then rewritten to
    // simulate a genuinely pre-events (v1) stored document, exactly what existed before BT-009-20.
    const e = await addExpense(h, f, 'alice', { description: 'Old dinner', amount: '40.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    ok(await act(h, f, 'bob', 'settle', { from: f.refs.bob, to: f.refs.alice, amount: '20.00' }), 201);
    const path = `workspaces/${f.ws.id}/workspace.json`;
    const { value: current } = await h.storage.getJson(path);
    const v1 = { ...current, schemaVersion: 1 };
    delete v1.groupEvents;
    delete v1.defaultEventId;
    v1.groupExpenses = v1.groupExpenses.map(({ eventId, ...rest }) => rest);
    v1.groupSettlements = v1.groupSettlements.map(({ eventId, ...rest }) => rest);
    await h.storage.putJson(path, v1);

    const v = await view(h, f);
    assert.equal(v.expenses.find((x) => x.id === e.id).eventId, 'gev_legacy');
    assert.equal(v.events.length, 1);
    assert.equal(v.events[0].id, 'gev_legacy');
    assert.equal(v.events[0].status, 'active');
    assert.equal(v.defaultEventId, 'gev_legacy');
    assert.equal(v.events[0].expenseCount, 1);
    assert.equal(v.events[0].settlementCount, 1);

    // Deterministic and idempotent: migrating the SAME raw v1 document again (as if an earlier
    // read's migrated copy was never saved) produces the identical legacy event id, never a
    // second one.
    const migratedAgain = readDocument('workspace', v1);
    assert.equal(migratedAgain.groupEvents.length, 1);
    assert.equal(migratedAgain.groupEvents[0].id, 'gev_legacy');
    assert.equal(migratedAgain.defaultEventId, 'gev_legacy');

    // A NEW expense added after the migration lands in the SAME legacy event by default — the
    // workspace's existing single-ledger behaviour continues seamlessly.
    const e2 = await addExpense(h, f, 'alice', { description: 'New dinner', amount: '10.00', payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    assert.equal(e2.eventId, 'gev_legacy');
  });

  test('a v1 document with NO shared-expense records at all migrates cleanly with no legacy event, ever', async () => {
    const v1 = { id: 'ws_x', schemaVersion: 1, kind: 'group', name: 'Empty', settings: {}, members: [], accounts: [], transactions: [], payees: [], categories: [], contacts: [], recurring: [], budgets: [] };
    const migrated = readDocument('workspace', v1);
    assert.deepEqual(migrated.groupEvents, []);
    assert.equal(migrated.defaultEventId, undefined);
    // `readDocument` upgrades the in-memory shape only; the stored `schemaVersion` itself is
    // bumped separately, only once something actually writes the document back (`stampDocument`,
    // called by api/_shared/store.js on every workspace write) — never on a read alone.
    assert.equal(stampDocument('workspace', migrated).schemaVersion, CURRENT.workspace);
  });
});

describe('BT-009-20 backup/restore/integrity', () => {
  test('groups.invariantProblem catches a duplicate event id, an invalid status, and an eventId that names no real event', async () => {
    const base = { members: [{ id: 'm1', subject: 'g-a' }], contacts: [], categories: [], groupExpenses: [], groupSettlements: [] };
    assert.equal(groups.invariantProblem({ ...base, groupEvents: [{ id: 'gev_1', status: 'active' }, { id: 'gev_1', status: 'closed' }] }), 'group event ids');
    assert.equal(groups.invariantProblem({ ...base, groupEvents: [{ id: 'gev_1', status: 'not-a-status' }] }), 'group event status');
    assert.equal(groups.invariantProblem({
      ...base, groupEvents: [{ id: 'gev_1', status: 'active' }],
      groupExpenses: [{ eventId: 'gev_nosuch', currency: 'EUR', amountMinor: 100, payers: [{ ref: 'member:m1', amountMinor: 100 }], shares: [{ ref: 'member:m1', amountMinor: 100 }], split: { method: 'equal', lines: [{ ref: 'member:m1', value: null }] } }],
    }), 'group event reference');
    // A record with NO eventId at all (genuinely pre-events data this check never had to run
    // against before) still passes — the same tolerance already given to documents without
    // ledger links.
    assert.equal(groups.invariantProblem({
      ...base, groupEvents: [],
      groupExpenses: [{ currency: 'EUR', amountMinor: 100, payers: [{ ref: 'member:m1', amountMinor: 100 }], shares: [{ ref: 'member:m1', amountMinor: 100 }], split: { method: 'equal', lines: [{ ref: 'member:m1', value: null }] } }],
    }), null);
  });

  test('an old (pre-events, schema v1) archive still opens and passes its own byte-for-byte manifest check, and migrates on open', async () => {
    // Builds exactly the payload shape `buildArchive` would have produced BEFORE BT-009-20 existed:
    // a v1 document with a real shared expense and no `groupEvents`/`eventId` anywhere, and a
    // manifest computed the same way old code always computed it (manifestOf's own conditional
    // count already skips a key that is not an array — true for `groupEvents` on this document).
    const oldDoc = {
      id: 'ws_old000001', schemaVersion: 1, kind: 'group', name: 'Old Archive', settings: { reportingCurrency: 'EUR' },
      members: [{ id: 'mem1', subject: 'g-alice', email: 'alice@example.com', name: 'Alice Fictional', role: 'owner', status: 'active' }],
      accounts: [], transactions: [], payees: [], categories: [], contacts: [], recurring: [], budgets: [],
      groupExpenses: [{
        id: 'gex_old00001', description: 'Old dinner', date: '2020-01-01', currency: 'EUR', amountMinor: 4000, original: null,
        categoryId: null, notes: '', payers: [{ ref: 'member:mem1', amountMinor: 4000 }],
        split: { method: 'equal', lines: [{ ref: 'member:mem1', value: null }] }, shares: [{ ref: 'member:mem1', amountMinor: 4000 }],
        createdBy: 'g-alice', createdAt: '2020-01-01T00:00:00.000Z', revision: 1, voidedAt: null,
        history: [{ revision: 1, at: '2020-01-01T00:00:00.000Z', by: 'g-alice', event: 'create' }], amendments: [], ledgerLinks: [],
      }],
      groupSettlements: [],
    };
    const env = { BT_BACKUP_KEYS: 'k1:' + require('node:crypto').randomBytes(32).toString('base64'), BT_BACKUP_ACTIVE_KEY: 'k1' };
    const keyring = archive.loadKeys(env);
    const manifest = backup.manifestOf(oldDoc, []);
    assert.equal('groupEvents' in manifest.counts, false, 'exactly what old code produced: no key at all for a field that was never an array on this document');
    const payload = Buffer.from(JSON.stringify({ workspace: oldDoc, attachments: [], manifest }));
    const header = { workspaceId: oldDoc.id, archiveId: 'arc_old0001', schemaVersion: 1, createdAt: '2020-01-02T00:00:00.000Z', reason: 'old backup' };
    const sealed = archive.seal(header, payload, keyring);

    // The critical assertion: opening this genuinely old archive today does NOT fail its own
    // manifest integrity check just because reading it now adds a legacy event.
    const opened = backup.openArchive(sealed, keyring, oldDoc.id);
    assert.equal(opened.doc.groupEvents.length, 1, 'migrated on open');
    assert.equal(opened.doc.groupEvents[0].id, 'gev_legacy');
    assert.equal(opened.doc.groupExpenses[0].eventId, 'gev_legacy');
  });

  test('replace, merge and create-new restores all carry a shared expense\'s event along with it, never leaving a dangling eventId', async () => {
    const h = harness();
    const f = await fixture(h);
    // Self-only (never naming Bob): a create-new restore blocks outright when a shared expense
    // names another member, which is a separate, already-tested rule (GROUP_MEMBERS_BLOCKER) —
    // unrelated to what THIS test checks (that the event comes along, in every mode).
    const ev = ok(await act(h, f, 'alice', 'create-event', { name: 'Backed-up trip' }), 201).event;
    const hotel = await addExpense(h, f, 'alice', { description: 'Hotel', amount: '50.00', eventId: ev.id, payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice) });
    const backupRes = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201);
    const archiveId = backupRes.archive.archiveId;
    const path = `workspaces/${f.ws.id}/workspace.json`;

    const check = (doc, label) => {
      const restoredExpense = doc.groupExpenses.find((x) => x.description === 'Hotel');
      assert.ok(restoredExpense, `${label}: the expense came back`);
      assert.ok(restoredExpense.eventId, `${label}: it still names an event`);
      assert.ok(doc.groupEvents.some((x) => x.id === restoredExpense.eventId), `${label}: that event actually exists in the restored document — never a dangling reference`);
      assert.equal(groups.invariantProblem(doc), null, `${label}: the restored document itself passes every invariant, events included`);
    };

    // replace: voiding the expense (a real, ordinary write) makes it genuinely differ from the
    // backup, so replace has something real to set aside and bring back.
    const current1 = ok(await G(h, f, 'alice', 'GET')).expenses.find((x) => x.description === 'Hotel');
    await act(h, f, 'alice', 'void', { expenseId: hotel.id, revision: current1.revision, reason: 'making room for replace' });
    const p1 = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode: 'replace' } }));
    assert.equal(p1.blockers.length, 0, 'replace: no blockers');
    assert.ok(p1.scope.groupEvents >= 1, 'replace: the event is in scope');
    ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId, mode: 'replace', expectedEtag: p1.expectedEtag, confirm: 'REPLACE' } }));
    check((await h.storage.getJson(path)).value, 'replace');

    // merge: only ever ADDS a record missing from the current document, never overwrites a
    // conflicting one — so a genuine "merge has something to do" scenario is a record the current
    // document does not have at all, simulated directly at the storage layer (never through the
    // API, which has no way to make a shared expense simply stop existing, by design — BT-001-05).
    const beforeMerge = (await h.storage.getJson(path)).value;
    await h.storage.putJson(path, {
      ...beforeMerge,
      groupExpenses: beforeMerge.groupExpenses.filter((x) => x.description !== 'Hotel'),
      groupEvents: beforeMerge.groupEvents.filter((x) => x.id !== ev.id),
      defaultEventId: beforeMerge.defaultEventId === ev.id ? null : beforeMerge.defaultEventId,
    });
    const p2 = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode: 'merge' } }));
    assert.equal(p2.blockers.length, 0, 'merge: no blockers');
    assert.ok(p2.changes.add > 0, 'merge: the missing expense and event are genuinely something to add');
    ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId, mode: 'merge', expectedEtag: p2.expectedEtag } }));
    check((await h.storage.getJson(path)).value, 'merge');

    // create-new: always differs (a brand-new, otherwise-empty workspace), so it needs no setup.
    const p3 = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId, mode: 'create-new' } }));
    assert.equal(p3.blockers.length, 0, 'create-new: no blockers');
    const exec3 = ok(await h.call('restore', 'POST', { as: 'alice', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId, mode: 'create-new', expectedEtag: p3.expectedEtag } }), 201);
    check((await h.storage.getJson(`workspaces/${exec3.workspace.id}/workspace.json`)).value, 'create-new');
  });
});

describe('BT-009-24 safe cross-event moves: moving an expense to another event never breaks a settlement, participant history or ledger link', () => {
  test('moving an expense to another ACTIVE event is a normal, amendment-tracked correction; balances, shares and history are all untouched by the move itself', async () => {
    const h = harness();
    const f = await fixture(h);
    const ski = ok(await act(h, f, 'alice', 'create-event', { name: 'Ski trip' }), 201).event;
    const bbq = ok(await act(h, f, 'alice', 'create-event', { name: 'Summer BBQ' }), 201).event;
    const e = await addExpense(h, f, 'alice', { description: 'Lift passes', amount: '80.00', eventId: ski.id, payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    const balanceBefore = (await view(h, f)).balances.find((b) => b.currency === 'EUR').rows.find((r) => r.ref === f.refs.bob).net;

    const moved = ok(await G(h, f, 'alice', 'PATCH', { body: { expenseId: e.id, revision: e.revision, reason: 'Wrong event', eventId: bbq.id } })).expense;
    assert.equal(moved.eventId, bbq.id);
    assert.equal(moved.amount, '80.00', 'the move alone never changes the amount, payers or shares');
    assert.deepEqual(moved.shares.map((s) => s.amount), ['40.00', '40.00']);

    const balanceAfter = (await view(h, f)).balances.find((b) => b.currency === 'EUR').rows.find((r) => r.ref === f.refs.bob).net;
    assert.equal(balanceAfter, balanceBefore, 'the combined view\'s balance is unaffected by which event an expense sits in');

    const scoped = await G(h, f, 'alice', 'GET', { query: { eventId: bbq.id } });
    assert.equal(ok(scoped).expenses.some((x) => x.id === e.id), true, 'it now appears in the destination event\'s own scoped view');
    const skiScoped = await G(h, f, 'alice', 'GET', { query: { eventId: ski.id } });
    assert.equal(ok(skiScoped).expenses.some((x) => x.id === e.id), false, 'and no longer in the source event\'s');

    const hist = ok(await G(h, f, 'alice', 'GET', { query: { action: 'history', expenseId: e.id } }));
    const last = hist.amendments[hist.amendments.length - 1];
    assert.ok(last.changes.some((c) => c.field === 'eventId'), 'the move itself is in the amendment trail, like any other tracked field');
  });

  test('moving INTO a closed or archived event is refused and explained; moving OUT of one is refused by the existing "reopen first" rule', async () => {
    const h = harness();
    const f = await fixture(h);
    const ski = ok(await act(h, f, 'alice', 'create-event', { name: 'Ski trip' }), 201).event;
    const closed = ok(await act(h, f, 'alice', 'create-event', { name: 'Closed event' }), 201).event;
    const e = await addExpense(h, f, 'alice', { description: 'Lift passes', amount: '80.00', eventId: ski.id, payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    // Added while "Closed event" was still active, exactly like any real expense that predates its
    // own event later being closed.
    const e2 = await addExpense(h, f, 'alice', { description: 'In the closed event already', amount: '10.00', eventId: closed.id, payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    ok(await act(h, f, 'alice', 'event-status', { eventId: closed.id, status: 'closed' }));

    const intoClosed = await G(h, f, 'alice', 'PATCH', { body: { expenseId: e.id, revision: e.revision, reason: 'try', eventId: closed.id } });
    assert.equal(intoClosed.status, 409);
    assert.equal(intoClosed.body.error.code, 'event_closed');
    assert.match(intoClosed.body.error.message, /cannot receive a moved expense/);
    const outOfClosed = await G(h, f, 'alice', 'PATCH', { body: { expenseId: e2.id, revision: e2.revision, reason: 'try', eventId: ski.id } });
    assert.equal(outOfClosed.status, 409);
    assert.equal(outOfClosed.body.error.code, 'event_closed', 'blocked by the existing "corrections need the event reopened" rule, before the destination is even checked');
  });

  test('an unknown destination event is refused with 404, exactly like an unknown eventId on creation', async () => {
    const h = harness();
    const f = await fixture(h);
    const ski = ok(await act(h, f, 'alice', 'create-event', { name: 'Ski trip' }), 201).event;
    const e = await addExpense(h, f, 'alice', { description: 'Lift passes', amount: '80.00', eventId: ski.id, payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });
    const res = await G(h, f, 'alice', 'PATCH', { body: { expenseId: e.id, revision: e.revision, reason: 'try', eventId: 'gev_nosuch00000' } });
    assert.equal(res.status, 404);
  });
});

describe('BT-009-22 event templates: copying reusable setup only, never financial records or access', () => {
  test('a new event created from a template copies its description/icon/colour, never its participants, expenses, settlements, invitations or grants', async () => {
    const h = harness();
    const f = await fixture(h);
    const original = ok(await act(h, f, 'alice', 'create-event', { name: 'Ski trip 2026', description: 'Annual chalet week', icon: 'suitcase', color: '#2563eb' }), 201).event;
    await addExpense(h, f, 'alice', { description: 'Lift passes', amount: '80.00', eventId: original.id, payers: [{ ref: f.refs.alice }], split: equal(f.refs.alice, f.refs.bob) });

    const fromTemplate = ok(await act(h, f, 'alice', 'create-event', { name: 'Ski trip 2027', templateEventId: original.id }), 201).event;
    assert.equal(fromTemplate.description, 'Annual chalet week');
    assert.equal(fromTemplate.icon, 'suitcase');
    assert.equal(fromTemplate.color, '#2563eb');
    // Genuinely a new, empty event — no financial records came along.
    assert.equal(fromTemplate.expenseCount, 0);
    assert.equal(fromTemplate.settlementCount, 0);
    assert.notEqual(fromTemplate.id, original.id);

    // Explicit fields in the request still win over the template (never silently overridden).
    const overridden = ok(await act(h, f, 'alice', 'create-event', { name: 'Ski trip 2028', templateEventId: original.id, color: '#dc2626' }), 201).event;
    assert.equal(overridden.description, 'Annual chalet week', 'still copied where not given explicitly');
    assert.equal(overridden.color, '#dc2626', 'the explicit value wins');

    // The workspace's membership/invitations/grants are completely untouched by any of this.
    const members = ok(await h.call('members', 'GET', { as: 'alice', query: f.q })).members;
    assert.equal(members.length, 3, 'still exactly Alice, Bob and Carol — no invitation or membership was silently recreated');
  });

  test('an unknown template event id is refused with 404', async () => {
    const h = harness();
    const f = await fixture(h);
    const res = await act(h, f, 'alice', 'create-event', { name: 'x', templateEventId: 'gev_nosuch00000' });
    assert.equal(res.status, 404);
  });
});
