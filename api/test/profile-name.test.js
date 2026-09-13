'use strict';
// The name other members see (Terry's preview check, 2026-09-14): Static Web Apps never passes the
// provider's name to the API, so every member showed as "Member". People set it themselves.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const nina = { userId: 'g-nina', email: 'nina@example.com', name: '' };

test('a person sets the name other members see; it reaches their member record in every workspace', async () => {
  const h = harness();
  const f = await household(h);
  const me = ok(await h.call('me', 'PATCH', { as: 'bob', body: { name: 'Robert Fictional' } }));
  assert.equal(me.user.name, 'Robert Fictional');
  const bob = ok(await h.call('members', 'GET', { as: 'alice', query: f.q })).members.find((m) => m.id === f.memberId('Bob'));
  assert.equal(bob.name, 'Robert Fictional');
});

test('without a provider name, a new workspace and a join use the profile name instead of "Member"', async () => {
  const h = harness();
  const f = await household(h);
  ok(await h.call('me', 'PATCH', { user: nina, body: { name: 'Nina Fictional' } }));
  const ws = ok(await h.call('workspaces', 'POST', { user: nina, body: { name: 'Fictional Club' } }), 201).workspace;
  const self = ok(await h.call('members', 'GET', { user: nina, query: { workspaceId: ws.id } })).members.find((m) => m.self);
  assert.equal(self.name, 'Nina Fictional');
  const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: f.q, body: { email: nina.email, role: 'viewer' } }), 201);
  ok(await h.call('invitations', 'POST', { user: nina, query: { action: 'accept' }, body: { workspaceId: f.ws.id, token: inv.token } }));
  const joined = ok(await h.call('members', 'GET', { as: 'alice', query: f.q })).members.find((m) => m.email === nina.email);
  assert.equal(joined.name, 'Nina Fictional');
});

test('a self-set name is kept over the provider name, and names are validated', async () => {
  const h = harness();
  await household(h);
  ok(await h.call('me', 'PATCH', { as: 'alice', body: { name: 'Ally' } }));
  // Alice's sign-in still carries "Alice Fictional"; her own choice wins.
  assert.equal(ok(await h.call('me', 'GET', { as: 'alice' })).user.name, 'Ally');
  for (const body of [{ name: '' }, { name: `Al${String.fromCodePoint(0x202e)}ice` }, { name: 'x'.repeat(81) }, { name: 'Ally', extra: 1 }]) {
    assert.equal((await h.call('me', 'PATCH', { as: 'alice', body })).status, 400, JSON.stringify(body).slice(0, 40));
  }
});
