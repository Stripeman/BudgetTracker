// BT-004-05 — the Planning view's dropdowns are TaskTracker's command picker: the forecast's "Look
// ahead", the budget editor (who it is for, currency, period, each line's category) and the what-if
// card (change, account, bill). Focus lands on a new budget line's category picker; options the view
// fills from code show in the pickers; what is chosen is what is sent. Fictional data only. Layout and
// screen-reader output are checked in a real browser.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { nativeDropdowns, pickerLabels, pickerNamed, chooseOption, offeredOptions, triggerFor } from "./pickerassert.js";
import { createView } from "../js/ui/views/planning.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
import { spokenOf } from "./pickerassert.js";
// What a screen reader announces: the field's name, the value and how to use it (a11y review finding 6).
const spoken = (select) => spokenOf(triggerFor(select));
const fieldOf = (select) => { let n = triggerFor(select); while (n && !(n.classList && n.classList.contains("field"))) n = n.parentNode; return n; };

function planningCtx() {
  const calls = { forecast: [], budgets: [], scenarios: [] };
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner", kind: "household" }],
    preferences: null,
    accounts: ready({ accounts: [{ id: "acc_joint", name: "Fictional joint", currency: "EUR", access: "shared", status: "open", capabilities: ["create"], icon: "bank", balance: "1200.00" }] }),
    categories: ready({ categories: [
      { id: "cat_home", name: "Housing", color: "#2563eb", icon: "home" },
      { id: "cat_food", name: "Groceries", color: "#16a34a", icon: null },
      { id: "cat_pay", name: "Salary", type: "income", color: "#9333ea", icon: null },
    ] }),
    budgets: ready({ budgets: [] }),
    forecast: ready({ forecast: { accounts: [], warnings: [], assumptions: [], horizonDays: 90 } }),
    bills: ready({ recurring: [{ id: "bill_rent", name: "Fictional rent", amount: "950.00", currency: "EUR", ended: false }] }),
  };
  const api = {
    createBudget: async (ws, body) => { calls.budgets.push(body); return {}; },
    scenario: async (ws, body) => { calls.scenarios.push(body); return { forecast: { accounts: [], warnings: [] } }; },
  };
  const store = {
    getState: () => state,
    actions: {
      refreshForecast: async (params) => { calls.forecast.push({ ...params }); },
      refreshBudgets: async () => {},
      refreshBills: async () => {},
      write: async (fn) => { await fn("ws_1"); return { ok: true }; },
    },
  };
  return { ctx: { store, api }, state, calls };
}

function openPlanning() {
  const { ctx, state, calls } = planningCtx();
  const view = createView(ctx);
  dom.body.appendChild(view.element);
  view.update(state);
  return { view, state, calls };
}

describe("BT-004-05 planning: the page", () => {
  test("Look ahead and the what-if choices are pickers; Look ahead refreshes the forecast with the horizon chosen", () => {
    const { view, calls } = openPlanning();
    assert.deepEqual(nativeDropdowns(view.element), []);
    assert.deepEqual(pickerLabels(view.element), ["Look ahead", "Change", "Account", "Bill"]);
    assert.equal(spoken(pickerNamed(view.element, "Look ahead")), "Look ahead: 90 days. Choose.");
    chooseOption(pickerNamed(view.element, "Look ahead"), "12 months");
    assert.equal(calls.forecast.at(-1).horizon, "365");
  });

  test("what-if: accounts and bills filled from code are offered, Change shows the right fields, and the scenario sent is what was chosen", async () => {
    const { view, calls } = openPlanning();
    const change = pickerNamed(view.element, "Change");
    const account = pickerNamed(view.element, "Account");
    const bill = pickerNamed(view.element, "Bill");
    assert.equal(spoken(change), "Change: Add a one-off amount. Choose.");
    assert.deepEqual(offeredOptions(account), ["Fictional joint (EUR)"], "filled after the view received its data");
    assert.deepEqual(offeredOptions(bill), ["Fictional rent (950.00 EUR)"]);
    assert.equal(fieldOf(account).hidden, false);
    assert.equal(fieldOf(bill).hidden, true);
    chooseOption(change, "Leave out a bill");
    assert.equal(fieldOf(account).hidden, true, "a one-off's account leaves");
    assert.equal(fieldOf(bill).hidden, false, "the bill arrives");
    chooseOption(bill, "Fictional rent (950.00 EUR)");
    buttonNamed(view.element, "Add change").click();
    buttonNamed(view.element, "Run what-if").click();
    await tick();
    assert.equal(calls.scenarios.length, 1);
    assert.deepEqual(calls.scenarios[0].changes, [{ type: "exclude-recurring", recurringId: "bill_rent" }]);
  });
});

describe("BT-004-05 planning: the budget editor", () => {
  test("its dropdowns are pickers; adding a line puts focus on that line's category picker; the budget is saved as chosen", async () => {
    const { view, calls } = openPlanning();
    buttonNamed(view.element, "Add budget").click();
    const root = dom.body.querySelector(".modal");
    assert.deepEqual(nativeDropdowns(root), []);
    assert.deepEqual(pickerLabels(root), ["Who it is for", "Currency", "Period", "Category"]);
    assert.equal(spoken(pickerNamed(root, "Who it is for")), "Who it is for: Shared (shared accounts only). Choose.");
    assert.equal(spoken(pickerNamed(root, "Currency")), "Currency: EUR. Choose.");
    assert.equal(spoken(pickerNamed(root, "Period")), "Period: Monthly. Choose.");
    assert.equal(spoken(pickerNamed(root, "Category")), "Category: Housing. Choose.");
    assert.deepEqual(offeredOptions(pickerNamed(root, "Category")), ["Housing", "Groceries"], "income categories are not budgeted");
    buttonNamed(root, "Add a category").click();
    const lines = root.querySelectorAll("fieldset.budget-line");
    assert.equal(lines.length, 2);
    const second = lines[1].querySelector("select");
    assert.ok(document.activeElement === triggerFor(second), "focus is on the new line's category picker");
    chooseOption(second, "Groceries");
    chooseOption(pickerNamed(root, "Period"), "Every 2 weeks");
    root.querySelector('input[maxlength="80"]').value = "Fictional monthly plan";
    lines[0].querySelector('input[inputmode="decimal"]').value = "900.00";
    lines[1].querySelector('input[inputmode="decimal"]').value = "300.00";
    buttonNamed(root, "Add budget").click();
    await tick();
    assert.equal(calls.budgets.length, 1);
    const { name, scope, currency, period, lines: sent } = calls.budgets[0];
    assert.deepEqual({ name, scope, currency, period, lines: sent }, {
      name: "Fictional monthly plan", scope: "shared", currency: "EUR", period: "biweekly",
      lines: [{ categoryId: "cat_home", amount: "900.00", rollover: false }, { categoryId: "cat_food", amount: "300.00", rollover: false }],
    });
  });
});
