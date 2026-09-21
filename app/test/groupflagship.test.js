// BT-013-16 — the Shared expenses page under each flagship layout. This page is already built as a
// stack of individually-carded sections (Balances, Settle up, Expenses, Payments, Events,
// Households, Shared fund, Payment reminders, Insights, Offline entry, Settings, Your own defaults)
// — every one of them, and everything inside them, stays completely shared and unchanged. Given this
// page's size and the real financial risk of its settlement/ledger logic, the SAME stack is
// reparented into a `.dashflag` accent wrapper for flagship layouts rather than restructured — a
// deliberately narrower scope than the other real pages' own KPI strips, disclosed in
// PROJECT_STATE.md. Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { createView } from "../js/ui/views/group.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

function baseState(layoutId, overrides = {}) {
  const participants = [{ ref: "member:a", name: "Alice", type: "member", self: true, active: true }, { ref: "member:b", name: "Bob", type: "member", self: false, active: true }];
  return {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Trip Club", kind: "group", role: "owner", settingValues: { layoutId } }],
    preferences: null, layoutPreview: null,
    group: { workspaceId: "ws_1", status: "ready", error: null, data: {
      currency: "EUR", kind: "group", permissions: { canAdd: true, canManage: true, selfRef: "member:a", role: "owner" },
      participants, expenses: [], settlements: [],
      balances: [{ currency: "EUR", rows: [{
        ref: "member:b", name: "Bob", net: "42.50", paid: "42.50", share: "0.00", paidOut: "0.00", received: "0.00",
        pendingOut: "0.00", pendingIn: "0.00", disputedOut: "0.00", disputedIn: "0.00", expenses: [],
      }], suggestions: [], direct: [] }],
      basis: "Balances count confirmed payments only.", events: [], defaultEventId: null,
      eventAccessNote: "Events organize expenses and payments; they do not change who can see them.",
    } },
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts: [], totals: [] } },
    categories: { workspaceId: "ws_1", status: "ready", error: null, data: { categories: [] } },
    transactions: { workspaceId: "ws_1", status: "ready", error: null, data: { transactions: [], summary: [], total: 0 } },
    payees: { workspaceId: "ws_1", status: "ready", error: null, data: { payees: [] } },
    ...overrides,
  };
}

function boot(state) {
  const store = { getState: () => state, actions: { write: async (fn) => { const result = await fn("ws_1"); return { ok: true, result }; }, refreshGroup: async () => {}, setGroupEventFilter: async () => {} } };
  const view = createView({ store, api: {} });
  dom.body.appendChild(view.element);
  view.update(state);
  return { view };
}

describe("BT-013-16 Shared expenses renders the workspace's real, applied layout", () => {
  test("Classic never shows the flagship wrapper", () => {
    const { view } = boot(baseState("classic"));
    assert.equal(view.element.querySelector(".dashflag"), null);
  });

  for (const layoutId of ["ledgerfly-forecast", "finexa-budget", "acru-overview"]) {
    test(`${layoutId}: every real card (Balances with its real figure, Settle up, Expenses, Payments) survives inside the flagship wrapper, unchanged`, () => {
      const { view } = boot(baseState(layoutId));
      const flag = view.element.querySelector(".dashflag");
      assert.ok(flag);
      assert.match(flag.textContent, /EUR 42\.50|42\.50/);
      assert.ok(flag.querySelector("[aria-labelledby='grp-balances']"), "the real Balances card is still present");
      assert.ok(flag.querySelector("[aria-labelledby='grp-settle']"), "the real Settle up card is still present");
      assert.ok(flag.querySelector("[aria-labelledby='grp-expenses']"), "the real Expenses card is still present");
      assert.ok(flag.querySelector("[aria-labelledby='grp-payments']"), "the real Payments card is still present");
    });
  }

  test("an unknown/demo-only layoutId falls back to Classic", () => {
    const { view } = boot(baseState("travel-ledger"));
    assert.equal(view.element.querySelector(".dashflag"), null);
    assert.ok(view.element.querySelector("[aria-labelledby='grp-balances']"));
  });

  test("switching layouts keeps rendering correctly (the whole card stack is reparented as one unit, never rebuilt)", () => {
    const state = baseState("classic");
    const { view } = boot(state);
    state.workspaces[0].settingValues.layoutId = "finexa-budget";
    view.update(state);
    assert.ok(view.element.querySelector(".dashflag"));
    assert.ok(view.element.querySelector("[aria-labelledby='grp-balances']"));
  });
});
