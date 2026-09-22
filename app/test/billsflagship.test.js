// BT-013-16 — the Bills page under each flagship layout. The Overdue/Due soon/Next 30 days cards
// already serve the flagship "KPI strip" role as-is (no new calculation); "Needs attention" and "All
// bills" — every real action (Edit, Record next, Pause/Resume, End, History, Delete permanently) —
// stay completely shared and unchanged, reparented rather than rebuilt. Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { createView } from "../js/ui/views/bills.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

function ready(data) { return { workspaceId: "ws_1", status: "ready", error: null, data }; }

const RENT = {
  id: "bill_rent", name: "Fictional Rent", billType: "housing", kind: "expense", accountId: "acc_1", accountName: "Checking",
  amount: "950.00", currency: "EUR", amountType: "fixed", schedule: { freq: "monthly", interval: 1, startDate: "2026-01-01" },
  reminderDays: 3, categoryId: null, payeeId: null, icon: "home", nextDue: "2026-09-01", revision: 1, responsible: null,
  overdue: ["2026-09-01"], reminders: [], canRecord: true, canEdit: true, inactiveReason: null, ended: false, pausedNow: false,
  versions: [], skips: [], pauses: [], history: [],
};

function baseState(layoutId, overrides = {}) {
  return {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Household", kind: "household", role: "owner", settingValues: { layoutId } }],
    preferences: null, layoutPreview: null,
    accounts: ready({ accounts: [{ id: "acc_1", name: "Checking", currency: "EUR", status: "open", capabilities: ["create"], icon: "bank" }] }),
    categories: ready({ categories: [] }),
    payees: ready({ payees: [] }),
    bills: ready({ recurring: [RENT], summary: { overdue: 1, dueSoon: 0, next30Days: [{ currency: "EUR", outgoing: "950.00", incoming: "0.00" }] } }),
    ...overrides,
  };
}

function boot(state) {
  const store = { getState: () => state, actions: { refreshBills: async () => {} } };
  const view = createView({ store, api: {}, params: {} });
  dom.body.appendChild(view.element);
  view.update(state);
  return { view };
}

describe("BT-013-16 Bills renders the workspace's real, applied layout", () => {
  test("Classic never shows the flagship wrapper", () => {
    const { view } = boot(baseState("classic"));
    assert.equal(view.element.querySelector(".dashflag"), null);
  });

  for (const layoutId of ["ledgerfly-forecast", "finexa-budget", "acru-overview"]) {
    test(`${layoutId}: the existing Overdue/Due soon/Next 30 days cards (the real KPI strip) and the real bill row survive, unchanged`, () => {
      const { view } = boot(baseState(layoutId));
      const flag = view.element.querySelector(".dashflag");
      assert.ok(flag);
      assert.match(flag.textContent, /Overdue/);
      assert.match(flag.textContent, /Due soon/);
      assert.match(flag.textContent, /Fictional Rent/);
      assert.match(flag.textContent, /EUR 950\.00/);
      assert.ok(flag.querySelector("table"), "the real bills table is still present");
    });
  }

  test("switching layouts REPARENTS the same cards/attention/listBox nodes, never rebuilding them", () => {
    const state = baseState("classic");
    const { view } = boot(state);
    const cardsBox = view.element.querySelector(".grid.grid--cards");
    state.workspaces[0].settingValues.layoutId = "ledgerfly-forecast";
    view.update(state);
    // assert.ok on a boolean, never assert.equal on two raw DOM node objects — see the note in
    // app/test/planningflagship.test.js: a genuine mismatch would make node:assert try to inspect
    // two large, ownerDocument-linked objects for its diff, extremely slow for this domdouble.
    assert.ok(view.element.querySelector(".grid.grid--cards") === cardsBox);
  });

  test("an unknown/demo-only layoutId falls back to Classic", () => {
    const { view } = boot(baseState("household-hub"));
    assert.equal(view.element.querySelector(".dashflag"), null);
    assert.match(view.element.textContent, /Fictional Rent/);
  });

  test("previewing disables Add bill with an explanation, in every layout", () => {
    for (const layoutId of ["classic", "finexa-budget"]) {
      dom.teardown(); dom = installDom();
      const { view } = boot(baseState(layoutId, { layoutPreview: { layoutId: "acru-overview" } }));
      const head = view.element.querySelector(".page-head__actions");
      const addBtn = head && head.querySelector("button");
      assert.ok(addBtn && addBtn.disabled, layoutId);
    }
  });
});
