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
});
const KEYS = Object.freeze(Object.keys(SETTINGS));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

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

// A change request `{ <key>: <value> }`: only known keys, only valid values.
function parseChanges(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length) throw badRequest('Send the settings to change.', 'invalid_field');
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (!own(SETTINGS, k)) throw badRequest(`There is no setting called ${JSON.stringify(k)}.`, 'unknown_setting');
    if (!valid(k, v)) throw badRequest(`${SETTINGS[k].label}: that is not one of its values.`, 'invalid_setting');
    out[k] = v;
  }
  return out;
}

// Applies the changes that differ from the current values and keeps each in the history. Returns the
// keys that changed (none when nothing differs).
function apply(doc, changes, { by, at, reason = '' }) {
  const now = values(doc);
  const changed = KEYS.filter((k) => own(changes, k) && changes[k] !== now[k]);
  if (!changed.length) return [];
  const gs = doc.groupSettings && typeof doc.groupSettings === 'object' && !Array.isArray(doc.groupSettings) ? doc.groupSettings : {};
  doc.groupSettings = {
    ...gs,
    values: { ...stored(doc), ...Object.fromEntries(changed.map((k) => [k, changes[k]])) },
    // Never truncated (BT-001-05).
    history: [...(Array.isArray(gs.history) ? gs.history : []), ...changed.map((k) => ({ at, by, key: k, from: now[k], to: changes[k], reason }))],
  };
  return changed;
}

// What every member sees: each setting from the one list, and who changed what, when and why.
function view(doc, nameOf) {
  const v = values(doc);
  const history = doc.groupSettings && Array.isArray(doc.groupSettings.history) ? doc.groupSettings.history : [];
  return {
    settings: KEYS.map((k) => ({
      key: k, type: SETTINGS[k].type, label: SETTINGS[k].label, explanation: SETTINGS[k].explanation, value: v[k], default: SETTINGS[k].default,
      ...(SETTINGS[k].options ? { options: SETTINGS[k].options.map((o) => ({ ...o })) } : {}),
    })),
    history: history.map((h) => ({ at: h.at, by: nameOf(h.by), key: h.key, label: SETTINGS[h.key] ? SETTINGS[h.key].label : h.key, from: h.from, to: h.to, reason: h.reason || '' })),
  };
}

// Integrity (backups and restores): the shape is right and known keys hold valid values. Absent
// settings (older documents) pass.
function problem(doc) {
  const gs = doc.groupSettings;
  if (gs === undefined) return null;
  if (!gs || typeof gs !== 'object' || Array.isArray(gs)) return 'group settings';
  if (gs.values !== undefined && (!gs.values || typeof gs.values !== 'object' || Array.isArray(gs.values))) return 'group settings';
  for (const [k, v] of Object.entries(gs.values || {})) if (own(SETTINGS, k) && !valid(k, v)) return 'group settings';
  if (gs.history !== undefined && !Array.isArray(gs.history)) return 'group settings';
  return null;
}

module.exports = { SETTINGS, KEYS, values, get, parseChanges, apply, view, problem };
