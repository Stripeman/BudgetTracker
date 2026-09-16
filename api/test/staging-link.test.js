'use strict';
// BT-011-06 — the staging link: a personal preference `stagingUrl` that can inherit a site default
// and be locked by the site, validated on the server by fields.webAddress:
//   * https only, except that the LOCAL development environment (BT_ENVIRONMENT=local, BT_LOCAL_DEV=1,
//     no Azure markers) also accepts http to the loopback hosts 127.0.0.1, [::1] and localhost, on any
//     port (Terry, 2026-09-14); in preview and production http stays refused;
//   * no user name, password, "@" or "%" in the authority, no port 0, and a host that is a normal DNS
//     name, a dotted-quad IPv4 address or a bracketed IPv6 address (no hexadecimal, octal or shortened
//     IP forms, no empty labels); printable ASCII only; at most 300 characters; stored normalised.
// Security review of d363eff: the site default goes only to site administrators and active workspace
// members; a locked key always reports "locked" and one's own stored value can still be cleared; a
// change of the site default is audited with its before and after values. Fictional addresses only
// (.test, .example and 192.0.2.0/24 are reserved for documentation). Hidden characters are built with
// String.fromCodePoint so this file stays plain text (validate rule 9).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { harness, household } = require('./helpers');
const fields = require('../_shared/fields');
const { localDevelopment } = require('../_shared/version');
const { paths } = require('../_shared/store');

const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const code = (res, status, expected) => { assert.equal(res.status, status, JSON.stringify(res.body)); assert.equal(res.body.error.code, expected); };
const put = (h, as, body) => h.call('preferences', 'PUT', { as, body });
const site = (h, as, body) => h.call('site-settings', 'PUT', { as, body });
const prefsOf = async (h, as) => ok(await h.call('preferences', 'GET', { as }));
const ch = (c) => String.fromCodePoint(c);
const STAGING = 'https://staging.example.test/';
const PREVIEW = 'https://preview.example.test/';
// The helpers already set BT_ENVIRONMENT=local; the dev server also sets BT_LOCAL_DEV=1.
const localHarness = () => harness({ env: { BT_LOCAL_DEV: '1' } });
const LOCAL_HTTP = ['http://127.0.0.1:4380/', 'http://localhost:4380/', 'http://[::1]:4380/'];

const REFUSED = {
  'a javascript: address': 'javascript:alert(1)',
  'a data: address': 'data:text/html,hello',
  'a mail address': 'mailto:someone@example.com',
  'plain http to a public host': 'http://staging.example.test',
  'http to example.com': 'http://example.com',
  'http to a host that only starts like a loopback address': 'http://127.0.0.1.evil.test',
  'http to localhost as a subdomain': 'http://localhost.evil.test',
  'http to another 127 address': 'http://127.0.0.2/',
  'an ftp address': 'ftp://staging.example.test',
  'https without //': 'https:staging.example.test',
  'a relative address': '/staging',
  'no host': 'https://',
  'an empty authority': 'https:///path',
  'credentials in the address': 'https://user:secret@staging.example.test',
  'a user name that disguises the host': 'https://bank.example@staging.example.test/',
  'an empty user name': 'https://@evil.example',
  'an empty user name and pass': 'https://:@evil.example',
  'a percent-encoded host': 'https://%65vil.example',
  'port 0': 'https://staging.example.test:0/',
  'an empty port': 'https://staging.example.test:/',
  'a host that is only a dot': 'https://.',
  'a hexadecimal IPv4 host': 'https://0x7f.1',
  'a shortened IPv4 host': 'https://127.1',
  'an octal IPv4 host': 'https://0177.0.0.1',
  'an IPv4 part above 255': 'https://256.1.1.1',
  'an empty label': 'https://staging..example.test',
  'a trailing dot': 'https://staging.example.test.',
  'a label starting with a hyphen': 'https://-staging.example.test',
  'a backslash': 'https://staging.example.test\\@other.example',
  'a right-to-left override': `https://staging.example.test/${ch(0x202e)}abc`,
  'a zero-width space': `https://staging.${ch(0x200b)}example.test`,
  'a byte-order mark': `${ch(0xfeff)}https://staging.example.test`,
  'a control character': `https://staging.example.test/${ch(7)}`,
  'a line break inside': 'https://staging.example.test/a\nb',
  'a space inside': 'https://staging.example.test/a b',
  'a look-alike Unicode host': `https://st${ch(0x430)}ging.example.test`,
  'more than 300 characters': `https://staging.example.test/${'a'.repeat(280)}`,
  'an empty string': '',
  'a number': 42,
  'an object': { href: STAGING },
};

describe('BT-011-06 staging link: server-side validation', () => {
  test('https addresses are accepted and stored in normalised form', async () => {
    const h = harness();
    const cases = [
      [`  ${STAGING}path?x=1  `, `${STAGING}path?x=1`],
      ['https://staging.example.test', STAGING],
      ['HTTPS://Staging.Example.Test', STAGING],
      ['https://staging.example.test:8443/app', 'https://staging.example.test:8443/app'],
      ['https://192.0.2.10/', 'https://192.0.2.10/'],
      ['https://[2001:db8::1]:8443/', 'https://[2001:db8::1]:8443/'],
      ['https://127.0.0.1:4380/', 'https://127.0.0.1:4380/'],
      ['https://xn--bcher-kva.example/', 'https://xn--bcher-kva.example/'],
    ];
    for (const [given, stored] of cases) {
      const a = ok(await put(h, 'alice', { stagingUrl: given }));
      assert.deepEqual([a.stored.stagingUrl, a.effective.stagingUrl, a.sources.stagingUrl], [stored, stored, 'personal'], given);
    }
    const longest = `${STAGING}${'a'.repeat(300 - STAGING.length)}`;
    assert.equal(longest.length, 300);
    assert.equal(ok(await put(h, 'alice', { stagingUrl: longest })).effective.stagingUrl, longest, 'exactly 300 characters is allowed');
  });

  for (const [name, value] of Object.entries(REFUSED)) {
    test(`refused, locally and elsewhere: ${name}`, async () => {
      for (const h of [harness(), localHarness()]) {
        code(await put(h, 'alice', { stagingUrl: value }), 400, 'invalid_url');
        assert.equal((await prefsOf(h, 'alice')).stored.stagingUrl, undefined, 'nothing was stored');
      }
    });
  }

  test('http to a loopback host is accepted only in the local development environment', async () => {
    const local = localHarness();
    for (const address of LOCAL_HTTP) assert.equal(ok(await put(local, 'alice', { stagingUrl: address })).effective.stagingUrl, address, address);
    assert.equal(ok(await put(local, 'alice', { stagingUrl: 'HTTP://LOCALHOST:4380' })).effective.stagingUrl, 'http://localhost:4380/');
    const elsewhere = [
      ['local without BT_LOCAL_DEV', harness()],
      ['preview', harness({ env: { BT_ENVIRONMENT: 'preview', BT_LOCAL_DEV: '1' } })],
      ['production', harness({ env: { BT_ENVIRONMENT: 'production' } })],
      ['local on Azure', harness({ env: { BT_LOCAL_DEV: '1', WEBSITE_SITE_NAME: 'budget-tracker' } })],
    ];
    for (const [where, h] of elsewhere) {
      for (const address of LOCAL_HTTP) code(await put(h, 'alice', { stagingUrl: address }), 400, 'invalid_url');
      assert.equal((await prefsOf(h, 'alice')).stored.stagingUrl, undefined, where);
    }
  });

  test('the environment signal: local only with BT_ENVIRONMENT=local, BT_LOCAL_DEV=1 and no Azure markers', () => {
    assert.equal(localDevelopment({ BT_ENVIRONMENT: 'local', BT_LOCAL_DEV: '1' }), true);
    assert.equal(localDevelopment({ BT_ENVIRONMENT: 'local' }), false);
    assert.equal(localDevelopment({ BT_ENVIRONMENT: 'preview', BT_LOCAL_DEV: '1' }), false);
    assert.equal(localDevelopment({ BT_ENVIRONMENT: 'local', BT_LOCAL_DEV: '1', WEBSITE_INSTANCE_ID: 'x' }), false);
    assert.equal(localDevelopment({ BT_ENVIRONMENT: 'local', BT_LOCAL_DEV: '1', WEBSITE_SITE_NAME: 'x' }), false);
  });

  test('the site default follows the same rule', async () => {
    ok(await site(localHarness(), 'dave', { defaults: { stagingUrl: 'http://127.0.0.1:4380/' } }));
    code(await site(harness({ env: { BT_ENVIRONMENT: 'preview' } }), 'dave', { defaults: { stagingUrl: 'http://127.0.0.1:4380/' } }), 400, 'invalid_url');
    code(await site(harness(), 'dave', { defaults: { stagingUrl: 'https://0x7f.1' } }), 400, 'invalid_url');
  });

  test('the shared rule is one function: fields.webAddress', () => {
    assert.equal(fields.webAddress('https://Staging.Example.Test', 'Staging link'), STAGING);
    assert.equal(fields.webAddress('http://localhost:4380', 'Staging link', { localHttp: true }), 'http://localhost:4380/');
    assert.throws(() => fields.webAddress('http://localhost:4380', 'Staging link'), (e) => e.status === 400 && e.code === 'invalid_url');
    assert.throws(() => fields.webAddress('javascript:alert(1)', 'Staging link'), (e) => e.status === 400 && e.code === 'invalid_url');
    assert.throws(() => fields.webAddress(`${STAGING}${'a'.repeat(300)}`, 'Staging link'), (e) => e.code === 'invalid_url' && /300/.test(e.message));
  });
});

describe('BT-011-06 staging link: save, clear, inherit, visibility, lock and audit', () => {
  test('personal, private to its owner, and cleared with null', async () => {
    const h = harness();
    await household(h);
    ok(await put(h, 'alice', { stagingUrl: STAGING }));
    const bob = await prefsOf(h, 'bob');
    assert.deepEqual([bob.effective.stagingUrl, bob.sources.stagingUrl], [null, 'default'], 'nobody else gets Alice\'s link');
    assert.equal((await prefsOf(h, 'dave')).stored.stagingUrl, undefined, 'a site administrator cannot read it');
    assert.equal(ok(await h.call('me', 'GET', { as: 'alice' })).preferences.effective.stagingUrl, STAGING, 'the boot payload carries it');
    const cleared = ok(await put(h, 'alice', { stagingUrl: null }));
    assert.equal(Object.prototype.hasOwnProperty.call(cleared.stored, 'stagingUrl'), false, 'the key is removed, not stored as null');
    assert.deepEqual([cleared.effective.stagingUrl, cleared.sources.stagingUrl], [null, 'default']);
  });

  test('a workspace member inherits the site default, a personal address overrides it, and null returns to it', async () => {
    const h = harness();
    await household(h);
    ok(await put(h, 'alice', { stagingUrl: 'https://alice-staging.example.test/' }));
    ok(await site(h, 'dave', { defaults: { stagingUrl: STAGING } }));
    const bob = await prefsOf(h, 'bob');
    assert.deepEqual([bob.effective.stagingUrl, bob.sources.stagingUrl], [STAGING, 'site']);
    const alice = await prefsOf(h, 'alice');
    assert.deepEqual([alice.effective.stagingUrl, alice.sources.stagingUrl], ['https://alice-staging.example.test/', 'personal']);
    const back = ok(await put(h, 'alice', { stagingUrl: null }));
    assert.deepEqual([back.effective.stagingUrl, back.sources.stagingUrl], [STAGING, 'site']);
  });

  test('the site default reaches only site administrators and active workspace members, never an outsider (review 1)', async () => {
    const h = harness();
    await household(h);
    ok(await site(h, 'dave', { defaults: { stagingUrl: STAGING } }));
    // Eve is signed in with Google but belongs to no workspace.
    const eve = await prefsOf(h, 'eve');
    assert.deepEqual([eve.effective.stagingUrl, eve.sources.stagingUrl], [null, 'default']);
    const eveMe = ok(await h.call('me', 'GET', { as: 'eve' }));
    assert.equal(eveMe.preferences.effective.stagingUrl, null);
    assert.equal(eveMe.site.defaults.stagingUrl, undefined);
    assert.ok(!JSON.stringify(eveMe).includes('staging.example.test'), 'not anywhere in her boot payload');
    const eveSite = ok(await h.call('site-settings', 'GET', { as: 'eve' }));
    assert.ok(!JSON.stringify(eveSite).includes('staging.example.test'), 'not in her site settings');
    const evePut = ok(await put(h, 'eve', { balanceMasking: true }));
    assert.ok(!JSON.stringify(evePut).includes('staging.example.test'), 'not in the answer to her own save');
    assert.equal(ok(await put(h, 'eve', { stagingUrl: 'https://eve.example.test/' })).effective.stagingUrl, 'https://eve.example.test/', 'her own address is hers');
    // Members and site administrators get it.
    assert.deepEqual([(await prefsOf(h, 'bob')).effective.stagingUrl, (await prefsOf(h, 'carol')).effective.stagingUrl], [STAGING, STAGING]);
    assert.equal(ok(await h.call('site-settings', 'GET', { as: 'bob' })).settings.defaults.stagingUrl, STAGING);
    assert.equal(ok(await h.call('me', 'GET', { as: 'bob' })).site.defaults.stagingUrl, STAGING);
    const dave = ok(await h.call('me', 'GET', { as: 'dave' }));
    assert.equal(dave.preferences.effective.stagingUrl, STAGING, 'a site administrator with no workspace gets it');
  });

  test('visitors who are not signed in never learn the address', async () => {
    const h = harness();
    ok(await site(h, 'dave', { defaults: { stagingUrl: STAGING } }));
    const anon = ok(await h.call('site-settings', 'GET', {}));
    assert.equal(anon.settings.defaults.stagingUrl, undefined);
    assert.ok(!JSON.stringify(anon).includes('staging.example.test'), 'not anywhere in the public response');
    assert.equal(anon.settings.defaults.themeMode, 'system', 'the other public defaults are unchanged');
  });

  test('changing another site default keeps the staging default; null clears it', async () => {
    const h = harness();
    await household(h);
    ok(await site(h, 'dave', { defaults: { stagingUrl: STAGING } }));
    const after = ok(await site(h, 'dave', { defaults: { themeMode: 'dark' } })).settings;
    assert.deepEqual([after.defaults.stagingUrl, after.defaults.themeMode], [STAGING, 'dark']);
    const cleared = ok(await site(h, 'dave', { defaults: { stagingUrl: null } })).settings;
    assert.equal(Object.prototype.hasOwnProperty.call(cleared.defaults, 'stagingUrl'), false);
    const bob = await prefsOf(h, 'bob');
    assert.deepEqual([bob.effective.stagingUrl, bob.sources.stagingUrl], [null, 'default']);
  });

  test('the site default is validated by the same rule and only a site administrator sets it', async () => {
    const h = harness();
    await household(h);
    code(await site(h, 'dave', { defaults: { stagingUrl: 'javascript:alert(1)' } }), 400, 'invalid_url');
    code(await site(h, 'dave', { defaults: { stagingUrl: 'http://staging.example.test' } }), 400, 'invalid_url');
    code(await site(h, 'dave', { defaults: { stagingUrl: 'https://user:secret@staging.example.test' } }), 400, 'invalid_url');
    assert.equal((await site(h, 'alice', { defaults: { stagingUrl: STAGING } })).status, 403);
    assert.equal((await prefsOf(h, 'bob')).effective.stagingUrl, null, 'nothing refused was stored');
  });

  test('a locked key always reports "locked"; the locked value wins; one\'s own value can still be cleared (review 2)', async () => {
    const h = harness();
    await household(h);
    ok(await put(h, 'alice', { stagingUrl: 'https://alice-staging.example.test/' }));
    ok(await site(h, 'dave', { defaults: { stagingUrl: STAGING }, locked: ['stagingUrl'] }));
    let alice = await prefsOf(h, 'alice');
    assert.deepEqual([alice.effective.stagingUrl, alice.sources.stagingUrl], [STAGING, 'locked']);
    assert.equal((await put(h, 'alice', { stagingUrl: 'https://other.example.test/' })).status, 403);
    alice = ok(await put(h, 'alice', { stagingUrl: null }));
    assert.equal(Object.prototype.hasOwnProperty.call(alice.stored, 'stagingUrl'), false, 'her own stored value is cleared even under the lock');
    assert.deepEqual([alice.effective.stagingUrl, alice.sources.stagingUrl], [STAGING, 'locked']);
  });

  test('locked with no site default: source "locked", effective none, writes refused, clearing allowed (review 2)', async () => {
    const h = harness();
    await household(h);
    ok(await put(h, 'alice', { stagingUrl: 'https://alice-staging.example.test/' }));
    ok(await site(h, 'dave', { locked: ['stagingUrl', 'balanceMasking'] }));
    let alice = await prefsOf(h, 'alice');
    assert.deepEqual([alice.effective.stagingUrl, alice.sources.stagingUrl], [null, 'locked'], 'not "default", so the app does not offer an Add that always fails');
    assert.deepEqual([alice.effective.balanceMasking, alice.sources.balanceMasking], [false, 'locked'], 'the same for every lockable key');
    assert.equal(alice.stored.stagingUrl, 'https://alice-staging.example.test/', 'her stored value is kept until she clears it');
    code(await put(h, 'alice', { stagingUrl: STAGING }), 403, 'forbidden');
    alice = ok(await put(h, 'alice', { stagingUrl: null }));
    assert.equal(Object.prototype.hasOwnProperty.call(alice.stored, 'stagingUrl'), false);
    assert.deepEqual([alice.effective.stagingUrl, alice.sources.stagingUrl], [null, 'locked']);
  });

  test('changes of the site default are audited with before and after values (review 3)', async () => {
    const h = harness();
    ok(await site(h, 'dave', { defaults: { stagingUrl: STAGING } }));
    ok(await site(h, 'dave', { defaults: { stagingUrl: PREVIEW } }));
    ok(await site(h, 'dave', { defaults: { themeMode: 'dark' } }));
    ok(await site(h, 'dave', { defaults: { stagingUrl: null } }));
    const { value } = await h.storage.getJson(paths.site());
    const updates = value.audit.filter((a) => a.action === 'site.update');
    assert.equal(updates.length, 4);
    assert.deepEqual(updates.map((a) => a.changes), [
      [{ field: 'defaults.stagingUrl', before: null, after: STAGING }],
      [{ field: 'defaults.stagingUrl', before: STAGING, after: PREVIEW }],
      undefined,
      [{ field: 'defaults.stagingUrl', before: PREVIEW, after: null }],
    ]);
    assert.ok(updates.every((a) => a.actor && a.at && a.id), 'who and when are recorded');
    const got = ok(await h.call('site-settings', 'GET', { as: 'dave' }));
    assert.equal(got.settings.audit, undefined, 'the audit is not sent to the browser');
  });
});
