'use strict';
// Financial recheck of 53cf181 (N-1 to N-4 and the personal-defaults note). Every expected value is
// computed by hand in the comments. All people, accounts and amounts are fictional.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, USERS } = require('./helpers');

const FRANK = Object.freeze({ userId: 'g-frank', email: 'frank@example.com', name: 'Frank Fictional' });
const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const who = (w) => (typeof w === 'string' ? { as: w } : { user: w });

// Alice owner, Bob member, Carol viewer, Frank manager, Eve member, Dana a shared contact.
async function fixture(h) {
  const ws = ok(await h.call('workspaces', 'POST', { as: 'alice', body: { name: 'Fictional Recheck Three', kind: 'group', reportingCurrency: 'EUR' } }), 201).workspace;
  const q = { workspaceId: ws.id };
  const join = async (w, role) => {
    const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: q, body: { email: (typeof w === 'string' ? USERS[w] : w).email, role } }), 201);
    ok(await h.call('invitations', 'POST', { ...who(w), query: { action: 'accept' }, body: { workspaceId: ws.id, token: inv.token } }));
  };
  await join('bob', 'member');
  await join('carol', 'viewer');
  await join(FRANK, 'manager');
  await join('eve', 'member');
  const members = ok(await h.call('members', 'GET', { as: 'alice', query: q })).members;
  const mid = (name) => members.find((m) => m.name.startsWith(name)).id;
  const dana = ok(await h.call('contacts', 'POST', { as: 'alice', body: { scope: 'workspace', workspaceId: ws.id, name: 'Dana Contact' } }), 201).contact;
  const refs = { alice: `member:${mid('Alice')}`, bob: `member:${mid('Bob')}`, carol: `member:${mid('Carol')}`, frank: `member:${mid('Frank')}`, eve: `member:${mid('Eve')}`, dana: dana.ref };
  return { ws, q, refs, mid };
}

const G = (h, f, w, method, { query = {}, body } = {}) => h.call('group', method, { ...who(w), query: { ...f.q, ...query }, body });
const view = async (h, f, w = 'alice') => ok(await G(h, f, w, 'GET'));

describe('N-4: "Anyone who can confirm payments" says plainly that it includes the person who paid', () => {
  test('both settings that offer it return the option\'s explanation "This includes the person who paid."; no other option carries one', async () => {
    const h = harness();
    const f = await fixture(h);
    const settings = (await view(h, f)).groupSettings.settings;
    const explained = settings.flatMap((s) => (s.options || []).filter((o) => o.explanation).map((o) => [s.key, o.value, o.explanation]));
    assert.deepEqual(explained, [
      ['withdrawPayments', 'confirmers', 'This includes the person who paid.'],
      ['settleDisputes', 'confirmers', 'This includes the person who paid.'],
    ]);
  });
});
