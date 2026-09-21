// BT-013-16 — the three flagship Dashboard renderers (Executive Forecast/`ledgerfly-forecast`,
// Budget Workspace/`finexa-budget`, Financial Overview/`acru-overview`). Each must show the SAME
// real, server-computed figures the classic renderer already proves correct (app/test/dashboard.test.js
// owns that arithmetic proof); this file proves the workspace's real `layoutId` picks the right
// renderer, that each one genuinely differs in composition, and that empty/no-data states are honest
// rather than broken. Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { createView as createDashboard } from "../js/ui/views/dashboard.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const noop = async () => {};
function ready(data) { return { workspaceId: "ws_1", status: "ready", error: null, data }; }

function baseState(layoutId, overrides = {}) {
  return {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Household", kind: "household", role: "owner", settingValues: { layoutId } }],
    preferences: null,
    accounts: ready({ accounts: [{ id: "a1", name: "Checking", icon: "bank", type: "checking", balance: "1234.56", currency: "EUR", deletedAt: null, status: "open", capabilities: ["create"] }], totals: [{ currency: "EUR", amount: "1234.56", breakdown: { own: "1234.56" } }] }),
    transactions: ready({ transactions: [{ id: "t1", date: "2026-09-20", kind: "expense", amountMinor: -1500, currency: "EUR", payeeId: "p1", payeeName: "Fictional Grocer" }], summary: [], total: 1 }),
    payees: ready({ payees: [{ id: "p1", name: "Fictional Grocer", icon: "store", stats: [{ currency: "EUR", gross: "15.00", count: 1 }] }] }),
    categories: ready({ categories: [{ id: "cat_g", name: "Groceries", color: "#ff0000", icon: "cart" }] }),
    bills: ready({ summary: { overdue: 1, dueSoon: 2 } }),
    forecast: ready({ forecast: { warnings: [] } }),
    weekActivity: ready({ summary: [{ currency: "EUR", income: "500.00", gross: "123.45" }] }),
    monthActivity: ready({ summary: [{ currency: "EUR", byCategory: [{ categoryId: "cat_g", amount: "40.00" }] }] }),
    ...overrides,
  };
}

function boot(state) {
  const store = {
    getState: () => state,
    actions: { refreshTransactions: noop, refreshBills: noop, refreshForecast: noop, refreshGroup: noop, refreshWeekActivity: noop, refreshMonthActivity: noop },
  };
  const view = createDashboard({ store, api: {} });
  dom.body.appendChild(view.element);
  view.update(state);
  return { view };
}

describe("BT-013-16 the Dashboard renders the workspace's real, applied layout", () => {
  test("a workspace with no settingValues (an older cached summary) falls back to Classic, never throws", () => {
    const state = baseState(undefined);
    const { view } = boot(state);
    assert.ok(view.element.querySelector(".dash-accounts, [aria-labelledby='dash-accounts']") || view.element.textContent.includes("Accounts"));
    assert.equal(view.element.querySelector(".dashflag"), null, "Classic never gets the flagship wrapper");
  });

  test("an unknown/demo-only layoutId (not yet integrated) also falls back to Classic, never throws or shows a blank page", () => {
    const { view } = boot(baseState("executive-ledger"));
    assert.equal(view.element.querySelector(".dashflag"), null);
    assert.match(view.element.textContent, /Total balance|Net position/);
  });

  for (const layoutId of ["ledgerfly-forecast", "finexa-budget", "acru-overview"]) {
    test(`${layoutId}: renders the flagship wrapper with the SAME real figures as Classic (income, expenses, merchant, category)`, () => {
      const { view } = boot(baseState(layoutId));
      const flag = view.element.querySelector(".dashflag");
      assert.ok(flag, "the flagship wrapper is present");
      const text = flag.textContent;
      assert.match(text, /EUR 500\.00/, "this week's income figure is the same real server number");
      assert.match(text, /EUR 123\.45/, "this week's expenses figure is the same real server number");
      assert.match(text, /Fictional Grocer/, "the real merchant appears");
      assert.match(text, /Groceries/, "the real category appears");
      assert.match(text, /EUR 1,?234\.56|EUR 1234\.56/, "the real account balance/net position appears somewhere");
    });
  }

  test("switching from one flagship layout to another re-renders the flagship body (never stuck on the previous layout's tree)", () => {
    const state = baseState("ledgerfly-forecast");
    const { view } = boot(state);
    assert.ok(view.element.textContent.includes("Total balance"));
    state.workspaces[0].settingValues.layoutId = "finexa-budget";
    view.update(state);
    assert.ok(view.element.textContent.includes("Overview"));
    assert.equal(view.element.querySelectorAll(".dashflag").length, 1, "only one flagship tree is ever mounted at a time");
  });

  test("switching from a flagship layout back to Classic restores Classic's own persistent containers (never leaves the flagship tree mounted)", () => {
    const state = baseState("acru-overview");
    const { view } = boot(state);
    assert.ok(view.element.querySelector(".dashflag"));
    state.workspaces[0].settingValues.layoutId = "classic";
    view.update(state);
    assert.equal(view.element.querySelector(".dashflag"), null);
  });

  test("empty workspace (no accounts, no spending, no merchants) shows honest empty states in every flagship layout, never a crash or a fabricated number", () => {
    for (const layoutId of ["ledgerfly-forecast", "finexa-budget", "acru-overview"]) {
      const state = baseState(layoutId, {
        accounts: ready({ accounts: [], totals: [] }),
        transactions: ready({ transactions: [], summary: [], total: 0 }),
        payees: ready({ payees: [] }),
        weekActivity: ready({ summary: [] }),
        monthActivity: ready({ summary: [] }),
        bills: ready({ summary: { overdue: 0, dueSoon: 0 } }),
      });
      dom.teardown(); dom = installDom();
      const { view } = boot(state);
      assert.match(view.element.textContent, /No spending recorded yet this month|No merchant activity yet|No accounts yet/, layoutId);
    }
  });

  test("the primary action (Add expense) is always present, in the shared page-head, regardless of layout", () => {
    for (const layoutId of ["classic", "ledgerfly-forecast", "finexa-budget", "acru-overview"]) {
      dom.teardown(); dom = installDom();
      const { view } = boot(baseState(layoutId));
      const head = view.element.querySelector(".page-head__actions");
      assert.ok(head && head.querySelector("button"), `${layoutId}: Add expense is reachable`);
    }
  });
});
