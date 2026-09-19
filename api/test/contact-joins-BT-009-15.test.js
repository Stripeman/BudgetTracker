'use strict';
// BT-009-15 (Terry's split-costs check, 2026-09-14): "A contact who later joins takes over their
// shared-expense history." Inviting a shared contact to join links the invitation to that contact
// (owners/managers only — the same 'invite' capability that gates the whole invitations route);
// on acceptance the new member's expenses, shares, payments and balance continue from the
// contact's — a single combined balance/history — while the records themselves are NEVER
// rewritten (the original `contact:<id>` ref stays in the stored expense forever). All data is
// fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, USERS } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };

async function fixture(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Trip Fund', kind: 'group', reportingCurrency: 'EUR' } }), 201).workspace;
  const q = { workspaceId: ws.id };
  const bobInv = ok(await h.call('invitations', 'POST', { as: 'alice', query: q, body: { email: USERS.bob.email, role: 'member' } }), 201);
  ok(await h.call('invitations', 'POST', { as: 'bob', query: { action: 'accept' }, body: { workspaceId: ws.id, token: bobInv.token } }));
  const members = ok(await h.call('members', 'GET', { as: 'alice', query: q })).members;
  const bobRef = `member:${members.find((m) => m.name.startsWith('Bob')).id}`;
  const dana = ok(await h.call('contacts', 'POST', { as: 'alice', body: { scope: 'workspace', workspaceId: ws.id, name: 'Dana Contact' } }), 201).contact;
  return { ws, q, bobRef, dana };
}
const equal = (...refs) => ({ method: 'equal', lines: refs.map((ref) => ({ ref })) });
const addExpense = async (h, q, as, body) => ok(await h.call('group', 'POST', { as, query: q, body }), 201).expense;
const view = async (h, q, as = 'alice') => ok(await h.call('group', 'GET', { as, query: q }));
const row = (v, ref) => v.balances.find((b) => b.currency === 'EUR').rows.find((r) => r.ref === ref);

describe('BT-009-15 a contact who later joins takes over their shared-expense history', () => {
  test('only an owner/manager can link an invitation to a contact (the same "invite" capability, no separate bypass); a member cannot invite at all, linked or not', async () => {
    const h = harness();
    const f = await fixture(h);
    const asMember = await h.call('invitations', 'POST', { as: 'bob', query: f.q, body: { email: USERS.eve.email, role: 'member', contactId: f.dana.id } });
    assert.equal(asMember.status, 403);
    const asOwner = await h.call('invitations', 'POST', { as: 'alice', query: f.q, body: { email: USERS.eve.email, role: 'member', contactId: f.dana.id } });
    assert.equal(asOwner.status, 201);
    assert.equal(asOwner.body.invitation.contactId, f.dana.id);
  });

  test('an unknown contactId is refused; an already-joined contact cannot be linked again; a contact already promised to a pending invitation cannot be linked to a second one', async () => {
    const h = harness();
    const f = await fixture(h);
    const unknown = await h.call('invitations', 'POST', { as: 'alice', query: f.q, body: { email: USERS.eve.email, role: 'member', contactId: 'con_nope' } });
    assert.equal(unknown.status, 404);

    const firstInv = ok(await h.call('invitations', 'POST', { as: 'alice', query: f.q, body: { email: USERS.eve.email, role: 'member', contactId: f.dana.id } }), 201);
    const secondAttempt = await h.call('invitations', 'POST', { as: 'alice', query: f.q, body: { email: 'someoneelse@example.com', role: 'member', contactId: f.dana.id } });
    assert.equal(secondAttempt.status, 409);
    assert.equal(secondAttempt.body.error.code, 'contact_already_invited');

    ok(await h.call('invitations', 'POST', { as: 'eve', query: { action: 'accept' }, body: { workspaceId: f.ws.id, token: firstInv.token } }));
    const afterJoined = await h.call('invitations', 'POST', { as: 'alice', query: f.q, body: { email: 'yetanother@example.com', role: 'member', contactId: f.dana.id } });
    assert.equal(afterJoined.status, 409);
    assert.equal(afterJoined.body.error.code, 'contact_already_joined');
  });

  test('accepting a linked invitation combines the contact\'s and the new member\'s balances/history into one, without rewriting the original record', async () => {
    const h = harness();
    const f = await fixture(h);
    // Dana (still a contact) pays for and shares dinner before ever joining.
    const dinner = await addExpense(h, f.q, 'alice', { description: 'Fictional dinner', date: '2026-09-14', amount: '60.00', payers: [{ ref: f.dana.ref, amount: '60.00' }], split: equal(f.dana.ref, f.bobRef) });
    const before = await view(h, f.q);
    assert.equal(row(before, f.dana.ref).netMinor > 0, true, 'Dana is owed money as a contact');

    const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: f.q, body: { email: USERS.eve.email, role: 'member', contactId: f.dana.id } }), 201);
    const accepted = ok(await h.call('invitations', 'POST', { as: 'eve', query: { action: 'accept' }, body: { workspaceId: f.ws.id, token: inv.token } }));
    const eveRef = `member:${accepted.memberId}`;

    // The contact record is KEPT and marked joined — never deleted, never silently renamed.
    const contactsAfter = ok(await h.call('contacts', 'GET', { as: 'alice', query: f.q }));
    const danaAfter = contactsAfter.shared.find((c) => c.id === f.dana.id);
    assert.equal(danaAfter.joinedMemberId, accepted.memberId);
    assert.equal(danaAfter.name, 'Dana Contact', 'the contact record itself is untouched');

    // Eve (now a real member) takes part in a second expense using HER OWN, new ref.
    await addExpense(h, f.q, 'alice', { description: 'Fictional taxi', date: '2026-09-15', amount: '20.00', payers: [{ ref: eveRef, amount: '20.00' }], split: equal(eveRef, f.bobRef) });

    const after = await view(h, f.q);
    // One combined row under the MEMBER ref: the dinner's contact-side numbers plus the taxi's
    // member-side numbers, never split across two rows.
    const combined = row(after, eveRef);
    assert.ok(combined, 'a single row exists under the new member ref');
    assert.equal(combined.paidMinor, 8000, '60.00 (dinner) + 20.00 (taxi) paid');
    assert.equal(combined.shareMinor, 4000, '30.00 (dinner) + 10.00 (taxi) shared');
    assert.equal(row(after, f.dana.ref), undefined, 'no separate row is left under the old contact ref');

    // The ORIGINAL stored expense record is never rewritten: it still literally names the contact,
    // not the member — proven by reading the actual expense, not the derived balances.
    const dinnerRecord = after.expenses.find((e) => e.id === dinner.id);
    assert.deepEqual(dinnerRecord.payers.map((p) => p.ref), [f.dana.ref]);
    assert.deepEqual(dinnerRecord.shares.map((s) => s.ref), [f.dana.ref, f.bobRef]);

    // Going forward, a NEW expense can no longer name the old contact ref directly — the
    // relationship is the member now, exactly as "continues from" implies for new activity.
    const refused = await h.call('group', 'POST', { as: 'alice', query: f.q, body: { description: 'Fictional snacks', date: '2026-09-16', amount: '10.00', payers: [{ ref: f.dana.ref, amount: '10.00' }], split: equal(f.dana.ref, f.bobRef) } });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error.code, 'invalid_person');

    // The joined contact is no longer offered as a separate choosable participant either.
    const people = ok(await h.call('people', 'GET', { as: 'alice', query: { ...f.q, field: 'participant' } })).options;
    assert.ok(!people.some((o) => o.ref === f.dana.ref), 'the old contact ref is not offered');
    assert.ok(people.some((o) => o.ref === eveRef), 'the new member is offered instead');
  });

  test('a joined contact can never be permanently deleted, even one never itself named in an expense before it joined', async () => {
    const h = harness();
    const f = await fixture(h);
    // Dana never took part in anything as a contact — invited and accepted immediately.
    const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: f.q, body: { email: USERS.eve.email, role: 'member', contactId: f.dana.id } }), 201);
    ok(await h.call('invitations', 'POST', { as: 'eve', query: { action: 'accept' }, body: { workspaceId: f.ws.id, token: inv.token } }));
    const impact = ok(await h.call('contacts', 'POST', { as: 'alice', query: { ...f.q, action: 'delete-impact' }, body: { contactId: f.dana.id } })).impact;
    assert.equal(impact.blocked, true);
    assert.match(impact.blockers.join(' '), /joined as a member/);
  });
});
