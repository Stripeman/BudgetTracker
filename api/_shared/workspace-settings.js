'use strict';
// Workspace settings (Terry, 2026-09-14: "The application shouldnt set hard rules that a person
// shouldnt otherwise be able to have as a configuration… the user should be able to decide", then
// "build all 10"). Workflow and policy choices of a workspace are settings with defaults and plain
// explanations, and every default is TODAY'S behaviour, so nothing changes until someone changes it.
// Security and integrity rules are never settings: private by default, deny by default, site
// administrators never see financial records, ownership never grants another member's private
// accounts, nothing is deleted, audit is atomic, money is integer, no silent overwrite, and a restore
// never brings back access.
//
// THE MODEL is the one used for group settings (api/_shared/group-settings.js): SETTINGS is the
// allowlist — each key's type, default, label, plain explanation, who may change it and, for a choice,
// its options. Values are stored flat in the workspace document's existing `settings` object (next to
// `reportingCurrency`), so older documents need no migration: a key that is absent, or whose stored
// value is no longer valid, reads as its default. Changes go through the existing
// `PATCH /api/workspaces?id=` route, which keeps every real change in the workspace history (who, when,
// from, to, why) and audits it in the same write. The workspace GET returns every setting from this one
// list, so the interface renders them all the same way. ADDING A SETTING is one entry here plus its
// enforcement where the rule applies.
const { badRequest, HttpError } = require('./http');

// The daily restore ceiling for members below manager (security review SEC-R2). A workspace may lower
// it, never raise it: each merge or replace writes a full recovery point.
const MEMBER_RESTORES_MAX = 3;

const opt = (value, label) => Object.freeze({ value, label });
const freezeAll = (o) => Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.freeze({ ...v, ...(v.options ? { options: Object.freeze(v.options) } : {}) })])));

// `group` orders the list in the interface; `changedBy` is the lowest role that may change the key.
const SETTINGS = freezeAll({
  // (i) Budget defaults. `budgetPeriod` and `weekStart` existed before and were ignored; now they are
  // the defaults for new budgets (existing budgets keep their own period).
  budgetPeriod: {
    group: 'Budgets', type: 'choice', default: 'monthly', changedBy: 'manager', legacy: ['custom'],
    label: 'Budget period for new budgets',
    options: [opt('monthly', 'Monthly'), opt('weekly', 'Weekly'), opt('biweekly', 'Every two weeks')],
    explanation: 'The period a new budget starts with. Anyone adding a budget can still choose another, and budgets that already exist keep their own.',
  },
  weekStart: {
    group: 'Budgets', type: 'choice', default: 1, changedBy: 'manager',
    label: 'Weeks start on',
    options: [opt(1, 'Monday'), opt(0, 'Sunday'), opt(6, 'Saturday')],
    explanation: 'A new weekly or two-weekly budget starts on this day of the week unless another start date is chosen. Monthly budgets start on the first of the month.',
  },
});
const KEYS = Object.freeze(Object.keys(SETTINGS));
const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const ROLE_ORDER = ['viewer', 'member', 'manager', 'owner'];

function defaultOf(key, doc) {
  const d = SETTINGS[key].default;
  return typeof d === 'function' ? d(doc) : Array.isArray(d) ? [...d] : d;
}

// A set is stored in the order of its options, so equal sets compare equal.
const canonicalSet = (key, list) => SETTINGS[key].options.map((o) => o.value).filter((v) => list.includes(v));

function valid(key, value) {
  const s = SETTINGS[key];
  if (!s) return false;
  if (s.type === 'boolean') return typeof value === 'boolean';
  if (s.type === 'choice') return s.options.some((o) => o.value === value);
  if (s.type === 'integer') return Number.isSafeInteger(value) && value >= s.min && value <= s.max;
  if (s.type === 'set') {
    if (!Array.isArray(value) || new Set(value).size !== value.length || !value.every((v) => s.options.some((o) => o.value === v))) return false;
    return Object.entries(s.requires || {}).every(([k, needs]) => !value.includes(k) || value.includes(needs));
  }
  return false;
}

function stored(doc) {
  return doc && isPlainObject(doc.settings) ? doc.settings : {};
}

// Every setting's current value: what is stored when valid, otherwise the default.
function values(doc) {
  const s = stored(doc);
  return Object.fromEntries(KEYS.map((k) => [k, own(s, k) && valid(k, s[k]) ? (SETTINGS[k].type === 'set' ? canonicalSet(k, s[k]) : s[k]) : defaultOf(k, doc)]));
}
const get = (doc, key) => values(doc)[key];

const mayChange = (key, member) => !!member && ROLE_ORDER.indexOf(member.role) >= ROLE_ORDER.indexOf(SETTINGS[key].changedBy);
const whoLabel = (key) => (SETTINGS[key].changedBy === 'owner' ? 'owners' : 'owners and managers');

// A change request `{ <key>: <value> }`: only known keys, only valid values.
function parseChanges(input) {
  if (!isPlainObject(input)) throw badRequest('Send the settings to change.', 'invalid_field');
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (!own(SETTINGS, k)) throw badRequest(`There is no workspace setting called ${JSON.stringify(k).slice(0, 60)}.`, 'unknown_setting');
    if (!valid(k, v)) {
      const s = SETTINGS[k];
      const extra = s.type === 'integer' ? ` Choose a whole number from ${s.min} to ${s.max}.` : s.requires ? ' Bringing back deleted entries needs Merge.' : '';
      throw badRequest(`${s.label}: that is not one of its values.${extra}`, 'invalid_setting');
    }
    out[k] = SETTINGS[k].type === 'set' ? canonicalSet(k, v) : v;
  }
  return out;
}

// The real changes a request makes, as `{ key, from, to }`. `from` is the stored value when one is
// stored (so a legacy value such as budget period "custom" is recorded as it was), otherwise the
// default that applied. Refuses (403) a key the member may not change, naming who may.
function changesFor(doc, changes, member) {
  const s = stored(doc);
  const now = values(doc);
  const out = [];
  for (const [k, to] of Object.entries(changes)) {
    if (!mayChange(k, member)) throw new HttpError(403, 'forbidden', `Only ${whoLabel(k)} can change "${SETTINGS[k].label}".`);
    const from = own(s, k) ? s[k] : now[k];
    if (JSON.stringify(from) !== JSON.stringify(to)) out.push({ key: k, from, to });
  }
  return out;
}

// ---- rules used by the handlers ------------------------------------------------------------------

// (i) The default start of a new budget with this period: the first of the month for a monthly budget
// (today's default), the latest week-start day on or before today for a weekly or two-weekly one.
function defaultBudgetStart(doc, period, today) {
  if (period === 'monthly') return `${today.slice(0, 7)}-01`;
  const weekStart = get(doc, 'weekStart');
  const d = new Date(`${today}T00:00:00Z`);
  const back = (d.getUTCDay() - weekStart + 7) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

// What a member sees: every setting from the one list with its value and whether they may change it.
function view(doc, member) {
  const v = values(doc);
  return KEYS.map((k) => {
    const s = SETTINGS[k];
    return {
      key: k, group: s.group, type: s.type, label: s.label, explanation: s.explanation, value: v[k], default: defaultOf(k, doc),
      changedBy: s.changedBy, canChange: mayChange(k, member),
      ...(s.options ? { options: s.options.map((o) => ({ ...o })) } : {}),
      ...(s.type === 'integer' ? { min: s.min, max: s.max } : {}),
    };
  });
}

// Integrity (backups and restores): the settings object is an object, and each known key holds a valid
// value — or, for the settings that existed before this model, a value earlier versions accepted.
// Absent keys (older documents) pass.
function problem(doc) {
  if (doc.settings === undefined) return null;
  if (!isPlainObject(doc.settings)) return 'workspace settings';
  for (const k of KEYS) {
    if (!own(doc.settings, k)) continue;
    const x = doc.settings[k];
    if (!valid(k, x) && !(SETTINGS[k].legacy || []).includes(x)) return 'workspace settings';
  }
  return null;
}

module.exports = { SETTINGS, KEYS, values, get, valid, mayChange, parseChanges, changesFor, view, problem, defaultBudgetStart };
