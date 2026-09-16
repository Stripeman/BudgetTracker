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
  // (a) Shared expenses (BT-009) per workspace. Today: the section is shown for group, trip and
  // household workspaces and left out of personal ones, so that is the default by kind. The site
  // administrator's module switch is the upper bound: off for the site is off everywhere.
  sharedExpenses: {
    group: 'Shared expenses', type: 'boolean', default: (doc) => !doc || doc.kind !== 'personal', changedBy: 'manager',
    label: 'Use Shared expenses in this workspace',
    explanation: 'Split costs with the people in this workspace and see who owes whom. When it is off, the Shared expenses page and its dashboard summary are hidden and nobody can add to it; nothing already recorded is removed, and it all comes back when it is turned on again. It starts on for groups, trips and households and off for personal workspaces.',
  },
  // (f) Changing other members' entries on shared accounts (api/_shared/authz.js canChangeRecord).
  // Today a plain member changes only records they created there.
  memberEditsOthers: {
    group: 'Entries and shared lists', type: 'choice', default: 'own', changedBy: 'manager',
    label: 'Which entries a member may correct on shared accounts',
    options: [opt('own', 'Only entries they added'), opt('any', 'Any entry')],
    explanation: 'Owners and managers can always correct any entry on shared accounts. With “Only entries they added” a member corrects or deletes only what they added; with “Any entry” every member who can add entries may correct anyone’s entries and bills there. Every correction is still kept with who, when and why, entries locked by reconciling or by Shared expenses stay locked, viewers never change anything, and private accounts are never affected.',
  },
  // (g) Who manages the workspace's shared lists. Today: managers and owners (members may already add
  // shared merchants and shared contacts, and change the ones they added; viewers add neither).
  sharedListManagers: {
    group: 'Entries and shared lists', type: 'choice', default: 'managers', changedBy: 'manager',
    label: 'Who can add and change shared accounts, budgets and categories',
    options: [opt('managers', 'Owners and managers only'), opt('members', 'Owners, managers and members')],
    explanation: 'This covers the shared accounts, shared budgets and categories everyone uses, and changing any shared merchant or shared contact. Members can always add shared merchants and contacts and change the ones they added. Viewers never can, and private accounts, budgets, merchants and contacts always stay with the person they belong to.',
  },
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
  budgetBackdating: {
    group: 'Budgets', type: 'choice', default: 'confirm', changedBy: 'manager',
    label: 'Changing a budget for periods that have finished',
    options: [opt('confirm', 'Allowed after a confirmation'), opt('never', 'Not allowed')],
    explanation: 'Whether a change to a budget’s plan may reach back into periods that have already finished. With “Allowed after a confirmation” the person changing it must tick a box to say it is intended; with “Not allowed” a change always starts in the current period or later, so finished periods keep the plan they had.',
  },
  // (j) Bill defaults. Each bill's own reminder still wins; an entered date always wins.
  billReminderDays: {
    group: 'Bills', type: 'integer', default: 3, min: 0, max: 60, unit: 'days', changedBy: 'manager',
    label: 'Days before the due date a new bill shows as Due soon',
    explanation: 'New bills show under Due soon this many days before each payment. Each bill can still have its own number, which wins, and bills that already exist keep theirs.',
  },
  overdueRecordDate: {
    group: 'Bills', type: 'choice', default: 'today', changedBy: 'manager',
    label: 'Date used when recording a late bill',
    options: [opt('today', 'Today'), opt('due', 'Its due date')],
    explanation: 'The date a late bill payment is recorded with unless you enter another one. "Today" counts it in the budget period in which it was paid; "Its due date" counts it where it was owed.',
  },
  // (h) Restores by members below manager (owners and managers are not limited by these, as today).
  // Owners only. A member's restore only ever reaches their own private accounts, whatever is set.
  memberRestoresPerDay: {
    group: 'Restores by members', type: 'integer', default: MEMBER_RESTORES_MAX, min: 0, max: MEMBER_RESTORES_MAX, changedBy: 'owner',
    label: 'How often a member may restore their own records',
    // Shown as words; stored and validated as the number (0 to the ceiling).
    optionLabels: { 0: 'Not allowed', 1: 'Once a day', 2: 'Up to 2 a day', 3: 'Up to 3 a day' },
    explanation: `How many merge or replace restores each member may make in a day, for their own private records only. Each restore first saves a safety copy of the workspace, which is why ${MEMBER_RESTORES_MAX} a day is the most. Owners and managers are not limited by this.`,
    // Members have no restore screen yet (the Backups card is for owners and managers).
    groupNote: "Members can't restore from the app yet; this applies to restores through the API.",
  },
  memberRestoreModes: {
    group: 'Restores by members', type: 'set', default: ['create-new', 'merge', 'restore-deleted', 'replace'], changedBy: 'owner',
    label: 'Kinds of restore members may use',
    options: [opt('create-new', 'Create a new workspace from a backup'), opt('merge', 'Merge — add missing records'), opt('restore-deleted', 'Merge that also brings back deleted entries'), opt('replace', 'Replace — roll records back to the backup')],
    requires: { 'restore-deleted': 'merge' },
    requiresMessage: '“Merge that also brings back deleted entries” needs “Merge” ticked as well.',
    explanation: 'Which kinds of restore a member may use for their own private records. Bringing back deleted entries is part of a merge, so it needs Merge. Owners and managers are not limited by this.',
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

// Why a value is refused, naming the setting as the card shows it (UX review of eefd115, finding 1);
// `details.setting` lets the app mark that control.
function refusal(k, v) {
  const s = SETTINGS[k];
  const brokenRequirement = s.type === 'set' && Array.isArray(v) && Object.entries(s.requires || {}).some(([a, b]) => v.includes(a) && !v.includes(b));
  if (brokenRequirement && s.requiresMessage) return s.requiresMessage;
  if (s.type === 'integer' && !s.optionLabels) return `“${s.label}”: enter a whole number from ${s.min} to ${s.max}.`;
  return `“${s.label}”: choose one of the options shown.`;
}

// A change request `{ <key>: <value> }`: only known keys, only valid values.
function parseChanges(input) {
  if (!isPlainObject(input)) throw badRequest('Send the settings to change.', 'invalid_field');
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (!own(SETTINGS, k)) throw badRequest(`There is no workspace setting called ${JSON.stringify(k).slice(0, 60)}.`, 'unknown_setting');
    if (!valid(k, v)) throw badRequest(refusal(k, v), 'invalid_setting', { setting: k });
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
    if (!mayChange(k, member)) throw new HttpError(403, 'forbidden', `Only ${whoLabel(k)} can change “${SETTINGS[k].label}”.`, { setting: k });
    const from = own(s, k) ? s[k] : now[k];
    if (JSON.stringify(from) !== JSON.stringify(to)) out.push({ key: k, from, to });
  }
  return out;
}

// ---- rules used by the handlers ------------------------------------------------------------------

// (a) Shared expenses: the site administrator's module switch is the upper bound, then the workspace.
const siteAllowsSharedExpenses = (site) => !(site && site.modules && site.modules.sharedExpenses === false);
const sharedExpensesOn = (doc, site) => siteAllowsSharedExpenses(site) && get(doc, 'sharedExpenses') === true;
function assertSharedExpenses(doc, site) {
  if (!siteAllowsSharedExpenses(site)) throw new HttpError(403, 'shared_expenses_off', 'Shared expenses are turned off for this site by the site administrator. Nothing recorded has been removed.');
  if (get(doc, 'sharedExpenses') !== true) throw new HttpError(403, 'shared_expenses_off', 'Shared expenses are turned off in this workspace. An owner or manager can turn them on in Workspace settings; nothing recorded has been removed.');
}

// (f) A plain member may change another member's entry or bill on a shared account.
const membersChangeOthers = (doc) => get(doc, 'memberEditsOthers') === 'any';

// (g) Who manages the shared lists: managers and owners always; members when the setting says so;
// viewers never.
function managesSharedLists(doc, member) {
  if (!member) return false;
  if (member.role === 'manager' || member.role === 'owner') return true;
  return member.role === 'member' && get(doc, 'sharedListManagers') === 'members';
}

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
// `site` supplies the site-wide Shared expenses switch (`offForSite` when the site has it off).
function view(doc, member, site) {
  const v = values(doc);
  return KEYS.map((k) => {
    const s = SETTINGS[k];
    return {
      key: k, group: s.group, type: s.type, label: s.label, explanation: s.explanation, value: v[k], default: defaultOf(k, doc),
      changedBy: s.changedBy, canChange: mayChange(k, member),
      ...(s.options ? { options: s.options.map((o) => ({ ...o })) } : {}),
      // A small number shown as words ("Once a day"); the value stays the number.
      ...(s.optionLabels ? { options: Object.entries(s.optionLabels).map(([value, label]) => ({ value: Number(value), label })) } : {}),
      ...(s.type === 'integer' ? { min: s.min, max: s.max } : {}),
      ...(s.unit ? { unit: s.unit } : {}),
      // A kind that needs another (the app unticks it while that one is off), with the refusal's words.
      ...(s.requires ? { requires: { ...s.requires }, requiresMessage: s.requiresMessage } : {}),
      ...(s.groupNote ? { groupNote: s.groupNote } : {}),
      ...(k === 'sharedExpenses' && !siteAllowsSharedExpenses(site) ? { offForSite: true } : {}),
    };
  });
}

// Integrity (backups and restores): the settings object is an object, and each known key holds a valid
// value — or, for the settings that existed before this model, a value earlier versions accepted.
// Absent keys (older documents) pass.
function problem(doc) {
  if (doc.settings === undefined) return null;
  if (!isPlainObject(doc.settings)) return 'workspace settings';
  // As tolerant as reads (security review of eefd115, L-1; the group settings' rule, 12bee63): a value
  // this version does not know — left by a later version after a rollback, or an earlier "custom" budget
  // period — reads as the default and must not stop backups or restores. Only broken structure is refused:
  // one value where one value belongs, a list of values for a set. Unknown keys are not ours to judge.
  const scalar = (v) => v === null || typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
  for (const k of KEYS) {
    if (!own(doc.settings, k)) continue;
    const x = doc.settings[k];
    if (SETTINGS[k].type === 'set' ? !(Array.isArray(x) && x.every(scalar)) : !scalar(x)) return 'workspace settings';
  }
  return null;
}

module.exports = { SETTINGS, KEYS, MEMBER_RESTORES_MAX, values, get, valid, mayChange, parseChanges, changesFor, view, problem, defaultBudgetStart, membersChangeOthers, managesSharedLists,
  siteAllowsSharedExpenses, sharedExpensesOn, assertSharedExpenses };
