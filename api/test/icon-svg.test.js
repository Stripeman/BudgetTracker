'use strict';
// BT-011-05 safe custom icons: only plain shape data survives; every unsafe construct is refused.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseIconSvg, isSafeShapes, MAX_BYTES } = require('../_shared/icon-svg');

const wrap = (inner, attrs = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"') => `<svg ${attrs}>${inner}</svg>`;
const refused = (svg, pattern) => assert.throws(() => parseIconSvg(svg), (e) => e.code === 'invalid_icon' && (!pattern || pattern.test(e.message)));

describe('BT-011-05 custom icon validation', () => {
  test('a plain icon is reduced to shape data; presentation attributes are dropped', () => {
    const out = parseIconSvg(`<?xml version="1.0"?>\n${wrap('<g><path d="M4 12h16" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none"/></g>', 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="24" height="24"')}`);
    assert.deepEqual(out, { viewBox: '0 0 24 24', shapes: [{ type: 'path', attrs: { d: 'M4 12h16' } }, { type: 'circle', attrs: { cx: '12', cy: '12', r: '3' } }] });
  });

  test('scripts, event handlers, links, styles and foreign content are refused', () => {
    refused(wrap('<script>alert(1)</script>'), /script/);
    refused(wrap('<path d="M0 0"/>', 'viewBox="0 0 24 24" onload="alert(1)"'), /onload/);
    refused(wrap('<use href="#x"/>'), /use/);
    refused(wrap('<path d="M0 0" style="fill:red"/>'), /style/);
    refused(wrap('<path d="M0 0" class="x"/>'), /class/);
    refused(wrap('<foreignObject><div>x</div></foreignObject>'), /foreignobject/i);
    refused(wrap('<image href="https://example.com/x.png"/>'));
    refused(wrap('<a href="https://example.com"><path d="M0 0"/></a>'));
    refused(wrap('<path d="M0 0" xlink:href="#x"/>'));
    refused(wrap('<path d="M0 0" ONCLICK="x"/>'), /ONCLICK/);
    refused(wrap('<animate attributeName="href" to="javascript:alert(1)"/>'), /animate/);
  });

  test('DOCTYPE, entities, CDATA, comments and processing instructions are refused', () => {
    refused(`<!DOCTYPE svg [<!ENTITY x "y">]>${wrap('<path d="M0 0"/>')}`, /DOCTYPE/);
    refused(wrap('<![CDATA[<script>x</script>]]><path d="M0 0"/>'));
    refused(wrap('<?php echo 1; ?><path d="M0 0"/>'));
    refused(wrap('<!-- <script> --><path d="M0 0"/>'), /comments/);
  });

  test('values must be safe: path commands, numbers and no markup characters', () => {
    refused(wrap('<path d="M0 0 javascript:alert(1)"/>'), /path/);
    refused(wrap('<circle cx="12" cy="12" r="1e999"/>'), /range|number/);
    refused(wrap('<circle cx="12" cy="12" r="calc(1)"/>'), /number/);
    refused(wrap('<path d="M0 0 &lt;"/>'), /characters/);
    refused(wrap('<circle cx="12" cy="12"/>'), /needs "r"/);
  });

  test('type, dimensions, shape count and size limits', () => {
    refused(wrap('<path d="M0 0"/>', 'viewBox="0 0 48 48"'), /viewBox/);
    refused(wrap('<path d="M0 0"/>', 'viewBox="0 0 24 24" width="200" height="20"'), /square/);
    refused(wrap('<path d="M0 0"/>', 'viewBox="0 0 24 24" width="4096" height="4096"'), /square/);
    assert.ok(parseIconSvg(wrap('<path d="M0 0"/>', 'viewBox="0 0 24 24" width="48px" height="48px"')));
    refused(wrap('hello<path d="M0 0"/>'), /text/);
    refused(wrap('<g><path d="M0 0"/>'), /balanced/);
    refused(wrap(''), /no shapes/);
    refused(wrap('<path d="M0 0"/>'.repeat(33)), /at most/);
    refused(wrap(`<path d="M0 0 ${'L1 1 '.repeat(Math.ceil(MAX_BYTES / 5))}"/>`), /8 KB|too long/);
    refused('<html><svg viewBox="0 0 24 24"><path d="M0 0"/></svg></html>', /single <svg>/);
    refused('\x89PNG\r\n\x1a\n', /single <svg>/);
    refused(42);
  });

  test('stored shape data is re-checked before it is served', () => {
    assert.equal(isSafeShapes([{ type: 'path', attrs: { d: 'M4 12h16' } }]), true);
    assert.equal(isSafeShapes([{ type: 'script', attrs: {} }]), false);
    assert.equal(isSafeShapes([{ type: 'path', attrs: { d: 'M0 0', onclick: 'x' } }]), false);
    assert.equal(isSafeShapes([{ type: 'path', attrs: { d: '<script>' } }]), false);
    assert.equal(isSafeShapes([{ type: 'circle', attrs: { cx: '1' } }]), false);
    assert.equal(isSafeShapes([]), false);
    assert.equal(isSafeShapes('path'), false);
  });
});
