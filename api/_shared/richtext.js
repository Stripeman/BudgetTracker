'use strict';
// Rich text (BT-011-02). A formatted note is stored as a ProseMirror document in a versioned
// envelope — { format: "tiptap", v: 1, doc } — never as HTML (the model TaskTracker uses; see
// docs/reviews/2026-09-13-editor-archaeology.md). This module is the SERVER's authority on what may
// be stored, and is deliberately stricter than TaskTracker's:
//
//   * a closed set of nodes and marks, the reduced set chosen for notes;
//   * a content model: which children each node may have, in what order and how many;
//   * only declared attributes, each with a closed set of values;
//   * marks only on text, each at most once; text non-empty and free of control characters;
//   * links only http:, https: or mailto:, stored exactly as cleaned, at most 2,048 characters;
//   * tight limits: 64 KiB, depth 12, 2,000 nodes, and the field's own character limit.
//
// Anything else is REFUSED, never silently stripped, and what is stored is a canonical rebuild
// containing only known keys. The client renders documents by building DOM nodes from the same
// closed set, so nothing stored here can become markup.
const { badRequest } = require('./http');

const FORMAT = 'tiptap';
const VERSION = 1;
const LIMITS = Object.freeze({ bytes: 64 * 1024, depth: 12, nodes: 2000, href: 2048 });
const LINK_REL = 'noopener noreferrer nofollow';
// Characters refused in text and links: C0 and C1 controls, DEL, zero-width and direction marks,
// line and paragraph separators, bidirectional embeddings, overrides and isolates, invisible
// operators and the byte-order mark. They hide or reorder what a reader sees (security review
// SEC-R8). Listed as code points so this source stays plain text.
const FORBIDDEN_RANGES = Object.freeze([[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff]]);
function hasForbiddenChar(s) {
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (FORBIDDEN_RANGES.some(([a, b]) => c >= a && c <= b)) return true;
  }
  return false;
}

const BLOCK = Object.freeze(['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'horizontalRule']);
const INLINE = Object.freeze(['text', 'hardBreak']);

// children: allowed child types; min: fewest children; first: required type of the first child;
// attrs: declared attributes as [validator, default]; leaf: no content at all.
const NODES = Object.freeze({
  doc: { children: BLOCK, min: 1 },
  paragraph: { children: INLINE },
  heading: { children: INLINE, attrs: { level: [(v) => v === 1 || v === 2 || v === 3, undefined] } },
  blockquote: { children: BLOCK, min: 1 },
  bulletList: { children: ['listItem'], min: 1 },
  orderedList: { children: ['listItem'], min: 1, attrs: { start: [(v) => Number.isInteger(v) && v >= 1 && v <= 100000, 1], type: [(v) => v === null, null] } },
  listItem: { children: BLOCK, min: 1, first: 'paragraph' },
  taskList: { children: ['taskItem'], min: 1 },
  taskItem: { children: BLOCK, min: 1, first: 'paragraph', attrs: { checked: [(v) => typeof v === 'boolean', false] } },
  horizontalRule: { leaf: true },
  hardBreak: { leaf: true },
});

// The one link rule, shared with the client renderer: only web and mail links, without surrounding
// space, without control or invisible characters (refused, not stripped) and without a user name or
// password, which disguises the real host ("https://bank.example@other.example/", SEC-R8).
function safeLinkHref(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim();
  if (!cleaned || cleaned.length > LIMITS.href || hasForbiddenChar(cleaned)) return null;
  let url;
  try { url = new URL(cleaned); } catch { return null; }
  if (url.username || url.password) return null;
  return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? cleaned : null;
}

const MARKS = Object.freeze({
  bold: {}, italic: {}, underline: {}, strike: {},
  link: {
    attrs: {
      href: [(v) => typeof v === 'string' && safeLinkHref(v) === v, undefined],
      target: [(v) => v === null || v === '_blank', '_blank'],
      rel: [(v) => v === null || v === LINK_REL, LINK_REL],
      class: [(v) => v === null, null],
    },
  },
});

const invalid = (field, detail) => badRequest(`${field} is not valid formatted text: ${detail}.`, 'invalid_rich_text');
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function onlyKeys(obj, allowed, field, where) {
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) throw invalid(field, `unknown key "${String(key).slice(0, 20)}" on ${where}`);
}

// Validates declared attributes and fills defaults, returning the canonical attribute object.
function attrsOf(given, spec, field, where) {
  if (given !== undefined && !isPlainObject(given)) throw invalid(field, `attributes of ${where} must be an object`);
  const attrs = given || {};
  for (const key of Object.keys(attrs)) if (!spec || !own(spec, key)) throw invalid(field, `undeclared attribute "${String(key).slice(0, 20)}" on ${where}`);
  if (!spec) return undefined;
  const out = {};
  for (const [key, [check, fallback]] of Object.entries(spec)) {
    const value = own(attrs, key) ? attrs[key] : fallback;
    if (value === undefined || !check(value)) throw invalid(field, `attribute "${key}" on ${where} is not allowed`);
    out[key] = value;
  }
  return out;
}

function marksOf(given, field) {
  if (given === undefined) return undefined;
  if (!Array.isArray(given) || given.length > Object.keys(MARKS).length) throw invalid(field, 'marks must be a short list');
  const seen = new Set();
  return given.map((mark) => {
    if (!isPlainObject(mark)) throw invalid(field, 'a mark must be an object');
    onlyKeys(mark, ['type', 'attrs'], field, 'a mark');
    if (typeof mark.type !== 'string' || !own(MARKS, mark.type)) throw invalid(field, `unknown mark "${String(mark.type).slice(0, 20)}"`);
    if (seen.has(mark.type)) throw invalid(field, `the ${mark.type} mark appears twice`);
    seen.add(mark.type);
    const attrs = attrsOf(mark.attrs, MARKS[mark.type].attrs, field, `the ${mark.type} mark`);
    return attrs ? { type: mark.type, attrs } : { type: mark.type };
  });
}

function build(node, allowed, depth, state, field) {
  if (!isPlainObject(node)) throw invalid(field, 'every node must be an object');
  if (depth > LIMITS.depth) throw invalid(field, `nesting is deeper than ${LIMITS.depth} levels`);
  state.nodes += 1;
  if (state.nodes > LIMITS.nodes) throw invalid(field, `more than ${LIMITS.nodes} parts`);
  const type = node.type;
  if (typeof type !== 'string' || (type !== 'text' && !own(NODES, type))) throw invalid(field, `unknown node "${String(type).slice(0, 20)}"`);
  if (!allowed.includes(type)) throw invalid(field, `${type} is not allowed here`);
  if (type === 'text') {
    onlyKeys(node, ['type', 'text', 'marks'], field, 'text');
    if (typeof node.text !== 'string' || !node.text) throw invalid(field, 'text must not be empty');
    if (hasForbiddenChar(node.text)) throw invalid(field, 'text contains control characters or invisible formatting characters');
    const marks = marksOf(node.marks, field);
    return marks && marks.length ? { type, text: node.text, marks } : { type, text: node.text };
  }
  const spec = NODES[type];
  onlyKeys(node, ['type', 'attrs', 'content'], field, type);
  const out = { type };
  const attrs = attrsOf(node.attrs, spec.attrs, field, type);
  if (attrs) out.attrs = attrs;
  if (spec.leaf) {
    if (node.content !== undefined) throw invalid(field, `${type} cannot have content`);
    return out;
  }
  if (node.content !== undefined && !Array.isArray(node.content)) throw invalid(field, `content of ${type} must be a list`);
  const children = (node.content || []).map((child) => build(child, spec.children, depth + 1, state, field));
  if (children.length < (spec.min || 0)) throw invalid(field, `${type} needs content`);
  if (spec.first && children[0].type !== spec.first) throw invalid(field, `${type} must start with a ${spec.first}`);
  if (children.length) out.content = children;
  return out;
}

// Plain text of a document: blocks on their own lines, hard breaks as new lines. Used for length
// limits, search, audit summaries and anything that must not show formatting.
function plainTextOf(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
  if (node.type === 'hardBreak') return '\n';
  const content = Array.isArray(node.content) ? node.content : [];
  const inline = node.type === 'paragraph' || node.type === 'heading';
  return content.map(plainTextOf).join(inline ? '' : '\n');
}

const isEnvelope = (value) => isPlainObject(value) && value.format === FORMAT;
const plainText = (value) => (typeof value === 'string' ? value : isEnvelope(value) ? plainTextOf(value.doc).trim() : '');

// Validates a formatted value and returns its canonical envelope, or throws 400.
function validate(value, { field = 'Text', max = 5000 } = {}) {
  if (!isPlainObject(value)) throw invalid(field, 'expected a formatted document');
  onlyKeys(value, ['format', 'v', 'doc'], field, 'the document');
  if (value.format !== FORMAT) throw invalid(field, 'unknown format');
  if (!Number.isInteger(value.v) || value.v < 1) throw invalid(field, 'missing version');
  if (value.v > VERSION) throw invalid(field, 'made by a newer version of the editor');
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > LIMITS.bytes) throw invalid(field, 'larger than 64 KB');
  const doc = build(value.doc, ['doc'], 1, { nodes: 0 }, field);
  const length = plainTextOf(doc).trim().length;
  if (length > max) throw badRequest(`${field} must be at most ${max} characters.`, 'invalid_field');
  return { format: FORMAT, v: VERSION, doc };
}

const isEmpty = (envelope) => !plainText(envelope);

module.exports = { FORMAT, VERSION, LIMITS, NODES, MARKS, LINK_REL, safeLinkHref, validate, plainText, plainTextOf, isEmpty, isEnvelope };
