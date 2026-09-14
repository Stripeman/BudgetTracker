'use strict';
// BT-011-06 — the staging link (Terry, 2026-09-14): a personal preference `stagingUrl` that can
// inherit a site default and be locked by the site. The address is validated on the server: an
// absolute https address only (the preferences model has no environment notion, so http is never
// accepted, not even for a local address), no user name or password, no control, invisible or
// direction-changing characters, printable ASCII only, and at most 300 characters. All addresses
// here are fictional (.test and .example are reserved names).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers');
const fields = require('../_shared/fields');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const put = (h, as, body) => h.call('preferences', 'PUT', { as, body });
const site = (h, as, body) => h.call('site-settings', 'PUT', { as, body });
const STAGING = 'https://staging.example.test';

// Written as escapes so this file stays plain text (validate rule 9).
const REFUSED = {
  'a javascript: address': 'javascript:alert(1)',
  'a data: address': 'data:text/html,hello',
  'a mail address': 'mailto:someone@example.com',
  'plain http': 'http://staging.example.test',
  'http to a local address': 'http://127.0.0.1:4380',
  'http to localhost': 'http://localhost:4380',
  'an ftp address': 'ftp://staging.example.test',
  'https without //': 'https:staging.example.test',
  'a relative address': '/staging',
  'credentials in the address': 'https://user:secret@staging.example.test',
  'a user name that disguises the host': 'https://bank.example@staging.example.test/',
  'a backslash': 'https://staging.example.test\\@other.example',
  'a right-to-left override': 'https://staging.example.test/\u202Eabc',
  'a zero-width space': 'https://staging.\u200Bexample.test',
  'a byte-order mark': '\uFEFFhttps://staging.example.test',
  'a control character': 'https://staging.example.test/\u0007',
  'a line break inside': 'https://staging.example.test/a\nb',
  'a space inside': 'https://staging.example.test/a b',
  'a look-alike Unicode host': 'https://stаging.example.test',
  'more than 300 characters': `https://staging.example.test/${'a'.repeat(280)}`,
  'an empty string': '',
  'a number': 42,
  'an object': { href: STAGING },
};

describe('BT-011-06 staging link: server-side validation', () => {
  test('an https address is accepted and stored as cleaned; surrounding space is trimmed', async () => {
    const h = harness();
    const a = ok(await put(h, 'alice', { stagingUrl: `  ${STAGING}/path?x=1  ` }));
    assert.equal(a.stored.stagingUrl, `${STAGING}/path?x=1`);
    assert.equal(a.effective.stagingUrl, `${STAGING}/path?x=1`);
    assert.equal(a.sources.stagingUrl, 'personal');
    assert.equal(ok(await put(h, 'alice', { stagingUrl: 'HTTPS://Staging.Example.Test' })).effective.stagingUrl, 'HTTPS://Staging.Example.Test');
    const longest = `https://staging.example.test/${'a'.repeat(300 - 'https://staging.example.test/'.length)}`;
    assert.equal(longest.length, 300);
    assert.equal(ok(await put(h, 'alice', { stagingUrl: longest })).effective.stagingUrl, longest, 'exactly 300 characters is allowed');
  });

  for (const [name, value] of Object.entries(REFUSED)) {
    test(`refused: ${name}`, async () => {
      const h = harness();
      code(await put(h, 'alice', { stagingUrl: value }), 400, 'invalid_url');
      assert.equal(ok(await h.call('preferences', 'GET', { as: 'alice' })).stored.stagingUrl, undefined, 'nothing was stored');
    });
  }

  test('the shared rule is one function: fields.webAddress', () => {
    assert.equal(fields.webAddress(STAGING, 'Staging link'), STAGING);
    assert.throws(() => fields.webAddress('javascript:alert(1)', 'Staging link'), (e) => e.status === 400 && e.code === 'invalid_url');
    assert.throws(() => fields.webAddress(`${STAGING}/${'a'.repeat(300)}`, 'Staging link'), (e) => e.code === 'invalid_url' && /300/.test(e.message));
  });
});

describe('BT-011-06 staging link: save, clear, inherit and lock', () => {
  test('personal, private to its owner, and cleared with null', async () => {
    const h = harness();
    ok(await put(h, 'alice', { stagingUrl: STAGING }));
    const bob = ok(await h.call('preferences', 'GET', { as: 'bob' }));
    assert.deepEqual([bob.effective.stagingUrl, bob.sources.stagingUrl], [null, 'default'], 'nobody else gets Alice\'s link');
    const dave = ok(await h.call('preferences', 'GET', { as: 'dave' }));
    assert.equal(dave.stored.stagingUrl, undefined, 'a site administrator cannot read it');
    const me = ok(await h.call('me', 'GET', { as: 'alice' }));
    assert.equal(me.preferences.effective.stagingUrl, STAGING, 'the boot payload carries it');
    const cleared = ok(await put(h, 'alice', { stagingUrl: null }));
    assert.equal(Object.prototype.hasOwnProperty.call(cleared.stored, 'stagingUrl'), false, 'the key is removed, not stored as null');
    assert.deepEqual([cleared.effective.stagingUrl, cleared.sources.stagingUrl], [null, 'default']);
  });

  test('a site default is inherited, a personal address overrides it, and null returns to it', async () => {
    const h = harness();
    ok(await put(h, 'alice', { stagingUrl: 'https://alice-staging.example.test' }));
    ok(await site(h, 'dave', { defaults: { stagingUrl: STAGING } }));
    const bob = ok(await h.call('preferences', 'GET', { as: 'bob' }));
    assert.deepEqual([bob.effective.stagingUrl, bob.sources.stagingUrl], [STAGING, 'site']);
    const alice = ok(await h.call('preferences', 'GET', { as: 'alice' }));
    assert.deepEqual([alice.effective.stagingUrl, alice.sources.stagingUrl], ['https://alice-staging.example.test', 'personal']);
    const back = ok(await put(h, 'alice', { stagingUrl: null }));
    assert.deepEqual([back.effective.stagingUrl, back.sources.stagingUrl], [STAGING, 'site']);
  });

  test('changing another site default keeps the staging default; null clears it', async () => {
    const h = harness();
    ok(await site(h, 'dave', { defaults: { stagingUrl: STAGING } }));
    const after = ok(await site(h, 'dave', { defaults: { themeMode: 'dark' } })).settings;
    assert.equal(after.defaults.stagingUrl, STAGING);
    assert.equal(after.defaults.themeMode, 'dark');
    const cleared = ok(await site(h, 'dave', { defaults: { stagingUrl: null } })).settings;
    assert.equal(Object.prototype.hasOwnProperty.call(cleared.defaults, 'stagingUrl'), false);
    const bob = ok(await h.call('preferences', 'GET', { as: 'bob' }));
    assert.deepEqual([bob.effective.stagingUrl, bob.sources.stagingUrl], [null, 'default']);
  });

  test('the site default is validated by the same rule and only a site administrator sets it', async () => {
    const h = harness();
    code(await site(h, 'dave', { defaults: { stagingUrl: 'javascript:alert(1)' } }), 400, 'invalid_url');
    code(await site(h, 'dave', { defaults: { stagingUrl: 'http://staging.example.test' } }), 400, 'invalid_url');
    code(await site(h, 'dave', { defaults: { stagingUrl: 'https://user:secret@staging.example.test' } }), 400, 'invalid_url');
    assert.equal((await site(h, 'alice', { defaults: { stagingUrl: STAGING } })).status, 403);
    const bob = ok(await h.call('preferences', 'GET', { as: 'bob' }));
    assert.equal(bob.effective.stagingUrl, null, 'nothing refused was stored');
  });

  test('a site-locked staging link cannot be overridden, and the locked value wins', async () => {
    const h = harness();
    ok(await put(h, 'alice', { stagingUrl: 'https://alice-staging.example.test' }));
    ok(await site(h, 'dave', { defaults: { stagingUrl: STAGING }, locked: ['stagingUrl'] }));
    const alice = ok(await h.call('preferences', 'GET', { as: 'alice' }));
    assert.deepEqual([alice.effective.stagingUrl, alice.sources.stagingUrl], [STAGING, 'locked']);
    assert.equal((await put(h, 'alice', { stagingUrl: 'https://other.example.test' })).status, 403);
    assert.equal((await put(h, 'alice', { stagingUrl: null })).status, 403);
  });

  test('visitors who are not signed in never learn the address; signed-in people get it', async () => {
    const h = harness();
    ok(await site(h, 'dave', { defaults: { stagingUrl: STAGING } }));
    const anon = ok(await h.call('site-settings', 'GET', {}));
    assert.equal(anon.settings.defaults.stagingUrl, undefined);
    assert.ok(!JSON.stringify(anon).includes('staging.example.test'), 'not anywhere in the public response');
    assert.equal(anon.settings.defaults.themeMode, 'system', 'the other public defaults are unchanged');
    const me = ok(await h.call('me', 'GET', { as: 'bob' }));
    assert.equal(me.preferences.effective.stagingUrl, STAGING);
  });
});
