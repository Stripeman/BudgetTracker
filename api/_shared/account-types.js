'use strict';
// BT-019-02 (Terry, 2026-09-19): workspace-scoped account TYPE definitions — a name, an editable
// colour and an optional icon, each mapped to one of the fixed underlying accounting classes this
// codebase already has (api/_shared/ledger.js's ACCOUNT_TYPES: checking, savings, cash,
// credit-card, loan, mortgage, merchant-credit, investment, other-asset, other-liability). The type
// is presentation; the accounting class is what actually drives balance, direction, opening-balance
// and liability logic everywhere else (ledger.js's LIABILITY_TYPES/CREDIT_TYPES/LOAN_TYPES/
// NEVER_POSITIVE_OPENING) — kept STRICTLY separate on purpose: renaming or recolouring a type never
// touches a single account or transaction, because an account's own canonical `type` field (set
// once, from the chosen type's accountingClass, at creation) never re-reads the type record again.
//
// SYSTEM DEFAULTS (one per accounting class) are never stored eagerly for every workspace — they
// are computed on demand (`effectiveTypes`, pure, safe for a GET) with a STABLE, deterministic id
// per accounting class (`atype_sys_<class>`), and only actually written to the document
// (`ensureSystemTypes`) at the moment a real write needs them (creating/editing a type or an
// account) — the same "lazy, on first real need" pattern this codebase already uses for BT-009-20's
// default event. A system default can never be retired (a workspace's basic set is always
// available) and its own accountingClass can never change (that is its whole identity). A CUSTOM
// type's accountingClass can change only while nothing uses it yet — once any account references it
// (by id), the change is refused and explained, never silently applied, since it would otherwise
// reinterpret every account already using it.
const colors = require('./colors');
const icons = require('./icons');
const ledger = require('./ledger');

// Matches app/js/core/format.js ACCOUNT_TYPE_LABELS exactly, so a system type's name reads the same
// as the labels this app has always shown for these accounting classes.
const DEFAULT_LABEL = Object.freeze({
  checking: 'Checking', savings: 'Savings', cash: 'Cash', 'credit-card': 'Credit card', loan: 'Loan', mortgage: 'Mortgage',
  'merchant-credit': 'Merchant credit', investment: 'Investment', 'other-asset': 'Other asset', 'other-liability': 'Other liability',
});

const systemTypeId = (accountingClass) => `atype_sys_${accountingClass}`;

function systemTypeStub(accountingClass, nowIso) {
  const id = systemTypeId(accountingClass);
  const name = DEFAULT_LABEL[accountingClass] || accountingClass;
  return {
    id, name, accountingClass, color: null, defaultColor: colors.initialDefault(name, id),
    icon: null, defaultIcon: (icons.DEFAULTS.account && icons.DEFAULTS.account[accountingClass]) || null,
    system: true, retired: false, createdBy: 'system', createdAt: nowIso, history: [],
  };
}

// Every type that would exist for this workspace, including any system default not yet actually
// persisted — a PURE function, never mutates `doc`, safe to call from a plain read.
function effectiveTypes(doc, nowIso) {
  const existing = doc.accountTypes || [];
  const bySystemClass = new Map(existing.filter((t) => t.system).map((t) => [t.accountingClass, t]));
  const systemOnes = ledger.ACCOUNT_TYPES.map((c) => bySystemClass.get(c) || systemTypeStub(c, nowIso));
  return [...systemOnes, ...existing.filter((t) => !t.system)];
}

// Actually writes any missing system defaults into the document — called only from inside a real
// write (creating/editing a type or an account), never from a bare read.
function ensureSystemTypes(doc, nowIso) {
  doc.accountTypes = doc.accountTypes || [];
  const haveSystem = new Set(doc.accountTypes.filter((t) => t.system).map((t) => t.accountingClass));
  for (const c of ledger.ACCOUNT_TYPES) {
    if (!haveSystem.has(c)) doc.accountTypes.push(systemTypeStub(c, nowIso));
  }
}

// `id` may be a system type's stable id even before it has ever been materialized — callers should
// call `ensureSystemTypes` first when they intend to reference/store this id on a real record.
function findEffectiveType(doc, id, nowIso) {
  return effectiveTypes(doc, nowIso).find((t) => t.id === id) || null;
}

const usageCount = (doc, typeId) => (doc.accounts || []).filter((a) => a.accountTypeId === typeId).length;

function view(doc, t) {
  const usage = usageCount(doc, t.id);
  return {
    id: t.id, name: t.name, accountingClass: t.accountingClass,
    color: colors.effectiveColor(t), colorSource: t.color ? 'workspace' : 'default', defaultColor: colors.defaultColorFor(t),
    icon: t.icon || t.defaultIcon || null, iconSource: t.icon ? 'workspace' : 'default', defaultIcon: t.defaultIcon || null,
    system: !!t.system, retired: !!t.retired, inUse: usage > 0, usageCount: usage,
    createdAt: t.createdAt,
  };
}

module.exports = { DEFAULT_LABEL, systemTypeId, effectiveTypes, ensureSystemTypes, findEffectiveType, usageCount, view };
