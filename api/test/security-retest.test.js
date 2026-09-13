'use strict';
// Security retest of ff5d9c5 before the first Production release (SEC-T1 to SEC-T7). Fictional data.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');
const ledger = require('../_shared/ledger');
const richtext = require('../_shared/richtext');
const invisible = require('../_shared/invisible');

const DAY = 24 * 60 * 60 * 1000;
const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const stored = async (h, f) => (await h.storage.getJson(`workspaces/${f.ws.id}/workspace.json`)).value;
const archiveCount = async (h) => (await h.backupStorage.list('')).filter((n) => n.endsWith('.btbk')).length;

describe('SEC-T1 restore attempts are counted before a recovery point is written', () => {
  test('parallel restores by a member write at most 6 recovery points a day, and one restore wins', async () => {
    const h = harness();
    const f = await household(h);
    const id = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201).archive.archiveId;
    ok(await h.call('transactions', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, kind: 'expense', amount: '1.00' } }), 201);
    const pv = ok(await h.call('restore', 'POST', { as: 'bob', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId: id, mode: 'replace' } }));
    const body = { workspaceId: f.ws.id, archiveId: id, mode: 'replace', expectedEtag: pv.expectedEtag, confirm: 'REPLACE' };
    const results = await Promise.all(Array.from({ length: 12 }, () => h.call('restore', 'POST', { as: 'bob', query: { action: 'execute' }, body })));
    const statuses = results.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 200).length, 1, statuses.join(','));
    assert.ok(statuses.every((s) => [200, 409, 429].includes(s)), statuses.join(','));
    // Before the fix all 12 attempts wrote an archive. One archive is Alice's backup.
    assert.ok((await archiveCount(h)) - 1 <= 6, `recovery points: ${(await archiveCount(h)) - 1}`);
  });
});

describe('SEC-T2 any write that grows a member\'s records respects their allowance', () => {
  test('delete and restore cycles stop at the allowance instead of growing the workspace without bound', async () => {
    const h = harness({ env: { BT_MEMBER_QUOTA_BYTES: '4000' } });
    const f = await household(h);
    const current = async () => ok(await h.call('transactions', 'GET', { as: 'bob', query: { ...f.q, accountId: f.bobCard.id, includeDeleted: '1' } })).transactions.find((t) => t.id === f.secret.id);
    let refused = null;
    for (let i = 0; i < 60 && !refused; i += 1) {
      const t = await current();
      ok(await h.call('transactions', 'DELETE', { as: 'bob', query: f.q, body: { transactionId: t.id, revision: t.revision, reason: 'Fictional cycle' } }));
      const res = await h.call('transactions', 'POST', { as: 'bob', query: { ...f.q, action: 'restore' }, body: { transactionId: t.id } });
      if (res.status !== 200) refused = res;
    }
    assert.ok(refused, 'the cycle is stopped');
    code(refused, 409, 'member_quota_exceeded');
    const doc = await stored(h, f);
    const bob = doc.members.find((m) => m.subject === 'google:g-bob');
    // Before the fix 40 cycles took Bob to about 39,000 bytes against a 2,131-byte allowance.
    assert.ok(ledger.memberBytes(doc, bob) < 4000 + 1500, `Bob's records: ${ledger.memberBytes(doc, bob)} bytes`);
  });

  test('owners are not limited by member allowances', async () => {
    const h = harness({ env: { BT_MEMBER_QUOTA_BYTES: '3000' } });
    const f = await household(h);
    const current = async () => ok(await h.call('transactions', 'GET', { as: 'alice', query: { ...f.q, accountId: f.joint.id, includeDeleted: '1' } })).transactions.find((t) => t.id === f.grocery.id);
    for (let i = 0; i < 20; i += 1) {
      const t = await current();
      ok(await h.call('transactions', 'DELETE', { as: 'alice', query: f.q, body: { transactionId: t.id, revision: t.revision, reason: 'Fictional cycle' } }));
      ok(await h.call('transactions', 'POST', { as: 'alice', query: { ...f.q, action: 'restore' }, body: { transactionId: t.id } }));
    }
    const doc = await stored(h, f);
    const alice = doc.members.find((m) => m.subject === 'google:g-alice');
    assert.ok(ledger.memberBytes(doc, alice) > 3000, 'the owner went past the member allowance without being refused');
  });
});

describe('SEC-U1 a member is charged for every kind of growth their writes cause', () => {
  test('shared contacts stop at the allowance, and the owner can still add entries', async () => {
    const h = harness({ env: { BT_MEMBER_QUOTA_BYTES: '6000' } });
    const f = await household(h);
    let refused = null;
    for (let i = 0; i < 200 && !refused; i += 1) {
      const res = await h.call('contacts', 'POST', { as: 'bob', body: { scope: 'workspace', workspaceId: f.ws.id, name: `Fictional Contact ${i}` } });
      if (res.status !== 201) refused = res;
    }
    // Before the fix contacts were never counted: 57 filled the workspace and locked the owner out.
    assert.ok(refused, 'creation is stopped');
    code(refused, 409, 'member_quota_exceeded');
    const doc = await stored(h, f);
    const bob = doc.members.find((m) => m.subject === 'google:g-bob');
    assert.ok(ledger.memberCharge(doc, bob) <= 6000 + 1000, `Bob is charged ${ledger.memberCharge(doc, bob)} bytes`);
    ok(await h.call('transactions', 'POST', { as: 'alice', query: f.q, body: { accountId: f.joint.id, kind: 'expense', amount: '1.00' } }), 201);
  });

  test('re-issuing a grant over and over is charged too', async () => {
    const h = harness({ env: { BT_MEMBER_QUOTA_BYTES: '5000' } });
    const f = await household(h);
    let refused = null;
    for (let i = 0; i < 300 && !refused; i += 1) {
      const res = await h.call('grants', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, memberId: f.memberId('Alice'), capabilities: ['view-transactions'] } });
      if (res.status !== 201 && res.status !== 200) refused = res;
    }
    // Before the fix 300 re-issues grew the workspace while Bob's counted bytes stayed at 1,731.
    assert.ok(refused, 're-issuing is stopped');
    code(refused, 409, 'member_quota_exceeded');
  });
});

describe('SEC-U2 plain-text names refuse invisible and direction-changing characters', () => {
  test('a merchant or account name with a right-to-left override or zero-width space is refused', async () => {
    const h = harness();
    const f = await household(h);
    const rlo = String.fromCodePoint(0x202e);
    const zwsp = String.fromCodePoint(0x200b);
    code(await h.call('payees', 'POST', { as: 'alice', query: f.q, body: { name: `Grocer${rlo}gnp.exe`, visibility: 'shared' } }), 400, 'invalid_field');
    code(await h.call('accounts', 'POST', { as: 'alice', query: f.q, body: { name: `Sav${zwsp}ings`, type: 'savings', currency: 'EUR' } }), 400, 'invalid_field');
    // Accented letters and emoji are fine.
    ok(await h.call('payees', 'POST', { as: 'alice', query: f.q, body: { name: `Caf${String.fromCodePoint(0xe9)} ${String.fromCodePoint(0x1f600)}`, visibility: 'shared' } }), 201);
  });
});

describe('SEC-U3 recovery points of private restores are listed without the member\'s name', () => {
  test('owners see that a member restored, not who', async () => {
    const h = harness();
    const f = await household(h);
    const id = ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201).archive.archiveId;
    ok(await h.call('transactions', 'POST', { as: 'bob', query: f.q, body: { accountId: f.bobCard.id, kind: 'expense', amount: '1.00' } }), 201);
    const pv = ok(await h.call('restore', 'POST', { as: 'bob', query: { action: 'preview' }, body: { workspaceId: f.ws.id, archiveId: id, mode: 'replace' } }));
    ok(await h.call('restore', 'POST', { as: 'bob', query: { action: 'execute' }, body: { workspaceId: f.ws.id, archiveId: id, mode: 'replace', expectedEtag: pv.expectedEtag, confirm: 'REPLACE' } }));
    const list = ok(await h.call('backups', 'GET', { as: 'alice', query: f.q })).archives;
    assert.equal(list.find((a) => a.reason === 'pre-restore').createdBy, 'A member (private restore)');
    assert.equal(JSON.stringify(list).includes('Bob'), false);
  });
});

describe('SEC-V1 the headroom kept for administering a full workspace', () => {
  test('on-demand backups are limited to 12 a day per workspace', async () => {
    const h = harness();
    const f = await household(h);
    for (let i = 0; i < 12; i += 1) ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201);
    code(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 429, 'backup_limit');
    h.clock.advance(DAY + 1000);
    ok(await h.call('backups', 'POST', { as: 'alice', query: f.q, body: {} }), 201);
  });

  test('a manager cannot use up the headroom, so the owner can still administer a full workspace', async () => {
    const h = harness();
    const f = await household(h);
    ok(await h.call('members', 'PATCH', { as: 'alice', query: f.q, body: { memberId: f.memberId('Bob'), role: 'manager' } }));
    // The workspace is exactly full, with a small headroom (both only for tests).
    h.env.BT_WORKSPACE_MAX_BYTES = String(Buffer.byteLength(JSON.stringify(await stored(h, f))));
    h.env.BT_WORKSPACE_HEADROOM_BYTES = '6000';
    const statuses = [];
    for (let i = 0; i < 12; i += 1) statuses.push((await h.call('backups', 'POST', { as: 'bob', query: f.q, body: {} })).status);
    // Before the fix a manager's backups filled all the headroom and froze the owner out.
    assert.ok(statuses.includes(409), statuses.join(','));
    assert.equal((await h.backupStorage.list('')).filter((n) => n.endsWith('.btbk')).length, statuses.filter((s) => s === 201).length, 'no archive without its audit entry');
    ok(await h.call('members', 'PATCH', { as: 'alice', query: f.q, body: { memberId: f.memberId('Bob'), role: 'member' } }));
  });
});

describe('SEC-V2 display names and emails refuse invisible and direction-changing characters', () => {
  test('a provider display name with a right-to-left override is not used', () => {
    const { principalHeader } = require('./helpers');
    const identity = require('../_shared/identity');
    const name = `Mal${String.fromCodePoint(0x202e)}lory`;
    const p = identity.principalFrom({ headers: { 'x-ms-client-principal': principalHeader({ userId: 'g-mallory', email: 'mallory@example.com', name }) } }, {});
    assert.ok(p, 'the person can still sign in');
    assert.equal(p.name, '');
  });

  test('an email with a right-to-left override is refused', async () => {
    const h = harness();
    const f = await household(h);
    const res = await h.call('contacts', 'POST', { as: 'alice', body: { scope: 'workspace', workspaceId: f.ws.id, name: 'Fictional Plumber', email: `plumber${String.fromCodePoint(0x202e)}@example.com` } });
    code(res, 400, 'invalid_email');
  });
});

describe('SEC-V4 a person\'s own document is capped', () => {
  test('private contacts stop at the personal storage limit', async () => {
    const h = harness({ env: { BT_USER_MAX_BYTES: '6000' } });
    let refused = null;
    for (let i = 0; i < 200 && !refused; i += 1) {
      const res = await h.call('contacts', 'POST', { as: 'eve', body: { scope: 'private', name: `Fictional Private ${i}` } });
      if (res.status !== 201) refused = res;
    }
    assert.ok(refused, 'creation is stopped');
    code(refused, 409, 'profile_full');
  });
});

describe('SEC-V5 retry records count against a member while they exist', () => {
  test('a member\'s idempotency records add to their charge', () => {
    const bob = { subject: 'google:g-bob', role: 'member' };
    const doc = { accounts: [], transactions: [], payees: [], recurring: [], budgets: [], idempotency: {} };
    const before = ledger.memberCharge(doc, bob);
    doc.idempotency['google:g-bob|fictional-key-0001'] = { at: '2026-09-13T10:00:00.000Z', scope: 'x', hash: null, result: { notes: 'x'.repeat(1000) } };
    doc.idempotency['google:g-alice|fictional-key-0002'] = { at: '2026-09-13T10:00:00.000Z', scope: 'x', hash: null, result: { notes: 'x'.repeat(1000) } };
    assert.ok(ledger.memberCharge(doc, bob) - before > 1000, 'Bob\'s record counts');
    assert.ok(ledger.memberCharge(doc, bob) - before < 2000, 'Alice\'s record does not count against Bob');
  });
});

describe('SEC-T3 a bill into an account the viewer cannot see', () => {
  test('does not reveal whether that account was closed or removed', async () => {
    const h = harness();
    const f = await household(h);
    const b = ok(await h.call('recurring', 'POST', { as: 'bob', query: f.q, body: { name: 'Card top-up', kind: 'transfer', accountId: f.joint.id, toAccountId: f.bobCard.id, amount: '20.00', schedule: { freq: 'monthly', startDate: '2026-09-20' } } }), 201).recurring;
    ok(await h.call('accounts', 'POST', { as: 'bob', query: { ...f.q, action: 'close' }, body: { accountId: f.bobCard.id, revision: f.bobCard.revision, reason: 'Closed' } }));
    const reason = async (as) => ok(await h.call('recurring', 'GET', { as, query: f.q })).recurring.find((r) => r.id === b.id).inactiveReason;
    assert.equal(await reason('bob'), 'destination_closed', 'the account\'s owner sees why');
    assert.equal(await reason('alice'), 'destination_unavailable');
    assert.equal(await reason('carol'), 'destination_unavailable');
  });
});

describe('SEC-T4 workspace creation is bounded', () => {
  test('unarchiving counts toward the active limit, and creations are limited per day', async () => {
    const h = harness({ env: { BT_MAX_WORKSPACES: '2', BT_MAX_WORKSPACE_CREATIONS_PER_DAY: '3' } });
    const create = (name) => h.call('workspaces', 'POST', { as: 'eve', body: { name } });
    const archive = (id) => h.call('workspaces', 'DELETE', { as: 'eve', query: { id }, body: {} });
    const one = ok(await create('Fictional One'), 201).workspace;
    const two = ok(await create('Fictional Two'), 201).workspace;
    ok(await archive(one.id));
    ok(await create('Fictional Three'), 201);
    // Before the fix this made a third active workspace against a limit of two.
    code(await h.call('workspaces', 'POST', { as: 'eve', query: { id: one.id, action: 'restore' }, body: {} }), 409, 'workspace_limit');
    ok(await archive(two.id));
    code(await create('Fictional Four'), 409, 'workspace_rate');
    h.clock.advance(DAY + 1000);
    ok(await create('Fictional Four'), 201);
  });
});

describe('SEC-T6/T7 rich text characters and links', () => {
  const env = (text) => ({ format: 'tiptap', v: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } });

  test('direction marks, tag characters, soft hyphens and fillers are refused; joiners and emoji selectors are allowed', () => {
    // Arabic letter mark, a tag character, soft hyphen, combining grapheme joiner, Hangul filler,
    // inhibit symmetric swapping, interlinear annotation anchor, left-to-right embedding and isolate.
    for (const cp of [0x061c, 0xe0001, 0xad, 0x34f, 0x3164, 0x206a, 0xfff9, 0x202a, 0x2066]) {
      assert.throws(() => richtext.validate(env(`a${String.fromCodePoint(cp)}b`)), (e) => e.code === 'invalid_rich_text', cp.toString(16));
    }
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    const heart = String.fromCodePoint(0x2764, 0xfe0f);
    const persian = String.fromCodePoint(0x645, 0x6cc, 0x200c, 0x62e, 0x648, 0x627, 0x647, 0x645);
    const text = `${family} ${heart} ${persian}`;
    assert.equal(richtext.validate(env(text)).doc.content[0].content[0].text, text);
  });

  test('web links need two slashes and no backslashes', () => {
    const bs = String.fromCharCode(92);
    for (const href of [`https:${bs}${bs}evil.example`, 'https:evil.example', `https://example.com${bs}@evil.example`, 'http:/evil.example']) {
      assert.equal(richtext.safeLinkHref(href), null, href);
    }
    assert.equal(richtext.safeLinkHref('https://example.com/a'), 'https://example.com/a');
    assert.equal(richtext.safeLinkHref('mailto:someone@example.com'), 'mailto:someone@example.com');
  });

  test('rich text and the repository check share one list', () => {
    assert.equal(invisible.firstForbidden(`x${String.fromCodePoint(0x202e)}`), 0x202e);
    assert.equal(invisible.firstForbidden(`x${String.fromCodePoint(0xe0041)}`), 0xe0041);
    assert.equal(invisible.firstForbidden('plain text, tabs\tand\nlines'), null);
  });
});
