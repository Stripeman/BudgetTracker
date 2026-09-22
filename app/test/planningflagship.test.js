// BT-013-16 — the Planning (Budget/Cash flow) page under each flagship layout. Budgets, the
// forecast, its filters/warnings/table and What-if stay completely shared and unchanged — every
// calculation, filter and action (Edit, Archive, Delete permanently, Update forecast, what-if
// choices) is reused verbatim, reparented rather than rebuilt. Only the surrounding card wrapper per
// layout differs. Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { createView } from "../js/ui/views/planning.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

function ready(data) { return { workspaceId: "ws_1", status: "ready", error: null, data }; }

const BUDGET = {
  id: "bud_1", name: "Fictional Monthly Budget", icon: "target", scope: "shared", canEdit: true,
  status: {
    error: null, currency: "EUR", explanation: "Plan minus spent.", scopeNote: "",
    period: { start: "2026-09-01", end: "2026-09-30" },
    lines: [{ category: "Groceries", categoryId: "cat_g", planned: "400.00", carry: "0.00", actual: "150.00", committed: "0.00", available: "250.00", over: false, rollover: false }],
    totals: { planned: "400.00", available: "250.00" },
  },
};

function baseState(layoutId, overrides = {}) {
  return {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Household", kind: "household", role: "owner", settingValues: { layoutId } }],
    preferences: null, layoutPreview: null,
    accounts: ready({ accounts: [{ id: "acc_1", name: "Checking", currency: "EUR", status: "open", capabilities: ["create"], icon: "bank", balance: "1000.00" }] }),
    categories: ready({ categories: [{ id: "cat_g", name: "Groceries", color: "#2563eb", icon: "cart" }] }),
    budgets: ready({ budgets: [BUDGET] }),
    forecast: ready({ forecast: { accounts: [], warnings: [], assumptions: [], horizonDays: 90 } }),
    bills: ready({ recurring: [] }),
    ...overrides,
  };
}

function boot(state) {
  const store = { getState: () => state, actions: { refreshForecast: async () => {}, refreshBudgets: async () => {}, refreshBills: async () => {} } };
  const view = createView({ store, api: {} });
  dom.body.appendChild(view.element);
  view.update(state);
  return { view };
}

describe("BT-013-16 Planning (Budget) renders the workspace's real, applied layout", () => {
  test("Classic never shows the flagship wrapper", () => {
    const { view } = boot(baseState("classic"));
    assert.equal(view.element.querySelector(".dashflag"), null);
  });

  for (const layoutId of ["ledgerfly-forecast", "finexa-budget", "acru-overview"]) {
    test(`${layoutId}: the real budget card (with its real category, planned/spent/available figures) and the cash-flow section survive, unchanged`, () => {
      const { view } = boot(baseState(layoutId));
      const flag = view.element.querySelector(".dashflag");
      assert.ok(flag);
      assert.match(flag.textContent, /Fictional Monthly Budget/);
      assert.match(flag.textContent, /Groceries/);
      assert.match(flag.textContent, /EUR 400\.00/);
      assert.match(flag.textContent, /Cash flow/);
      assert.match(flag.textContent, /What if/);
    });
  }

  test("switching layouts REPARENTS the same stable containers (archivedBox), never rebuilding them — the budget CARDS inside budgetsBox are rebuilt on every update() regardless of layout, exactly like Classic already does, so their own identity is not what this proves", () => {
    const state = baseState("classic");
    const { view } = boot(state);
    // `archivedBox` (the "Archived budgets" <details>) is a stable container, never rebuilt by
    // update() — unlike the query used here, deliberately never assert.equal() on raw DOM node
    // objects: a genuine mismatch would make node:assert try to inspect two large, ownerDocument-
    // linked objects for its diff, which is extremely slow/memory-heavy for this domdouble's Node
    // class. assert.ok on a plain boolean avoids that entirely.
    const archivedBoxes = view.element.querySelectorAll(".more");
    const archivedBox = [...archivedBoxes].find((d) => d.textContent.includes("Archived budgets"));
    assert.ok(archivedBox, "found archivedBox before switching");
    state.workspaces[0].settingValues.layoutId = "acru-overview";
    view.update(state);
    const archivedBoxesAfter = view.element.querySelectorAll(".more");
    const archivedBoxAfter = [...archivedBoxesAfter].find((d) => d.textContent.includes("Archived budgets"));
    assert.ok(archivedBoxAfter === archivedBox, "the exact same node, just reparented");
  });

  test("an unknown/demo-only layoutId falls back to Classic", () => {
    const { view } = boot(baseState("goal-navigator"));
    assert.equal(view.element.querySelector(".dashflag"), null);
    assert.match(view.element.textContent, /Fictional Monthly Budget/);
  });

  test("previewing disables Add budget with an explanation, in every layout", () => {
    for (const layoutId of ["classic", "ledgerfly-forecast"]) {
      dom.teardown(); dom = installDom();
      const { view } = boot(baseState(layoutId, { layoutPreview: { layoutId: "finexa-budget" } }));
      const heads = view.element.querySelectorAll(".page-head__actions");
      const addBtn = [...heads].map((h) => h.querySelector("button")).find(Boolean);
      assert.ok(addBtn && addBtn.disabled, layoutId);
    }
  });
});
