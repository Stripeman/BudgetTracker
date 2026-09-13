'use strict';
// BT-011-02 server-side rich-text validation: a closed schema, a content model, canonical storage,
// safe links and tight limits. Anything outside is refused, never silently stripped.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const richtext = require('../_shared/richtext');
const fields = require('../_shared/fields');

const env = (content, extra = {}) => ({ format: 'tiptap', v: 1, doc: { type: 'doc', content }, ...extra });
const p = (...content) => ({ type: 'paragraph', content });
const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const ok = (value, opts) => richtext.validate(value, { field: 'Notes', max: 5000, ...opts });
const refused = (value, pattern, code = 'invalid_rich_text', opts) => assert.throws(() => ok(value, opts), (e) => e.code === code && (!pattern || pattern.test(e.message)));

describe('BT-011-02 rich text: accepted documents', () => {
  test('the reduced schema round-trips in canonical form, with attribute defaults filled', () => {
    const value = env([
      { type: 'heading', attrs: { level: 2 }, content: [t('Rent')] },
      p(t('Paid by '), t('standing order', [{ type: 'bold' }, { type: 'italic' }]), { type: 'hardBreak' }, t('see '), t('bank', [{ type: 'link', attrs: { href: 'https://example.com/terms' } }])),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('one'))] }, { type: 'listItem', content: [p(t('two')), { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('nested'))] }] }] }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(t('done'))] }] },
      { type: 'blockquote', content: [p(t('quoted'))] },
      { type: 'horizontalRule' },
      p(),
    ]);
    const out = ok(value);
    assert.equal(out.format, 'tiptap');
    assert.equal(out.v, 1);
    const link = out.doc.content[1].content[4].marks[0];
    assert.deepEqual(link, { type: 'link', attrs: { href: 'https://example.com/terms', target: '_blank', rel: richtext.LINK_REL, class: null } });
    assert.deepEqual(out.doc.content[2].content[1].content[1].attrs, { start: 1, type: null });
    assert.deepEqual(ok(out), out, 'canonical output validates to itself');
    assert.equal(richtext.plainText(out), 'Rent\nPaid by standing order\nsee bank\none\ntwo\nnested\ndone\nquoted');
  });

  test('fields.richText keeps plain strings exactly as before and stores an empty document as nothing', () => {
    assert.equal(fields.richText('  line one\r\nline two  ', { field: 'Notes' }), 'line one\nline two');
    assert.equal(fields.richText(undefined, { field: 'Notes' }), '');
    assert.equal(fields.richText(env([p()]), { field: 'Notes' }), '');
    assert.deepEqual(fields.richText(env([p(t('Hi'))]), { field: 'Notes' }), env([p(t('Hi'))]));
    assert.throws(() => fields.richText('x'.repeat(2001), { field: 'Notes', max: 2000 }), (e) => e.code === 'invalid_field');
  });
});

describe('BT-011-02 rich text: refused documents', () => {
  test('envelope: format, version and keys are checked', () => {
    refused({ format: 'html', v: 1, doc: { type: 'doc', content: [p()] } }, /unknown format/);
    refused(env([p()], { v: 2 }), /newer version/);
    refused(env([p()], { v: 0 }), /missing version/);
    refused(env([p()], { html: '<b>x</b>' }), /unknown key/);
    refused('<p>html</p>', /expected a formatted document/);
    refused(null);
  });

  test('unknown nodes, marks and attributes are refused, including features left out on purpose', () => {
    refused(env([{ type: 'table', content: [] }]), /unknown node/);
    refused(env([{ type: 'image', attrs: { src: 'https://example.com/x.png' } }]), /unknown node/);
    refused(env([{ type: 'codeBlock', content: [t('x')] }]), /unknown node/);
    refused(env([p(t('x', [{ type: 'textStyle', attrs: { color: 'red' } }]))]), /unknown mark/);
    refused(env([{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [t('x')] }]), /undeclared attribute/);
    refused(env([{ type: 'paragraph', attrs: { style: 'color:red' }, content: [t('x')] }]), /undeclared attribute/);
    refused(env([{ type: 'heading', attrs: { level: 4 }, content: [t('x')] }]), /level/);
    refused(env([{ type: 'heading', content: [t('x')] }]), /level/);
    refused(env([{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: 'yes' }, content: [p(t('x'))] }] }]), /checked/);
    refused(env([{ type: 'paragraph', content: [t('x')], onclick: 'alert(1)' }]), /unknown key/);
  });

  test('the content model is enforced', () => {
    refused(env([t('bare text in the document')]), /text is not allowed here/);
    refused(env([p({ type: 'listItem', content: [p(t('x'))] })]), /listItem is not allowed here/);
    refused(env([{ type: 'bulletList', content: [p(t('x'))] }]), /paragraph is not allowed here/);
    refused(env([{ type: 'bulletList', content: [] }]), /needs content/);
    refused(env([{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [p(t('x'))] }] }] }] }]), /must start with a paragraph/);
    refused(env([{ type: 'horizontalRule', content: [p(t('x'))] }]), /cannot have content/);
    refused({ format: 'tiptap', v: 1, doc: { type: 'doc', content: [] } }, /needs content/);
    refused({ format: 'tiptap', v: 1, doc: { type: 'paragraph' } }, /paragraph is not allowed here/);
  });

  test('marks only on text, each once; text non-empty without control characters', () => {
    refused(env([{ type: 'paragraph', marks: [{ type: 'bold' }], content: [t('x')] }]), /unknown key "marks"/);
    refused(env([p(t('x', [{ type: 'bold' }, { type: 'bold' }]))]), /appears twice/);
    refused(env([p(t(''))]), /must not be empty/);
    refused(env([p(t('tab\there'))]), /control characters/);
    refused(env([p(t('bell\u0007'))]), /control characters/);
  });

  test('links must be web or mail links, stored exactly as cleaned and not too long', () => {
    const link = (href) => env([p(t('x', [{ type: 'link', attrs: { href } }]))]);
    refused(link('javascript:alert(1)'), /href/);
    refused(link('JaVaScRiPt:alert(1)'), /href/);
    refused(link('data:text/html,<script>'), /href/);
    refused(link(' https://example.com'), /href/);
    refused(link('https://exa\u0000mple.com'), /href/);
    refused(link(`https://example.com/${'a'.repeat(2050)}`), /href/);
    refused(env([p(t('x', [{ type: 'link', attrs: { href: 'https://example.com', target: '_self' } }]))]), /target/);
    refused(env([p(t('x', [{ type: 'link', attrs: { href: 'https://example.com', rel: 'opener' } }]))]), /rel/);
    assert.ok(ok(link('mailto:someone@example.com')));
    assert.equal(richtext.safeLinkHref('  https://example.com  '), 'https://example.com');
    assert.equal(richtext.safeLinkHref('ftp://example.com'), null);
  });

  test('SEC-R8 invisible and direction-changing characters are refused in text and links; links carry no user name', () => {
    const link = (href) => env([p(t('x', [{ type: 'link', attrs: { href } }]))]);
    // Built from code points so this file stays plain text: right-to-left override, zero-width
    // space, byte-order mark, C1 next-line, line separator, left-to-right isolate, right-to-left mark.
    for (const code of [0x202e, 0x200b, 0xfeff, 0x85, 0x2028, 0x2066, 0x200f]) {
      const ch = String.fromCodePoint(code);
      refused(env([p(t(`pay${ch}ment`))]), /control characters/);
      refused(link(`https://example.com/${ch}`), /href/);
      assert.equal(richtext.safeLinkHref(`https://exa${ch}mple.com`), null, `U+${code.toString(16)} is refused, not stripped`);
    }
    refused(link('https://bank.example@evil.example/'), /href/);
    refused(link('https://user:pass@example.com/'), /href/);
    // Ordinary accented letters and currency signs are fine.
    const text = `Caf${String.fromCodePoint(0xe9)} 50 ${String.fromCodePoint(0x20ac)}`;
    assert.equal(ok(env([p(t(text))])).doc.content[0].content[0].text, text);
  });

  test('limits: depth, parts, size and the field\'s own character limit', () => {
    let deep = p(t('x'));
    for (let i = 0; i < 12; i += 1) deep = { type: 'blockquote', content: [deep] };
    refused(env([deep]), /deeper than 12/);
    refused(env([p(...Array.from({ length: 2001 }, () => ({ type: 'hardBreak' })))]), /more than 2000 parts/);
    refused(env([p(t('x'.repeat(70 * 1024)))]), /64 KB/);
    refused(env([p(t('x'.repeat(2001)))]), /at most 2000 characters/, 'invalid_field', { max: 2000 });
    assert.ok(ok(env([p(t('x'.repeat(2000)))]), { max: 2000 }));
  });

  test('nodes that are not plain objects are refused', () => {
    refused(env([Object.assign(Object.create({ type: 'paragraph' }), {})]), /must be an object/);
    refused(env(['paragraph']), /must be an object/);
    refused(env([{ type: 'paragraph', content: 'x' }]), /must be a list/);
  });
});
