'use strict';
// Colour-coded expense types (BT-011-04).
//
// STORED BY STABLE ID: a colour belongs to a category record, so renaming a category never changes
// its colour and historical entries keep their meaning. Each category also keeps the default it
// was given when created (`defaultColor`), which is what "reset to default" returns to.
//
// ACCESSIBLE: every colour — from the palette or custom — must be distinguishable as a swatch on
// every surface the app draws it on: at least 3:1 against the light surface and the dark and raised
// dark surfaces (WCAG 1.4.11 non-text contrast). Colour is never the only signal: the category name
// is always shown beside it. Category colours are independent of the application theme.
const { badRequest } = require('./http');

// Light surface, dark surface, raised dark surface (app/styles/tokens.css).
const SURFACES = Object.freeze(['#ffffff', '#141a24', '#1b222e']);
const MIN_CONTRAST = 3;

const PALETTE = Object.freeze([
  { id: 'blue', label: 'Blue', hex: '#3b82f6' }, { id: 'sky', label: 'Sky', hex: '#0284c7' },
  { id: 'cyan', label: 'Cyan', hex: '#0891b2' }, { id: 'teal', label: 'Teal', hex: '#0d9488' },
  { id: 'green', label: 'Green', hex: '#16a34a' }, { id: 'lime', label: 'Lime', hex: '#65a30d' },
  { id: 'amber', label: 'Amber', hex: '#d97706' }, { id: 'orange', label: 'Orange', hex: '#ea580c' },
  { id: 'red', label: 'Red', hex: '#dc2626' }, { id: 'rose', label: 'Rose', hex: '#e11d48' },
  { id: 'pink', label: 'Pink', hex: '#db2777' }, { id: 'fuchsia', label: 'Fuchsia', hex: '#c026d3' },
  { id: 'purple', label: 'Purple', hex: '#a855f7' }, { id: 'violet', label: 'Violet', hex: '#8b5cf6' },
  { id: 'indigo', label: 'Indigo', hex: '#6366f1' }, { id: 'brown', label: 'Brown', hex: '#a16207' },
  { id: 'slate', label: 'Slate', hex: '#64748b' }, { id: 'stone', label: 'Stone', hex: '#78716c' },
].map(Object.freeze));

// Sensible defaults for the built-in categories (workspace-model DEFAULT_CATEGORIES), all distinct.
const DEFAULT_BY_NAME = Object.freeze({
  Housing: 'indigo', Utilities: 'amber', Groceries: 'green', Dining: 'orange', Transport: 'sky', Health: 'red',
  Insurance: 'slate', Entertainment: 'fuchsia', Shopping: 'pink', Travel: 'cyan', Education: 'violet',
  'Gifts and donations': 'rose', 'Fees and charges': 'brown', Interest: 'purple', Salary: 'teal', 'Other income': 'lime',
  Uncategorized: 'stone',
});

function channel(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const isAccessible = (hex) => SURFACES.every((s) => contrast(hex, s) >= MIN_CONTRAST);

function validateColor(value, field = 'Colour') {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw badRequest(`${field} must be a colour written like #3b82f6.`, 'invalid_color');
  const hex = value.toLowerCase();
  if (!isAccessible(hex)) throw badRequest(`${field} is too light or too dark to see on every background. Choose a mid-tone colour.`, 'color_contrast');
  return hex;
}

const hexOf = (id) => PALETTE.find((p) => p.id === id).hex;
function hashIndex(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % PALETTE.length;
}

// The default a category is given when it is created: a named default for built-in categories,
// otherwise a palette colour chosen from its id (stable, never from its name).
// Own properties only: a category named "constructor" or "__proto__" must not reach Object's
// prototype (security review SEC-I1).
const initialDefault = (name, id) => (Object.prototype.hasOwnProperty.call(DEFAULT_BY_NAME, name) ? hexOf(DEFAULT_BY_NAME[name]) : PALETTE[hashIndex(id)].hex);
const defaultColorFor = (c) => c.defaultColor || PALETTE[hashIndex(c.id)].hex;
const effectiveColor = (c) => c.color || defaultColorFor(c);

module.exports = { PALETTE, SURFACES, MIN_CONTRAST, contrast, isAccessible, validateColor, initialDefault, defaultColorFor, effectiveColor };
