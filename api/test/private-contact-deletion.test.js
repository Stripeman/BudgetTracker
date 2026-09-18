'use strict';
// PRIVATE CONTACT PERMANENT DELETION (BT-014 follow-up): closes the disclosed gap that a private
// contact — living in the person's own document, referenced only as `pcontact:<id>` on THAT
// person's own private records — could not be scanned for cross-workspace references and so was
// never offered permanent deletion (archive-only). Mirrors deletion.js's own two-step contract:
// fresh recompute at execute time, a fingerprint that detects drift between review and
// confirmation, and a typed confirmation. All data is fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };

describe('BT-014 follow-up: private contact permanent deletion', () => {
  test('an unreferenced private contact is deletable after review and a typed confirmation; it is really gone', async () => {
    const h = harness();
    await household(h);
    const c = ok(await h.call('contacts', 'POST', { as: 'bob', body: { scope: 'private', name: 'Fictional Landlord' } }), 201).contact;
    const impact = ok(await h.call('contacts', 'POST', { as: 'bob', query: { action: 'delete-impact' }, body: { scope: 'private', contactId: c.id } })).impact;
    assert.equal(impact.blocked, false);
    assert.equal(impact.label, 'Fictional Landlord');
    assert.ok(impact.token);
    const out = ok(await h.call('contacts', 'POST', { as: 'bob', query: { action: 'delete-permanent' }, body: { scope: 'private', contactId: c.id, impactToken: impact.token, typedConfirmation: 'Fictional Landlord' } }));
    assert.equal(out.deleted, true);
    const list = ok(await h.call('contacts', 'GET', { as: 'bob' }));
    assert.deepEqual(list.private, []);
    // Really gone, not merely archived: even asking with includeArchived shows nothing.
    const withArchived = ok(await h.call('contacts', 'GET', { as: 'bob', query: { includeArchived: '1' } }));
    assert.deepEqual(withArchived.private, []);
  });

  test('a private contact referenced as responsible on the owner\'s own private-account entry is blocked, with a real count, until that reference changes', async () => {
    const h = harness();
    const f = await household(h);
    const c = ok(await h.call('contacts', 'POST', { as: 'bob', body: { scope: 'private', name: 'Fictional Roommate' } }), 201).contact;
    const entry = ok(await h.call('transactions', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, kind: 'expense', amount: '40.00', responsibleRef: c.ref } }), 201).transactions[0];
    const impact = ok(await h.call('contacts', 'POST', { as: 'bob', query: { action: 'delete-impact' }, body: { scope: 'private', contactId: c.id } })).impact;
    assert.equal(impact.blocked, true);
    assert.match(impact.blockers[0], /1 entry names this contact/);
    const blocked = await h.call('contacts', 'POST', { as: 'bob', query: { action: 'delete-permanent' }, body: { scope: 'private', contactId: c.id, impactToken: impact.token, typedConfirmation: 'Fictional Roommate' } });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'delete_blocked');
    // Clear the reference, then it becomes deletable — proving the scan is real, not a fixed refusal.
    ok(await h.call('transactions', 'PATCH', { as: 'bob', query: f.q, body: { transactionId: entry.id, revision: entry.revision, responsibleRef: null, reason: 'No longer responsible' } }));
    const clearImpact = ok(await h.call('contacts', 'POST', { as: 'bob', query: { action: 'delete-impact' }, body: { scope: 'private', contactId: c.id } })).impact;
    assert.equal(clearImpact.blocked, false);
    ok(await h.call('contacts', 'POST', { as: 'bob', query: { action: 'delete-permanent' }, body: { scope: 'private', contactId: c.id, impactToken: clearImpact.token, typedConfirmation: 'Fictional Roommate' } }));
  });

  test('a wrong typed confirmation is refused; a stale impact token (something changed since review) is refused and never trusted from the client', async () => {
    const h = harness();
    const f = await household(h);
    const c = ok(await h.call('contacts', 'POST', { as: 'bob', body: { scope: 'private', name: 'Fictional Cousin' } }), 201).contact;
    const impact = ok(await h.call('contacts', 'POST', { as: 'bob', query: { action: 'delete-impact' }, body: { scope: 'private', contactId: c.id } })).impact;
    const wrongName = await h.call('contacts', 'POST', { as: 'bob', query: { action: 'delete-permanent' }, body: { scope: 'private', contactId: c.id, impactToken: impact.token, typedConfirmation: 'Not The Name' } });
    assert.equal(wrongName.status, 400);
    assert.equal(wrongName.body.error.code, 'confirmation_mismatch');
    // Something new references it after the impact was reviewed but before confirming: the stale
    // token is refused, and — critically — this is caught even though the CLIENT still holds (and
    // resubmits) the old, now-wrong token, proving the server recomputes fresh rather than trusting it.
    await h.call('transactions', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, kind: 'expense', amount: '15.00', responsibleRef: c.ref } });
    const stale = await h.call('contacts', 'POST', { as: 'bob', query: { action: 'delete-permanent' }, body: { scope: 'private', contactId: c.id, impactToken: impact.token, typedConfirmation: 'Fictional Cousin' } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'delete_blocked', 'the new reference itself blocks it outright, caught by the fresh recompute, before any token comparison could even matter');
  });

  test('a private contact can never even be added to a shared expense in the first place (groups.participantChecker refuses it), so this scan needs no separate shared-expenses check', async () => {
    const h = harness();
    const f = await household(h);
    const trip = ok(await h.call('workspaces', 'POST', { as: 'bob', body: { name: 'Fictional Trip', kind: 'trip', reportingCurrency: 'EUR' } }), 201).workspace;
    const tq = { workspaceId: trip.id };
    const c = ok(await h.call('contacts', 'POST', { as: 'bob', body: { scope: 'private', name: 'Fictional Travel Buddy' } }), 201).contact;
    const memberId = ok(await h.call('members', 'GET', { as: 'bob', query: tq })).members[0].id;
    const refused = await h.call('group', 'POST', { as: 'bob', query: tq, body: { description: 'Fictional taxi', amount: '20.00', date: '2026-09-12', payers: [{ ref: `member:${memberId}` }], split: { method: 'equal', lines: [{ ref: c.ref }] } } });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error.code, 'private_contact');
  });

  test('only the owner can ever see or act on their own private contact — another member finds nothing, never someone else\'s data', async () => {
    const h = harness();
    await household(h);
    const c = ok(await h.call('contacts', 'POST', { as: 'bob', body: { scope: 'private', name: 'Fictional Sister' } }), 201).contact;
    const asAlice = await h.call('contacts', 'POST', { as: 'alice', query: { action: 'delete-impact' }, body: { scope: 'private', contactId: c.id } });
    assert.equal(asAlice.status, 404);
  });
});
