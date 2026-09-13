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

  test('only owners may set allowances, only for members who are not owners, and only to the listed sizes', async () => {
    const h = harness();
    const f = await household(h);
    const bobId = f.memberId('Bob');
    code(await setAllowance(h, f, 'bob', bobId, 12), 403, 'forbidden');
    code(await setAllowance(h, f, 'carol', bobId, 12), 403, 'forbidden');
    assert.equal((await setAllowance(h, f, 'dave', bobId, 12)).status, 404, 'site administration gives no workspace access');
    code(await setAllowance(h, f, 'alice', f.memberId('Alice'), 4), 409, 'owner_allowance');
    for (const bad of [0, 3, 13, '4', 4.5, -1]) assert.equal((await setAllowance(h, f, 'alice', bobId, bad)).status, 400, String(bad));
    code(await h.call('members', 'PATCH', { as: 'alice', query: f.q, body: { memberId: bobId } }), 400, 'missing_field');
  });
});
