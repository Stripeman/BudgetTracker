'use strict';
// Group settings (BT-009; Terry, 2026-09-14: "The application shouldnt set hard rules that a person
// shouldnt otherwise be able to have as a configuration"). Workflow and policy choices of a shared-
// expense group are settings with defaults and plain explanations; security and integrity rules
// (private by default, server-side authorization, no deletion, atomic audit, integer money, no silent
// overwrite) are never settings.
//
// ONE VALIDATED OBJECT PER GROUP, stored in the workspace document (a group is a workspace):
//   groupSettings: { values: { <key>: <value> }, history: [{ at, by, key, from, to, reason }] }
// SETTINGS is the allowlist: each key's type, default, label, plain explanation and, for a choice, its
// options. Reads merge stored values over the defaults, so older documents need no migration; an
// unknown key, or a value that is no longer valid, reads as the default. Only owners and managers
// change settings (one action, `POST /api/group?action=settings`); every real change keeps who, when,
// from, to and why, and is audited. The group view returns every setting from this one list, so the
// interface renders them all the same way. ADDING A SETTING is one entry here plus its enforcement
// where the rule applies.
const { badRequest } = require('./http');

const SETTINGS = Object.freeze({
  anyoneConfirms: Object.freeze({
    type: 'boolean', default: true, label: 'Anyone in the group can confirm payments',
    explanation: 'When this is on, anyone in the group can mark a payment as confirmed — useful for a family, or when one person keeps the group\'s accounts for everyone. Each confirmation shows who made it. When it is off, only the person who received the money can confirm it (a manager or owner confirms payments to contacts, who cannot sign in).',
  }),
  ownedEntries: Object.freeze({
    type: 'choice', default: 'shared-only', label: 'Owed-to-others and repayment entries',
    options: Object.freeze([
      Object.freeze({ value: 'shared-only', label: 'Created by Shared expenses only' }),
      Object.freeze({ value: 'manual', label: 'Also allow entering them by hand' }),
    ]),
    explanation: 'These entries keep your own account in step with a shared group. \'Owed to others\' records your share of something someone else paid: it counts as your spending now and as money you owe, and no money leaves your account. \'Repayment\' records money you paid back to someone. Shared expenses creates both automatically when you record your part on your own account. Allow entering them by hand only if you settle shared costs outside Shared expenses.',
  }),
  // (b) The default split for new expenses (Terry, 2026-09-14). The server applies them when a request
  // leaves the payer or the split out; each person may keep their own as personal preferences.
  splitMethod: Object.freeze({
    type: 'choice', default: 'equal', label: 'Default split for new expenses',
    options: Object.freeze([
      Object.freeze({ value: 'equal', label: 'Equally' }), Object.freeze({ value: 'amounts', label: 'By amounts' }),
      Object.freeze({ value: 'percentages', label: 'By percentages' }), Object.freeze({ value: 'shares', label: 'By shares' }),
    ]),
    explanation: 'New expenses start with this way of splitting, and each person can still choose another one or keep their own default.',
  }),
  splitWho: Object.freeze({
    type: 'choice', default: 'everyone', label: 'Who shares a new expense by default',
    options: Object.freeze([Object.freeze({ value: 'everyone', label: 'Everyone in the group' }), Object.freeze({ value: 'me', label: 'Only the person adding it' })]),
    explanation: 'New expenses start with these people ticked, and anyone adding one can change who shares it before saving.',
  }),
  paidBy: Object.freeze({
    type: 'choice', default: 'me', label: 'Who paid a new expense, by default',
    options: Object.freeze([Object.freeze({ value: 'me', label: 'The person adding it' }), Object.freeze({ value: 'nobody', label: 'Nobody until someone is chosen' })]),
    explanation: 'New expenses start with this payer, or with nobody so that whoever adds one must always say who paid.',
  }),
  // (c) Who may correct or void a shared expense. Viewers never may.
  changeExpenses: Object.freeze({
    type: 'choice', default: 'author-or-manager', label: 'Who may correct or void a shared expense',
    options: Object.freeze([
      Object.freeze({ value: 'author-or-manager', label: 'The person who added it, or a manager or owner' }),
      Object.freeze({ value: 'any-writer', label: 'Any member who can add expenses' }),
    ]),
    explanation: 'Every correction and void keeps who made it, when and why, and viewers can never change an expense.',
  }),
  // (d) Payment rules. The payer confirms only as "Can confirm payments" allows; every action is attributed.
  withdrawPayments: Object.freeze({
    type: 'choice', default: 'receiver-or-manager', label: 'Who may withdraw a confirmed payment',
    options: Object.freeze([
      Object.freeze({ value: 'receiver-or-manager', label: 'The receiver, or a manager or owner' }),
      Object.freeze({ value: 'receiver', label: 'The receiver only' }),
      Object.freeze({ value: 'confirmers', label: 'Anyone who can confirm payments' }),
    ]),
    explanation: 'Withdrawing keeps the payment and its reason in the history, and for a contact a manager or owner acts as the receiver.',
  }),
  disputePayments: Object.freeze({
    type: 'choice', default: 'receiver', label: 'Who may dispute a reported payment',
    options: Object.freeze([Object.freeze({ value: 'receiver', label: 'The receiver' }), Object.freeze({ value: 'receiver-or-manager', label: 'The receiver, or a manager or owner' })]),
    explanation: 'A disputed payment is not counted until it is sorted out, and the person who received it can always dispute it.',
  }),
  // Who may confirm a payment over its receiver's dispute (financial recheck of 47617b5, F1). Confirming
  // under "Anyone in the group can confirm payments" moves a REPORTED payment only; a disputed one follows
  // this rule, and a confirmation over a dispute is always marked in the view, history and audit.
  settleDisputes: Object.freeze({
    type: 'choice', default: 'receiver', label: 'Who can settle a disputed payment',
    options: Object.freeze([
      Object.freeze({ value: 'receiver', label: 'The person who received it (a manager or owner for a contact)' }),
      Object.freeze({ value: 'receiver-or-manager', label: 'The person who received it, or a manager or owner' }),
      Object.freeze({ value: 'confirmers', label: 'Anyone who can confirm payments' }),
    ]),
    explanation: 'A disputed payment counts in the balances only once someone allowed here confirms it, and that confirmation is always shown as made over the dispute.',
  }),
  receiverConfirms: Object.freeze({
    type: 'boolean', default: true, label: 'A payment recorded by the person who received it counts as confirmed straight away',
    explanation: 'When this is off, such a payment is only reported and still needs its own confirmation step.',
  }),
  // (e) The suggestion basis. Each person's preferred balance view is a personal preference.
  countReported: Object.freeze({
    type: 'boolean', default: true, label: 'Count \'I paid\' before it is confirmed when suggesting who pays whom',
    explanation: 'When this is on, a reported payment counts as made up to what is owed so nobody is asked to pay twice, while balances always count confirmed payments only.',
  }),
});
const KEYS = Object.freeze(Object.keys(SETTINGS));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// PER-PERSON OVERRIDES of a group setting (Terry, 2026-09-14), set by owners and managers on each
// member: "Use the group setting" (the default, stored as no entry), or a fixed value. Stored in the
// same object as `perMember: { <key>: { <memberId>: { value, at, by, period } } }` and kept in the same
// history with the member it concerns. An override counts only while its member is active and in the
// membership period it was set in (`period` = how many times they had rejoined), so a removed member's
// override is ignored and never comes back if they rejoin. ADDING ONE is an entry here plus its rule.
const INHERIT = 'inherit';
const PER_MEMBER = Object.freeze({
  confirmOverrides: Object.freeze({
    setting: 'anyoneConfirms', label: 'Can confirm payments',
    options: Object.freeze([
      Object.freeze({ value: INHERIT, label: 'Use the group setting' }),
      Object.freeze({ value: 'yes', label: 'Yes' }),
      Object.freeze({ value: 'no', label: 'No' }),
    ]),
  }),
});
const PER_MEMBER_KEYS = Object.freeze(Object.keys(PER_MEMBER));
const periodOf = (m) => (Array.isArray(m.history) ? m.history.filter((x) => x && x.event === 'rejoined').length : 0);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function perMemberStored(doc, key) {
  const gs = doc && doc.groupSettings;
  const all = gs && isPlainObject(gs) && isPlainObject(gs.perMember) ? gs.perMember : {};
  return isPlainObject(all[key]) ? all[key] : {};
}

// A member's override for `key`: 'inherit' unless one was set for them in their current membership.
function overrideOf(doc, key, m) {
  if (!m || m.status !== 'active') return INHERIT;
  const map = perMemberStored(doc, key);
  const o = own(map, m.id) ? map[m.id] : null;
  if (!isPlainObject(o) || o.value === INHERIT || !PER_MEMBER[key].options.some((x) => x.value === o.value)) return INHERIT;
  return o.period === periodOf(m) ? o.value : INHERIT;
}

// "Can confirm payments" for one member: may they confirm any reported payment (their own and ones to
// or from contacts included)? The override if set, otherwise the group setting. A viewer never may: a
// viewer confirms only payments made to them (security review S7).
function confirmsAny(doc, m) {
  if (!m || m.role === 'viewer') return false;
  const o = overrideOf(doc, 'confirmOverrides', m);
  return o === INHERIT ? get(doc, 'anyoneConfirms') : o === 'yes';
}

function valid(key, value) {
  const s = SETTINGS[key];
  if (!s) return false;
  if (s.type === 'boolean') return typeof value === 'boolean';
  if (s.type === 'choice') return s.options.some((o) => o.value === value);
  return false;
}

function stored(doc) {
  const gs = doc && doc.groupSettings;
  return gs && typeof gs === 'object' && gs.values && typeof gs.values === 'object' && !Array.isArray(gs.values) ? gs.values : {};
}

// Every setting's current value: what is stored when valid, otherwise the default.
function values(doc) {
  const s = stored(doc);
  return Object.fromEntries(KEYS.map((k) => [k, own(s, k) && valid(k, s[k]) ? s[k] : SETTINGS[k].default]));
}
const get = (doc, key) => values(doc)[key];

// A change request `{ <key>: <value> }`: only known keys, only valid values. A per-person key takes
// `{ <memberId>: 'inherit' | <value> }`; which members may be named is checked in apply(), against the
// document.
function parseChanges(input) {
  if (!isPlainObject(input) || !Object.keys(input).length) throw badRequest('Send the settings to change.', 'invalid_field');
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (own(PER_MEMBER, k)) {
      const p = PER_MEMBER[k];
      if (!isPlainObject(v) || !Object.keys(v).length) throw badRequest(`${p.label}: choose a setting for each person.`, 'invalid_setting');
      for (const [id, x] of Object.entries(v)) {
        if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || !p.options.some((o) => o.value === x)) throw badRequest(`${p.label}: that is not one of its values.`, 'invalid_setting');
      }
      out[k] = { ...v };
      continue;
    }
    if (!own(SETTINGS, k)) throw badRequest(`There is no setting called ${JSON.stringify(k)}.`, 'unknown_setting');
    if (!valid(k, v)) throw badRequest(`${SETTINGS[k].label}: that is not one of its values.`, 'invalid_setting');
    out[k] = v;
  }
  return out;
}

// Applies the changes that differ from the current values and keeps each in the history. Returns the
// keys that changed (none when nothing differs). A per-person change may name only an active member of
// the group; anyone else is refused as invalid, so nothing is written.
function apply(doc, changes, { by, at, reason = '' }) {
  const now = values(doc);
  const changed = KEYS.filter((k) => own(changes, k) && changes[k] !== now[k]);
  const personal = [];
  for (const key of PER_MEMBER_KEYS.filter((k) => own(changes, k))) {
    for (const [id, to] of Object.entries(changes[key])) {
      const m = (doc.members || []).find((x) => x.id === id);
      if (!m || m.status !== 'active') throw badRequest(`${PER_MEMBER[key].label}: that person is not in the group.`, 'invalid_setting');
      const from = overrideOf(doc, key, m);
      if (from !== to) personal.push({ key, m, from, to });
    }
  }
  if (!changed.length && !personal.length) return [];
  const gs = isPlainObject(doc.groupSettings) ? doc.groupSettings : {};
  const perMember = isPlainObject(gs.perMember) ? { ...gs.perMember } : {};
  // Every change of the request goes into ONE map per key, built from what is stored, so several people
  // changed at once are all kept (security recheck of 47617b5, M1); the history below lists exactly these.
  const maps = {};
  for (const { key, m, to } of personal) {
    if (!maps[key]) maps[key] = { ...perMemberStored(doc, key) };
    // "Use the group setting" is kept as that value, so the record of the earlier choice stays readable.
    maps[key][m.id] = { value: to, at, by, period: periodOf(m) };
  }
  Object.assign(perMember, maps);
  doc.groupSettings = {
    ...gs,
    values: { ...stored(doc), ...Object.fromEntries(changed.map((k) => [k, changes[k]])) },
    ...(personal.length ? { perMember } : {}),
    // Never truncated (BT-001-05).
    history: [...(Array.isArray(gs.history) ? gs.history : []),
      ...changed.map((k) => ({ at, by, key: k, from: now[k], to: changes[k], reason })),
      ...personal.map(({ key, m, from, to }) => ({ at, by, key, member: m.id, from, to, reason }))],
  };
  return [...changed, ...[...new Set(personal.map((p) => p.key))]];
}

// What a member sees: each group-wide setting from the one list; their own effective right (`mine`);
// and, for owners and managers only, every active member's override and effective right (`members`).
// The history holds group-wide changes for everyone; a per-person change is shown to owners and
// managers and to the person it concerns, never to the rest of the group.
function view(doc, nameOf, member, manages) {
  const v = values(doc);
  const history = isPlainObject(doc.groupSettings) && Array.isArray(doc.groupSettings.history) ? doc.groupSettings.history : [];
  const memberName = (id) => { const m = (doc.members || []).find((x) => x.id === id); return m ? nameOf(m.subject) : 'Former member'; };
  const label = (k) => (SETTINGS[k] ? SETTINGS[k].label : PER_MEMBER[k] ? PER_MEMBER[k].label : k);
  return {
    settings: KEYS.map((k) => ({
      key: k, type: SETTINGS[k].type, label: SETTINGS[k].label, explanation: SETTINGS[k].explanation, value: v[k], default: SETTINGS[k].default,
      ...(SETTINGS[k].options ? { options: SETTINGS[k].options.map((o) => ({ ...o })) } : {}),
    })),
    perMember: PER_MEMBER_KEYS.map((k) => ({ key: k, setting: PER_MEMBER[k].setting, label: PER_MEMBER[k].label, options: PER_MEMBER[k].options.map((o) => ({ ...o })) })),
    ...(member ? { mine: { override: overrideOf(doc, 'confirmOverrides', member), effective: confirmsAny(doc, member) } } : {}),
    ...(member && manages ? {
      members: (doc.members || []).filter((m) => m.status === 'active').map((m) => ({
        memberId: m.id, name: nameOf(m.subject), role: m.role, override: overrideOf(doc, 'confirmOverrides', m), effective: confirmsAny(doc, m),
      })),
    } : {}),
    history: history.filter((h) => !h.member || manages || (member && h.member === member.id)).map((h) => ({
      at: h.at, by: nameOf(h.by), key: h.key, label: label(h.key), ...(h.member ? { member: memberName(h.member) } : {}), from: h.from, to: h.to, reason: h.reason || '',
    })),
  };
}

// A create-new restore (security review S4): the new workspace has only the restorer as a member, so
// nobody else's per-person override comes along and history entries about other members name a former
// member. Their subjects are mapped by the caller like everything else.
function forNewWorkspace(gs, keepMemberId) {
  if (!isPlainObject(gs)) return gs;
  const out = { ...gs };
  if (isPlainObject(gs.perMember)) {
    out.perMember = Object.fromEntries(Object.entries(gs.perMember).map(([k, map]) => [k, isPlainObject(map) && own(map, keepMemberId) ? { [keepMemberId]: { ...map[keepMemberId] } } : {}]));
  }
  if (Array.isArray(gs.history)) out.history = gs.history.map((h) => (h && h.member && h.member !== keepMemberId ? { ...h, member: 'former' } : h));
  return out;
}

// Integrity (backups and restores): the shape is right and known keys hold valid values. Absent
// settings (older documents) pass.
function problem(doc) {
  const gs = doc.groupSettings;
  if (gs === undefined) return null;
  if (!isPlainObject(gs)) return 'group settings';
  if (gs.values !== undefined && !isPlainObject(gs.values)) return 'group settings';
  // As tolerant as reads (financial recheck of 47617b5, L3): a value this version does not know, left
  // by a later version after a rollback, reads as the default and must not stop backups. Only broken
  // structure is refused: every value is a single value, never an object or a list.
  const scalar = (v) => v === null || typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
  for (const v of Object.values(gs.values || {})) if (!scalar(v)) return 'group settings';
  if (gs.perMember !== undefined) {
    if (!isPlainObject(gs.perMember)) return 'group settings';
    for (const [k, map] of Object.entries(gs.perMember)) {
      if (!own(PER_MEMBER, k)) continue;
      if (!isPlainObject(map)) return 'group settings';
      // An override is an object with a text value (an unknown one reads as "Use the group setting") and
      // a whole, non-negative membership period.
      for (const o of Object.values(map)) {
        if (!isPlainObject(o) || typeof o.value !== 'string' || !Number.isSafeInteger(o.period) || o.period < 0) return 'group settings';
      }
    }
  }
  if (gs.history !== undefined && !Array.isArray(gs.history)) return 'group settings';
  return null;
}

module.exports = { SETTINGS, KEYS, PER_MEMBER, values, get, overrideOf, confirmsAny, parseChanges, apply, view, forNewWorkspace, problem };
