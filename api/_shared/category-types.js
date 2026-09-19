'use strict';
// BT-019-01 (Terry, 2026-09-19): workspace-scoped category TYPE definitions — a name, an editable
// colour and an optional icon, each mapped to one of the two fixed category classes this codebase
// already has (`expense`/`income`, `api/categories/handler.js`'s own `type` field). The type is
// presentation; a category's own `type` is what actually drives every income/expense rule elsewhere
// (budgets, forecasts, spending/income summaries) — kept STRICTLY separate on purpose, mirroring
// BT-019-02's account types exactly: renaming or recolouring a category type never touches a single
// category, because a category's own canonical `type` field (set once, from the chosen type's class,
// at creation) never re-reads the type record again. Preserves today's income/expense behaviour
// rather than letting a custom type label bypass it.
//
// SYSTEM DEFAULTS (one per class) are never stored eagerly for every workspace — they are computed
// on demand (`effectiveTypes`, pure, safe for a GET) with a STABLE, deterministic id per class
// (`ctype_sys_<class>`), and only actually written to the document (`ensureSystemTypes`) at the
// moment a real write needs them — the same "lazy, on first real need" pattern BT-019-02 and
// BT-009-20 already use. A system default can never be retired and its own class can never change. A
// CUSTOM type's class can change only while nothing uses it yet — once any category references it
// (by id), the change is refused and explained, never silently applied.
const colors = require('./colors');
const icons = require('./icons');

const CATEGORY_CLASSES = Object.freeze(['expense', 'income']);
const DEFAULT_LABEL = Object.freeze({ expense: 'Expense', income: 'Income' });

const systemTypeId = (categoryClass) => `ctype_sys_${categoryClass}`;

function systemTypeStub(categoryClass, nowIso) {
  const id = systemTypeId(categoryClass);
  const name = DEFAULT_LABEL[categoryClass] || categoryClass;
  return {
    id, name, categoryClass, color: null, defaultColor: colors.initialDefault(name, id),
    icon: null, defaultIcon: (icons.DEFAULTS.category && icons.DEFAULTS.category[categoryClass]) || null,
    system: true, retired: false, createdBy: 'system', createdAt: nowIso, history: [],
  };
}

// Every type that would exist for this workspace, including any system default not yet actually
// persisted — a PURE function, never mutates `doc`, safe to call from a plain read.
function effectiveTypes(doc, nowIso) {
  const existing = doc.categoryTypes || [];
  const bySystemClass = new Map(existing.filter((t) => t.system).map((t) => [t.categoryClass, t]));
  const systemOnes = CATEGORY_CLASSES.map((c) => bySystemClass.get(c) || systemTypeStub(c, nowIso));
  return [...systemOnes, ...existing.filter((t) => !t.system)];
}

// Actually writes any missing system defaults into the document — called only from inside a real
// write, never from a bare read.
function ensureSystemTypes(doc, nowIso) {
  doc.categoryTypes = doc.categoryTypes || [];
  const haveSystem = new Set(doc.categoryTypes.filter((t) => t.system).map((t) => t.categoryClass));
  for (const c of CATEGORY_CLASSES) {
    if (!haveSystem.has(c)) doc.categoryTypes.push(systemTypeStub(c, nowIso));
  }
}

function findEffectiveType(doc, id, nowIso) {
  return effectiveTypes(doc, nowIso).find((t) => t.id === id) || null;
}

const usageCount = (doc, typeId) => (doc.categories || []).filter((c) => c.categoryTypeId === typeId).length;

function view(doc, t) {
  const usage = usageCount(doc, t.id);
  return {
    id: t.id, name: t.name, categoryClass: t.categoryClass,
    color: colors.effectiveColor(t), colorSource: t.color ? 'workspace' : 'default', defaultColor: colors.defaultColorFor(t),
    icon: t.icon || t.defaultIcon || null, iconSource: t.icon ? 'workspace' : 'default', defaultIcon: t.defaultIcon || null,
    system: !!t.system, retired: !!t.retired, inUse: usage > 0, usageCount: usage,
    createdAt: t.createdAt,
  };
}

module.exports = {
  CATEGORY_CLASSES, DEFAULT_LABEL, systemTypeId, effectiveTypes, ensureSystemTypes, findEffectiveType, usageCount, view,
};
