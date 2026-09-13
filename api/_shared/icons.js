'use strict';
// Contextual icons (BT-011-05). ONE registry of stable icon ids. The artwork lives in the client
// registry (app/js/ui/icons.js) and the two id lists are checked against each other by a test; the
// server only knows ids, labels and which icons may be chosen.
//
// WHO MANAGES WHAT
//   * Site administrators manage the site catalogue: they can switch built-in icons off for new
//     choices, and add custom icons only through the validated upload (icon-svg.js). Nothing is
//     ever deleted: a custom icon is retired, and a retired or switched-off icon keeps drawing
//     wherever it is already used — it only leaves the pickers.
//   * Workspace owners and managers choose icons for shared categories and for the account, bill
//     and merchant TYPES of their workspace (`settings.typeIcons`).
//   * Everyone chooses icons for records they may edit (their private accounts, merchants, bills
//     and budgets) and may keep personal category icons in their own preferences.
//
// STORED BY ID on the record, so a rename, archive, close or supersede keeps the icon. An id the
// catalogue does not know (for example after a restore onto another site) draws the fallback icon.
// Money-direction icons are chosen by the app from the entry itself and cannot be switched off.
const { readDocument, stampDocument } = require('./schema');
const { badRequest } = require('./http');
const { isSafeShapes } = require('./icon-svg');

const FALLBACK = 'fallback';

// id, label, group. Groups only order the picker; any icon may be chosen anywhere.
const BUILT_IN = Object.freeze([
  ['fallback', 'Unknown', 'system'], ['money-in', 'Money in', 'system'], ['money-out', 'Money out', 'system'],
  ['transfer', 'Transfer', 'system'], ['reversal', 'Refund or reversal', 'system'],
  ['home', 'Home', 'category'], ['bolt', 'Energy', 'category'], ['cart', 'Groceries', 'category'], ['utensils', 'Dining', 'category'],
  ['car', 'Car', 'category'], ['heart', 'Health', 'category'], ['shield', 'Protection', 'category'], ['film', 'Entertainment', 'category'],
  ['bag', 'Shopping', 'category'], ['plane', 'Travel', 'category'], ['book', 'Education', 'category'], ['gift', 'Gift', 'category'],
  ['receipt', 'Receipt', 'category'], ['percent', 'Interest', 'category'], ['briefcase', 'Work', 'category'], ['coins', 'Coins', 'category'],
  ['tag', 'Tag', 'category'], ['wifi', 'Internet', 'category'], ['phone', 'Phone', 'category'], ['droplet', 'Water', 'category'],
  ['flame', 'Heating', 'category'], ['coffee', 'Coffee', 'category'], ['fuel', 'Fuel', 'category'], ['train', 'Train', 'category'],
  ['paw', 'Pets', 'category'], ['dumbbell', 'Fitness', 'category'], ['music', 'Music', 'category'],
  ['bank', 'Bank', 'account'], ['piggy-bank', 'Savings', 'account'], ['wallet', 'Wallet', 'account'], ['cash', 'Cash', 'account'],
  ['credit-card', 'Card', 'account'], ['loan', 'Loan', 'account'], ['mortgage', 'Mortgage', 'account'], ['store', 'Store', 'account'],
  ['chart-line', 'Investment', 'account'], ['diamond', 'Valuable', 'account'], ['scale', 'Owed', 'account'],
  ['building', 'Office', 'general'], ['user', 'Person', 'general'], ['users', 'Group', 'general'], ['repeat', 'Recurring', 'general'],
  ['calendar', 'Calendar', 'general'], ['id-card', 'Membership', 'general'], ['target', 'Goal', 'general'], ['filter', 'Filter', 'general'],
  ['chart-pie', 'Report', 'general'], ['bell', 'Alert', 'general'], ['alert', 'Warning', 'general'], ['clock', 'Due soon', 'general'],
  ['globe', 'Currency', 'general'], ['suitcase', 'Trip', 'general'],
].map(([id, label, group]) => Object.freeze({ id, label, group })));
const BUILT_IN_IDS = new Set(BUILT_IN.map((i) => i.id));
// Always available: the app draws these itself, so they can never be switched off.
const SYSTEM = new Set(BUILT_IN.filter((i) => i.group === 'system').map((i) => i.id));

// Defaults. Categories keep the default they were created with (`defaultIcon`), so renaming one
// never changes its icon; other records default by their type.
const CATEGORY_BY_NAME = Object.freeze({
  Housing: 'home', Utilities: 'bolt', Groceries: 'cart', Dining: 'utensils', Transport: 'car', Health: 'heart',
  Insurance: 'shield', Entertainment: 'film', Shopping: 'bag', Travel: 'plane', Education: 'book',
  'Gifts and donations': 'gift', 'Fees and charges': 'receipt', Interest: 'percent', Salary: 'briefcase',
  'Other income': 'coins', Uncategorized: 'tag',
});
const DEFAULTS = Object.freeze({
  category: Object.freeze({ expense: 'tag', income: 'coins' }),
  account: Object.freeze({
    checking: 'bank', savings: 'piggy-bank', cash: 'wallet', 'credit-card': 'credit-card', loan: 'loan', mortgage: 'mortgage',
    'merchant-credit': 'store', investment: 'chart-line', 'other-asset': 'diamond', 'other-liability': 'scale',
  }),
  merchant: Object.freeze({
    retailer: 'store', grocery: 'cart', restaurant: 'utensils', utility: 'bolt', housing: 'home', employer: 'briefcase', bank: 'bank',
    insurer: 'shield', subscription: 'repeat', transport: 'car', health: 'heart', government: 'building', person: 'user', other: 'store',
  }),
  bill: Object.freeze({
    housing: 'home', utilities: 'bolt', subscription: 'repeat', insurance: 'shield', 'debt-payment': 'loan', membership: 'id-card',
    income: 'briefcase', savings: 'piggy-bank', custom: 'calendar',
  }),
  budget: 'target',
});
// Record kinds whose TYPE icon a workspace may choose, and the types of each.
const TYPE_KINDS = Object.freeze({ account: DEFAULTS.account, merchant: DEFAULTS.merchant, bill: DEFAULTS.bill });

// Lookups use own properties only, so a name such as "__proto__" or "constructor" never reaches
// Object's prototype (security review SEC-I1).
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const initialCategoryIcon = (name, type) => (own(CATEGORY_BY_NAME, name) ? CATEGORY_BY_NAME[name] : own(DEFAULTS.category, type) ? DEFAULTS.category[type] : DEFAULTS.category.expense);

const ID_RE = /^([a-z][a-z0-9-]{0,39}|ico_[A-Za-z0-9_-]{6,64})$/;
const CUSTOM_RE = /^ico_[A-Za-z0-9_-]{6,64}$/;
const isIconId = (v) => typeof v === 'string' && ID_RE.test(v);
// Icons that may be offered at once, and all icons ever stored (retired ones included, since nothing
// is deleted) — the second bounds the catalogue document (SEC-I2, SEC-I4).
const MAX_CUSTOM = 100;
const MAX_STORED = 500;
const MAX_CATALOG_BYTES = 6 * 1024 * 1024;

// ---- catalogue (site/icons.json, a site-level document: no financial data) ----
const PATH = 'site/icons.json';
const EMPTY = Object.freeze({ disabled: [], custom: [], audit: [] });

async function readCatalog(storage) {
  const { value, etag } = await storage.getJson(PATH);
  const doc = readDocument('site', value);
  return { catalog: { ...structuredClone(EMPTY), ...(doc || {}) }, etag };
}

const stamp = (doc) => stampDocument('site', doc);

function customById(catalog, id) {
  return (catalog.custom || []).find((c) => c.id === id) || null;
}

// Known: drawable (possibly only as history). Selectable: may be chosen for something new.
function isKnown(catalog, id) {
  if (BUILT_IN_IDS.has(id)) return true;
  const c = customById(catalog, id);
  return !!c && isSafeShapes(c.shapes);
}
function isSelectable(catalog, id) {
  if (BUILT_IN_IDS.has(id)) return SYSTEM.has(id) || !(catalog.disabled || []).includes(id);
  const c = customById(catalog, id);
  return !!c && c.status === 'active' && isSafeShapes(c.shapes);
}

// Validates an icon chosen for a record. `null` resets to the inherited default. The value the
// record already has is always accepted again, so an icon that was later switched off or retired
// is never forced off a record that uses it (it just cannot be newly chosen).
function validateChoice(catalog, value, { current = null, field = 'Icon' } = {}) {
  if (value === null) return null;
  if (typeof value !== 'string' || !ID_RE.test(value)) throw badRequest(`${field} is not a valid icon.`, 'invalid_icon');
  if (value === current) return value;
  if (!isKnown(catalog, value)) throw badRequest(`${field} is not in the icon catalogue.`, 'invalid_icon');
  if (!isSelectable(catalog, value)) throw badRequest(`${field} has been switched off by the site administrator. Choose another icon.`, 'icon_unavailable');
  return value;
}

// Workspace type icons: { "account.checking": "bank", ... }. Only known kinds and types.
function validateTypeIcons(catalog, value, current = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('Type icons must be an object.', 'invalid_field');
  const out = { ...current };
  for (const [key, icon] of Object.entries(value)) {
    const [kind, type, extra] = key.split('.');
    if (extra !== undefined || !Object.prototype.hasOwnProperty.call(TYPE_KINDS, kind) || !Object.prototype.hasOwnProperty.call(TYPE_KINDS[kind], type)) {
      throw badRequest(`${key} is not a type that can have an icon.`, 'invalid_field');
    }
    const next = validateChoice(catalog, icon, { current: current[key] || null, field: 'Type icon' });
    if (next === null) delete out[key]; else out[key] = next;
  }
  return out;
}

// The icon a record shows, and where it came from: chosen on the record, the workspace's icon for
// its type, or the built-in default.
// Stored values that are not icon ids (a tampered or corrupted document) are ignored, so the result
// is always an id string.
function effective(kind, record, doc) {
  if (isIconId(record.icon)) return { icon: record.icon, iconSource: 'record' };
  if (kind === 'category') return { icon: isIconId(record.defaultIcon) ? record.defaultIcon : initialCategoryIcon(record.name, record.type), iconSource: 'default' };
  if (kind === 'budget') return { icon: DEFAULTS.budget, iconSource: 'default' };
  const type = kind === 'bill' ? record.billType : record.type;
  const typeIcons = (doc && doc.settings && doc.settings.typeIcons) || {};
  const key = `${kind}.${type}`;
  if (own(typeIcons, key) && isIconId(typeIcons[key])) return { icon: typeIcons[key], iconSource: 'type' };
  const defaults = own(TYPE_KINDS, kind) ? TYPE_KINDS[kind] : {};
  return { icon: own(defaults, type) ? defaults[type] : FALLBACK, iconSource: 'default' };
}

// What any signed-in person may read: every built-in id with whether it can be chosen, and custom
// icons as shape data (retired ones too, so records already using them still draw them).
function catalogView(catalog, { admin = false } = {}) {
  const disabled = new Set(catalog.disabled || []);
  return {
    fallback: FALLBACK,
    builtIn: BUILT_IN.map((i) => ({ ...i, enabled: SYSTEM.has(i.id) || !disabled.has(i.id), system: SYSTEM.has(i.id) })),
    custom: (catalog.custom || []).filter((c) => isSafeShapes(c.shapes)).map((c) => ({
      id: c.id, label: c.label, status: c.status, shapes: c.shapes,
      ...(admin ? { createdAt: c.createdAt, history: (c.history || []).map((h) => ({ at: h.at, action: h.action, from: h.from, to: h.to })) } : {}),
    })),
    defaults: DEFAULTS,
  };
}

module.exports = {
  FALLBACK, BUILT_IN, BUILT_IN_IDS, SYSTEM, DEFAULTS, TYPE_KINDS, CATEGORY_BY_NAME, CUSTOM_RE, MAX_CUSTOM, MAX_STORED, MAX_CATALOG_BYTES, PATH,
  initialCategoryIcon, readCatalog, stamp, customById, isKnown, isSelectable, validateChoice, validateTypeIcons, effective, catalogView,
};
