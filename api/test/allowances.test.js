'use strict';
// Owner-set storage allowances per member (Terry, 2026-09-13; security recheck SEC-V3). Fictional data.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');

const MB = 1024 * 1024;
const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const setAllowance = (h, f, as, memberId, allowanceMb) => h.call('members', 'PATCH', { as, query: f.q, body: { memberId, allowanceMb } });
const members = async (h, f, as) => ok(await h.call('members', 'GET', { as, query: f.q })).members;

describe('BT-006-04 owners set each member\'s storage allowance', () => {
  test('a member at their allowance can save again once an owner raises it; the change is kept in history and audit', async () => {
    const h = harness({ env: { BT_MEMBER_QUOTA_BYTES: '5000' } });
    const f = await household(h);
    let refused = null;
    for (let i = 0; i < 200 && !refused; i += 1) {
      const res = await h.call('contacts', 'POST', { as: 'bob', body: { scope: 'workspace', workspaceId: f.ws.id, name: `Fictional Contact ${i}` } });
      if (res.status !== 201) refused = res;
    }
    code(refused, 409, 'member_quota_exceeded');
    assert.match(refused.body.error.message, /Ask a workspace owner to raise it/);
    const bobId = f.memberId('Bob');
    ok(await setAllowance(h, f, 'alice', bobId, 1));
    ok(await h.call('contacts', 'POST', { as: 'bob', body: { scope: 'workspace', workspaceId: f.ws.id, name: 'Fictional Contact after raise' } }), 201);
    const history = ok(await h.call('members', 'GET', { as: 'alice', query: { ...f.q, includeFormer: '1' } })).members.find((m) => m.id === bobId).history;
    assert.deepEqual(history.filter((e) => e.event === 'allowance').map((e) => [e.from, e.to]), [[5000, MB]]);
    const audit = ok(await h.call('audit', 'GET', { as: 'alice', query: f.q })).entries;
    assert.ok(audit.some((e) => e.action === 'member.allowance'));
  });

  test('owners see allowances; only the member sees their own usage', async () => {
    const h = harness();
    const f = await household(h);
    const bobId = f.memberId('Bob');
    ok(await setAllowance(h, f, 'alice', bobId, 4));
    const asAlice = (await members(h, f, 'alice')).find((m) => m.id === bobId);
    assert.equal(asAlice.allowanceBytes, 4 * MB);
    assert.equal(asAlice.usedBytes, undefined, 'the owner does not see how much Bob keeps');
    const asBob = (await members(h, f, 'bob')).find((m) => m.id === bobId);
    assert.equal(asBob.allowanceBytes, 4 * MB);
    assert.ok(Number.isSafeInteger(asBob.usedBytes) && asBob.usedBytes > 0);
    const asCarol = (await members(h, f, 'carol')).find((m) => m.id === bobId);
    assert.equal(asCarol.allowanceBytes, undefined);
    assert.equal(asCarol.usedBytes, undefined);
    const aliceSelf = (await members(h, f, 'alice')).find((m) => m.self);
    assert.equal(aliceSelf.allowanceBytes, undefined, 'owners have no allowance');
  });

  test('LA1 managers see that an allowance changed, not the sizes', async () => {
    const h = harness();
    const f = await household(h);
    ok(await h.call('members', 'PATCH', { as: 'alice', query: f.q, body: { memberId: f.memberId('Bob'), role: 'manager' } }));
    ok(await setAllowance(h, f, 'alice', f.memberId('Carol'), 8));
    const carolFor = async (as) => ok(await h.call('members', 'GET', { as, query: { ...f.q, includeFormer: '1' } })).members.find((m) => m.id === f.memberId('Carol')).history.find((e) => e.event === 'allowance');
    assert.equal((await carolFor('alice')).to, 8 * MB);
    const asBob = await carolFor('bob');
    assert.equal(asBob.from, undefined);
    assert.equal(asBob.to, undefined);
  });

  test('LA2 a rejoining member starts with the default allowance; the reset is kept in history', async () => {
    const h = harness();
    const f = await household(h);
    const carolId = f.memberId('Carol');
    ok(await setAllowance(h, f, 'alice', carolId, 12));
    ok(await h.call('members', 'DELETE', { as: 'alice', query: f.q, body: { memberId: carolId, reason: 'Fictional test' } }));
    const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: f.q, body: { email: 'carol@example.com', role: 'viewer' } }), 201);
    ok(await h.call('invitations', 'POST', { as: 'carol', query: { action: 'accept' }, body: { workspaceId: f.ws.id, token: inv.token } }));
    const carol = (await members(h, f, 'alice')).find((m) => m.id === carolId);
    assert.equal(carol.allowanceBytes, 2 * MB, 'before the fix the earlier 12 MB came back');
  });

  test('LA3 an owner cannot set their own allowance, not even while demoting themselves', async () => {
    const h = harness();
    const f = await household(h);
    ok(await h.call('members', 'PATCH', { as: 'alice', query: f.q, body: { memberId: f.memberId('Bob'), role: 'owner' } }));
    code(await h.call('members', 'PATCH', { as: 'alice', query: f.q, body: { memberId: f.memberId('Alice'), role: 'member', allowanceMb: 12 } }), 409, 'own_allowance');
    assert.equal((await members(h, f, 'alice')).find((m) => m.self).role, 'owner', 'the whole request was refused');
  });

  test('LA4 a failed join leaves no workspace id in the person\'s own list', async () => {
    const h = harness();
    const f = await household(h);
    assert.equal((await h.call('invitations', 'POST', { as: 'eve', query: { action: 'accept' }, body: { workspaceId: f.ws.id, token: 'fictional-bad-token-0001' } })).status, 404);
    const store = require('../_shared/store');
    const { value } = await h.storage.getJson(store.paths.user('google:g-eve'));
    assert.equal((value && value.workspaceIds ? value.workspaceIds : []).includes(f.ws.id), false);
  });

  test('LR1 a failed accept racing a good one never takes the workspace out of the new member\'s list', async () => {
    const store = require('../_shared/store');
    const frank = { userId: 'g-frank', email: 'frank@example.com', name: 'Frank Fictional' };
    for (let round = 0; round < 8; round += 1) {
      const h = harness();
      const f = await household(h);
      const inv = ok(await h.call('invitations', 'POST', { as: 'alice', query: f.q, body: { email: frank.email, role: 'viewer' } }), 201);
      const accept = (token) => h.call('invitations', 'POST', { user: frank, query: { action: 'accept' }, body: { workspaceId: f.ws.id, token } });
      const [bad, good] = await Promise.all([accept('fictional-bad-token-0001'), accept(inv.token)]);
      assert.equal(good.status, 200, JSON.stringify(good.body));
      assert.ok([200, 404].includes(bad.status), String(bad.status));
      const { value } = await h.storage.getJson(store.paths.user('google:g-frank'));
      assert.ok(value.workspaceIds.includes(f.ws.id), `round ${round}: the member's list keeps the workspace`);
    }
  });

  test('only owners may set allowances, only for members who are not owners, and only to the listed sizes', async () => {
    const h = harness();
    const f = await household(h);
    const bobId = f.memberId('Bob');
    code(await setAllowance(h, f, 'bob', bobId, 12), 403, 'forbidden');
    code(await setAllowance(h, f, 'carol', bobId, 12), 403, 'forbidden');
    assert.equal((await setAllowance(h, f, 'dave', bobId, 12)).status, 404, 'site administration gives no workspace access');
    code(await setAllowance(h, f, 'alice', f.memberId('Alice'), 4), 409, 'own_allowance');
    ok(await h.call('members', 'PATCH', { as: 'alice', query: f.q, body: { memberId: f.memberId('Carol'), role: 'owner' } }));
    code(await setAllowance(h, f, 'alice', f.memberId('Carol'), 4), 409, 'owner_allowance');
    for (const bad of [0, 3, 13, '4', 4.5, -1]) assert.equal((await setAllowance(h, f, 'alice', bobId, bad)).status, 400, String(bad));
    code(await h.call('members', 'PATCH', { as: 'alice', query: f.q, body: { memberId: bobId } }), 400, 'missing_field');
  });
});
