'use strict';
// Regression tests for the independent security review pinned at main `c4baed3` (2026-09-18,
// docs/BudgetTracker-review.md — kept local/ignored, not published to this public repository).
// Every finding below was reproduced first against the pre-fix code, then fixed in
// api/_shared/store.js, api/_shared/storage.js, api/_shared/workspace-deletion.js,
// api/_shared/site-deletions.js, api/analytics/handler.js and api/workspaces/handler.js. All
// people and data are fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');
const { createMemoryStorage } = require('../_shared/storage');
const store = require('../_shared/store');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };

async function enableAccountRequests(h) {
  ok(await h.call('site-settings', 'PUT', { as: 'dave', body: { accountRequestsEnabled: true } }));
}

describe('S1 (High): first request could bypass administrator approval', () => {
  test('a brand-new account calling /api/preferences BEFORE ever calling /api/me still becomes pending, not approved', async () => {
    const h = harness();
    await enableAccountRequests(h);
    const NEWCOMER = { userId: 'g-newcomer1', email: 'newcomer1@example.com', name: 'Newcomer One' };
    // The exact reproduction from the review: a different first-use route, never /api/me.
    ok(await h.call('preferences', 'GET', { user: NEWCOMER }));
    const me = ok(await h.call('me', 'GET', { user: NEWCOMER }));
    assert.equal(me.user.pendingApproval, true, 'preferences must not have silently approved this account');
    const res = await h.call('workspaces', 'POST', { user: NEWCOMER, body: { name: 'Should be refused', kind: 'personal' } });
    assert.equal(res.status, 403);
  });

  test('a brand-new account calling /api/contacts BEFORE ever calling /api/me still becomes pending, not approved', async () => {
    const h = harness();
    await enableAccountRequests(h);
    const NEWCOMER = { userId: 'g-newcomer2', email: 'newcomer2@example.com', name: 'Newcomer Two' };
    // POST /api/contacts private scope creates the profile document via store.mutateUser directly.
    await h.call('contacts', 'POST', { user: NEWCOMER, body: { scope: 'private', name: 'A Friend' } });
    const me = ok(await h.call('me', 'GET', { user: NEWCOMER }));
    assert.equal(me.user.pendingApproval, true, 'contacts must not have silently approved this account');
    const res = await h.call('workspaces', 'POST', { user: NEWCOMER, body: { name: 'Should be refused', kind: 'personal' } });
    assert.equal(res.status, 403);
  });

  test('every profile-creation route resolves the SAME site policy: enabling requests after one route already ran does not retroactively pend that account (unchanged behaviour), but a route run AFTER enabling always pends', async () => {
    const h = harness();
    const EARLY = { userId: 'g-early', email: 'early@example.com', name: 'Early Bird' };
    ok(await h.call('preferences', 'GET', { user: EARLY })); // created while requests are off: approved.
    await enableAccountRequests(h);
    const early = ok(await h.call('me', 'GET', { user: EARLY }));
    assert.equal(early.user.pendingApproval, false, 'an already-approved account is never retroactively pended');
    const LATE = { userId: 'g-late', email: 'late@example.com', name: 'Late Arrival' };
    ok(await h.call('preferences', 'GET', { user: LATE })); // created after requests are on: pending.
    const late = ok(await h.call('me', 'GET', { user: LATE }));
    assert.equal(late.user.pendingApproval, true);
  });

  test('store.assertApproved (the shared gate now used by workspace creation, invitation acceptance and create-new restore) refuses a pending or rejected account and never blocks a site administrator', () => {
    const store = require('../_shared/store');
    assert.throws(() => store.assertApproved({ siteAdmin: false }, { approvalStatus: 'pending' }, 'do the thing'), /waiting for a site administrator to approve it before you can do the thing/);
    assert.throws(() => store.assertApproved({ siteAdmin: false }, { approvalStatus: 'rejected' }), /not approved/);
    // Never blocked: an approved account, no approvalStatus at all (legacy documents), or a site admin.
    store.assertApproved({ siteAdmin: false }, { approvalStatus: 'approved' });
    store.assertApproved({ siteAdmin: false }, {});
    store.assertApproved({ siteAdmin: true }, { approvalStatus: 'pending' });
  });
});

describe('S2 (Medium): a successful permanent deletion must never be reported/audited as failed', () => {
  test('owner path: the completion-log write fails after the wipe already committed — the API still reports success, and the deletions log reconciles the stuck "pending" row to "completed"', async () => {
    let deletionWrites = 0;
    // Succeed on the '#pending' write (1st), fail the '#completed' write and all its retries (2nd-4th).
    const storage = createMemoryStorage({ failWrite: (name) => {
      if (name !== 'site/deletions.json') return false;
      deletionWrites += 1;
      return deletionWrites >= 2 && deletionWrites <= 4;
    } });
    const h = harness({ storage });
    const f = await household(h);
    const imp = ok(await h.call('workspaces', 'POST', { as: 'alice', query: { id: f.ws.id, action: 'delete-impact' } })).impact;
    // Must NOT surface as a 500 / failure, even though the audit completion write is broken.
    ok(await h.call('workspaces', 'POST', { as: 'alice', query: { id: f.ws.id, action: 'delete-permanent' }, body: { impactToken: imp.token, typedConfirmation: 'Fictional Household' } }));
    const doc = JSON.parse((await h.storage.getBytes(`workspaces/${f.ws.id}/workspace.json`)).bytes.toString());
    assert.equal(doc.status, 'deleted-permanent', 'the wipe really committed');
    const raw = JSON.parse((await h.storage.getBytes('site/deletions.json')).bytes.toString());
    const rawEntries = raw.entries.filter((e) => e.workspaceId === f.ws.id);
    assert.ok(rawEntries.every((e) => e.outcome !== 'failed'), 'a completed deletion must never be logged as failed');
    assert.ok(rawEntries.some((e) => e.outcome === 'pending'), 'the pending row is still there — the completion write never landed');
    assert.ok(!rawEntries.some((e) => e.outcome === 'completed'), 'reproduces the exact review finding: raw log has no completed entry');
    // The reconciled, admin-facing view tells the truth anyway.
    const log = ok(await h.call('analytics', 'GET', { as: 'dave', query: { action: 'deletions' } }));
    const viewEntry = log.deletions.find((e) => e.workspaceId === f.ws.id);
    assert.ok(viewEntry, 'the reconciled view still shows this deletion');
    assert.equal(viewEntry.outcome, 'completed', 'reconciled against the workspace\'s actual tombstoned state');
  });
});

describe('S3 (Medium): permanent workspace deletion purges attachment blobs', () => {
  test('a synthetic attachment blob under the deleted workspace no longer exists afterward', async () => {
    const h = harness();
    const f = await household(h);
    const blobName = `workspaces/${f.ws.id}/attachments/deadbeef00`;
    await h.storage.putBytes(blobName, Buffer.from('fictional receipt bytes'), { ifNoneMatch: '*' });
    assert.ok(await h.storage.getBytes(blobName), 'the attachment exists before deletion');
    const imp = ok(await h.call('workspaces', 'POST', { as: 'alice', query: { id: f.ws.id, action: 'delete-impact' } })).impact;
    ok(await h.call('workspaces', 'POST', { as: 'alice', query: { id: f.ws.id, action: 'delete-permanent' }, body: { impactToken: imp.token, typedConfirmation: 'Fictional Household' } }));
    assert.equal(await h.storage.getBytes(blobName), null, 'the attachment blob is purged, not merely unreachable through the API');
    const log = ok(await h.call('analytics', 'GET', { as: 'dave', query: { action: 'deletions' } }));
    const entry = log.deletions.find((e) => e.workspaceId === f.ws.id && e.outcome === 'completed');
    assert.equal(entry.attachmentsPurged, 1);
    assert.equal(entry.attachmentsFailed, 0);
  });

  test('administrative (site-admin) deletion also purges attachments', async () => {
    const h = harness();
    const f = await household(h);
    const blobName = `workspaces/${f.ws.id}/attachments/cafef00d00`;
    await h.storage.putBytes(blobName, Buffer.from('fictional receipt bytes'), { ifNoneMatch: '*' });
    const imp = ok(await h.call('analytics', 'POST', { as: 'dave', query: { action: 'delete-impact', workspaceId: f.ws.id } })).impact;
    ok(await h.call('analytics', 'POST', { as: 'dave', query: { action: 'delete-permanent', workspaceId: f.ws.id }, body: { impactToken: imp.token, typedConfirmation: imp.confirmPhrase } }));
    assert.equal(await h.storage.getBytes(blobName), null);
  });
});

describe('S4 (Medium): the approval queue and workspace directory never hide entries behind a capped scan', () => {
  test('a pending account is found even when it sits behind more already-approved profiles than a tiny response cap', async () => {
    const h = harness({ env: { BT_PENDING_CAP: 2 } });
    await enableAccountRequests(h);
    // Three already-approved profiles created first (while requests were off would be simplest, but
    // creating them AFTER enabling and then approving proves the scan itself, not just ordering).
    for (const n of [1, 2, 3]) {
      const u = { userId: `g-filler${n}`, email: `filler${n}@example.com`, name: `Filler ${n}` };
      ok(await h.call('me', 'GET', { user: u }));
      ok(await h.call('analytics', 'POST', { as: 'dave', query: { action: 'approve-user' }, body: { subject: `google:g-filler${n}` } }));
    }
    const LAST = { userId: 'g-lastpending', email: 'lastpending@example.com', name: 'Last Pending' };
    ok(await h.call('me', 'GET', { user: LAST })); // the 4th profile, still pending, cap is only 2.
    const queue = ok(await h.call('analytics', 'GET', { as: 'dave', query: { action: 'pending-users' } }));
    assert.deepEqual(queue.pending.map((p) => p.subject), ['google:g-lastpending'], 'found despite sitting behind 3 already-approved profiles with a cap of 2');
    assert.equal(queue.truncated, false, 'truthful: there is exactly one match, well under the cap');
  });

  test('the workspace directory finds a real workspace even when it sits behind more tombstoned (permanently-deleted) workspaces than a tiny response cap', async () => {
    const h = harness({ env: { BT_DIRECTORY_CAP: 1 } });
    const f1 = await household(h);
    const imp = ok(await h.call('workspaces', 'POST', { as: 'alice', query: { id: f1.ws.id, action: 'delete-impact' } })).impact;
    ok(await h.call('workspaces', 'POST', { as: 'alice', query: { id: f1.ws.id, action: 'delete-permanent' }, body: { impactToken: imp.token, typedConfirmation: 'Fictional Household' } }));
    // A real, live workspace created AFTER the tombstone (so it sorts after it in a naive capped scan).
    const ws2 = ok(await h.call('workspaces', 'POST', { as: 'bob', body: { name: 'Bob Personal', kind: 'personal' } }), 201).workspace;
    const dir = ok(await h.call('analytics', 'GET', { as: 'dave', query: { action: 'directory' } }));
    assert.ok(dir.workspaces.some((w) => w.id === ws2.id), 'the live workspace is found, not hidden behind the tombstone');
  });
});

describe('S5 (Medium): approval decisions carry an attributable audit trail', () => {
  test('approving a pending account records actor, timestamp and before/after status atomically with the decision', async () => {
    const h = harness();
    await enableAccountRequests(h);
    const NEWCOMER = { userId: 'g-newcomer4', email: 'newcomer4@example.com', name: 'Newcomer Four' };
    ok(await h.call('me', 'GET', { user: NEWCOMER }));
    ok(await h.call('analytics', 'POST', { as: 'dave', query: { action: 'approve-user' }, body: { subject: 'google:g-newcomer4' } }));
    const raw = JSON.parse((await h.storage.getBytes(store.paths.user('google:g-newcomer4'))).bytes.toString());
    assert.ok(Array.isArray(raw.approvalHistory) && raw.approvalHistory.length === 1);
    const entry = raw.approvalHistory[0];
    assert.equal(entry.by, 'google:g-dave');
    assert.equal(entry.from, 'pending');
    assert.equal(entry.to, 'approved');
    assert.ok(entry.at);
    assert.ok(entry.id);
  });

  test('reject then approve appends two distinct, attributable history entries', async () => {
    const h = harness();
    await enableAccountRequests(h);
    const NEWCOMER = { userId: 'g-newcomer5', email: 'newcomer5@example.com', name: 'Newcomer Five' };
    ok(await h.call('me', 'GET', { user: NEWCOMER }));
    ok(await h.call('analytics', 'POST', { as: 'dave', query: { action: 'reject-user' }, body: { subject: 'google:g-newcomer5' } }));
    ok(await h.call('analytics', 'POST', { as: 'dave', query: { action: 'approve-user' }, body: { subject: 'google:g-newcomer5' } }));
    const raw = JSON.parse((await h.storage.getBytes(store.paths.user('google:g-newcomer5'))).bytes.toString());
    assert.equal(raw.approvalHistory.length, 2);
    assert.deepEqual(raw.approvalHistory.map((e) => [e.from, e.to]), [['pending', 'rejected'], ['rejected', 'approved']]);
  });
});

describe('S6 (Medium): a malformed deletion log fails closed instead of silently discarding prior evidence', () => {
  test('valid JSON with the wrong shape at site/deletions.json is refused, not silently reset to an empty log', async () => {
    const h = harness();
    await h.storage.putJson('site/deletions.json', { notEntries: 'surprise' }, { ifNoneMatch: '*' });
    const res = await h.call('analytics', 'GET', { as: 'dave', query: { action: 'deletions' } });
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'deletion_log_corrupt');
    // The malformed document is untouched — proving nothing was silently discarded.
    const raw = JSON.parse((await h.storage.getBytes('site/deletions.json')).bytes.toString());
    assert.deepEqual(raw, { notEntries: 'surprise' });
  });

  test('a genuinely absent document is the one legitimate empty case', async () => {
    const h = harness();
    const res = ok(await h.call('analytics', 'GET', { as: 'dave', query: { action: 'deletions' } }));
    assert.deepEqual(res.deletions, []);
  });
});
