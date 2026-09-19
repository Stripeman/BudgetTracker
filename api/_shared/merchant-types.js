'use strict';
// BT-019-03 (Terry, 2026-09-19): workspace-scoped merchant TYPE definitions — a name, an editable
// colour and an optional icon, each mapped to one of the fixed merchant classes this codebase
// already has (`api/_shared/merchants.js` MERCHANT_TYPES). Mirrors BT-019-02's account types and
// BT-019-01's category types exactly, reusing the existing managed merchant directory (BT-007-01)
// rather than a second, incompatible merchant model. Unlike an account's accounting class or a
// category's income/expense class, a merchant's own `type` carries no derived financial behaviour
// (it is a descriptive/analytics label only) — so this is the smallest and least risky of the three
// type registries — but the same presentation/behaviour separation, system defaults, retirement and
// usage-locked class changes are still offered, for a fully consistent experience across all three.
//
// SYSTEM DEFAULTS (one per class) are never stored eagerly — computed on demand (`effectiveTypes`,
// pure, safe for a GET) with a stable id per class (`mtype_sys_<class>`), persisted only inside a
// real write (`ensureSystemTypes`), the same "lazy, on first real need" pattern as the other two.
const colors = require('./colors');
const icons = require('./icons');
const merchants = require('./merchants');

const DEFAULT_LABEL = Object.freeze({
  retailer: 'Retailer', grocery: 'Grocery', restaurant: 'Restaurant or café', utility: 'Utility', housing: 'Landlord or housing',
  employer: 'Employer', bank: 'Bank or lender', insurer: 'Insurer', subscription: 'Subscription service', transport: 'Transport',
  health: 'Health', government: 'Government', person: 'Person', other: 'Other',
});

const systemTypeId = (merchantClass) => `mtype_sys_${merchantClass}`;

function systemTypeStub(merchantClass, nowIso) {
  const id = systemTypeId(merchantClass);
  const name = DEFAULT_LABEL[merchantClass] || merchantClass;
  return {
    id, name, merchantClass, color: null, defaultColor: colors.initialDefault(name, id),
    icon: null, defaultIcon: (icons.DEFAULTS.merchant && icons.DEFAULTS.merchant[merchantClass]) || null,
    system: true, retired: false, createdBy: 'system', createdAt: nowIso, history: [],
  };
}

function effectiveTypes(doc, nowIso) {
  const existing = doc.merchantTypes || [];
  const bySystemClass = new Map(existing.filter((t) => t.system).map((t) => [t.merchantClass, t]));
  const systemOnes = merchants.MERCHANT_TYPES.map((c) => bySystemClass.get(c) || systemTypeStub(c, nowIso));
  return [...systemOnes, ...existing.filter((t) => !t.system)];
}

function ensureSystemTypes(doc, nowIso) {
  doc.merchantTypes = doc.merchantTypes || [];
  const haveSystem = new Set(doc.merchantTypes.filter((t) => t.system).map((t) => t.merchantClass));
  for (const c of merchants.MERCHANT_TYPES) {
    if (!haveSystem.has(c)) doc.merchantTypes.push(systemTypeStub(c, nowIso));
  }
}

function findEffectiveType(doc, id, nowIso) {
  return effectiveTypes(doc, nowIso).find((t) => t.id === id) || null;
}

const usageCount = (doc, typeId) => (doc.payees || []).filter((p) => p.merchantTypeId === typeId).length;

function view(doc, t) {
  const usage = usageCount(doc, t.id);
  return {
    id: t.id, name: t.name, merchantClass: t.merchantClass,
    color: colors.effectiveColor(t), colorSource: t.color ? 'workspace' : 'default', defaultColor: colors.defaultColorFor(t),
    icon: t.icon || t.defaultIcon || null, iconSource: t.icon ? 'workspace' : 'default', defaultIcon: t.defaultIcon || null,
    system: !!t.system, retired: !!t.retired, inUse: usage > 0, usageCount: usage,
    createdAt: t.createdAt,
  };
}

module.exports = { DEFAULT_LABEL, systemTypeId, effectiveTypes, ensureSystemTypes, findEffectiveType, usageCount, view };
