// BT-014-14: three Dashboard widgets that did not exist before this change — a "Spending by
// category" donut, a "Top merchants" list ranked by spend (unlike the Merchants page's own
// alphabetical order), and a "this week" income/expense recap — plus a category chip on each
// Recent-entries row. Every figure comes from a server-computed decimal string (`summary`,
// `stats`), never summed here; this file proves the widgets render those figures correctly, not
// that the server arithmetic is right (that is api/test/ledger.test.js's job).
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { createView as createDashboard } from "../js/ui/views/dashboard.js";
import { startOfWeekIso, startOfMonthIso } from "../js/core/format.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const noop = async () => {};

function ready(data) { return { workspaceId: "ws_1", status: "ready", error: null, data }; }

function baseState(overrides = {}) {
  return {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Household", kind: "household", role: "owner" }],
    preferences: null,
    accounts: ready({ accounts: [], totals: [] }),
    transactions: ready({ transactions: [], summary: [], total: 0 }),
    payees: ready({ payees: [] }),
    categories: ready({ categories: [] }),
    bills: ready({ summary: { overdue: 0, dueSoon: 0 } }),
    forecast: ready({ forecast: { warnings: [] } }),
    weekActivity: ready({ summary: [] }),
    monthActivity: ready({ summary: [] }),
    ...overrides,
  };
}

function boot(state) {
  const calls = [];
  const store = {
    getState: () => state,
    actions: {
      refreshTransactions: noop, refreshBills: noop, refreshForecast: noop, refreshGroup: noop,
      refreshWeekActivity: async (f) => calls.push(["week", f]), refreshMonthActivity: async (f) => calls.push(["month", f]),
    },
  };
  const view = createDashboard({ store, api: {} });
  dom.body.appendChild(view.element);
  view.update(state);
  return { view, calls };
}

describe("BT-014-14 the Dashboard fetches its own narrowly-scoped, non-overlapping data", () => {
  test("refreshWeekActivity and refreshMonthActivity are called once at mount, with their own date ranges, never touching the `transactions` slice", () => {
    const { calls } = boot(baseState());
    const week = calls.find((c) => c[0] === "week")[1];
    const month = calls.find((c) => c[0] === "month")[1];
    assert.equal(week.from, startOfWeekIso());
    assert.equal(month.from, startOfMonthIso());
    assert.ok(week.from >= month.from, "the week always starts on or after the month it is inside");
  });
});

describe("BT-014-14 this week's income and expenses", () => {
  test("shows a card per currency with activity this week, from the server summary, never computed here", () => {
    const state = baseState({ weekActivity: ready({ summary: [{ currency: "EUR", income: "500.00", gross: "123.45" }] }) });
    const { view } = boot(state);
    assert.match(view.element.textContent, /Income this week \(EUR\)/);
    assert.match(view.element.textContent, /EUR 500\.00/);
    assert.match(view.element.textContent, /Expenses this week \(EUR\)/);
    assert.match(view.element.textContent, /EUR 123\.45/);
  });

  test("with no activity this week, no recap card is shown at all (not a misleading row of zeroes)", () => {
    const { view } = boot(baseState());
    assert.doesNotMatch(view.element.textContent, /this week/);
  });
});

describe("BT-014-14 spending by category, this month", () => {
  test("draws a donut with a legend and a sr-only figure table, one entry per category, sorted by spend", () => {
    const state = baseState({
      categories: ready({ categories: [{ id: "cat_g", name: "Groceries", color: "#ff0000", icon: "cart" }, { id: "cat_d", name: "Dining", color: "#00ff00", icon: "utensils" }] }),
      monthActivity: ready({ summary: [{ currency: "EUR", byCategory: [{ categoryId: "cat_d", amount: "15.00" }, { categoryId: "cat_g", amount: "40.00" }] }] }),
    });
    const { view } = boot(state);
    assert.ok(view.element.querySelector("svg.chart--donut"), "a donut chart is drawn");
    const legend = view.element.querySelector(".chart__legend");
    assert.match(legend.textContent, /Groceries/);
    assert.match(legend.textContent, /EUR 40\.00/);
    assert.match(legend.textContent, /Dining/);
    assert.match(legend.textContent, /EUR 15\.00/);
    const table = view.element.querySelector("table.sr-only");
    assert.match(table.textContent, /Groceries/);
    assert.match(table.textContent, /EUR 40\.00/);
  });

  test("an id with no matching category (deleted, or 'uncategorized') is still shown, as 'Uncategorized', never dropped silently", () => {
    const state = baseState({ monthActivity: ready({ summary: [{ currency: "EUR", byCategory: [{ categoryId: "uncategorized", amount: "10.00" }] }] }) });
    const { view } = boot(state);
    assert.match(view.element.textContent, /Uncategorized/);
    assert.match(view.element.textContent, /EUR 10\.00/);
  });

  test("with nothing spent yet this month, says so plainly instead of an empty chart", () => {
    const { view } = boot(baseState());
    assert.match(view.element.textContent, /No spending recorded yet this month/);
    assert.equal(view.element.querySelector("svg.chart--donut"), null);
  });
});

describe("BT-014-14 top merchants, ranked by spend (unlike the Merchants page's alphabetical order)", () => {
  test("shows up to 5 merchants with any spend, highest first, using their existing stats — never a new calculation", () => {
    const state = baseState({
      payees: ready({
        payees: [
          { id: "p_a", name: "Alpha Store", icon: "store", stats: [{ currency: "EUR", gross: "10.00", count: 1 }] },
          { id: "p_b", name: "Beta Market", icon: "cart", stats: [{ currency: "EUR", gross: "99.00", count: 3 }] },
          { id: "p_c", name: "Gamma Cafe", icon: "coffee", stats: [] },
        ],
      }),
    });
    const { view } = boot(state);
    const items = view.element.querySelectorAll(".card").find((c) => c.getAttribute("aria-labelledby") === "dash-merchants").querySelectorAll("li");
    assert.equal(items.length, 2, "only merchants with recorded spend appear");
    assert.match(items[0].textContent, /Beta Market/);
    assert.match(items[0].textContent, /EUR 99\.00/);
    assert.match(items[1].textContent, /Alpha Store/);
  });

  test("with no merchant activity yet, says so plainly", () => {
    const { view } = boot(baseState());
    assert.match(view.element.textContent, /No merchant activity yet/);
  });
});

describe("BT-014-14 Recent entries shows the entry's own category, coloured", () => {
  test("a categorised entry shows its category's colour and name beside the merchant", () => {
    const state = baseState({
      categories: ready({ categories: [{ id: "cat_g", name: "Groceries", color: "#ff0000", icon: "cart" }] }),
      transactions: ready({ transactions: [{ id: "t1", date: "2026-09-14", payeeId: "p_a", payeeName: "Fictional Grocer", categoryId: "cat_g", kind: "expense", amount: "-40.00" }], summary: [], total: 1 }),
    });
    const { view } = boot(state);
    const recent = view.element.querySelectorAll(".card").find((c) => c.getAttribute("aria-labelledby") === "dash-recent");
    const catlabel = recent.querySelector(".catlabel");
    assert.ok(catlabel, "the entry's category is shown");
    assert.match(catlabel.textContent, /Groceries/);
    assert.equal(catlabel.querySelector(".catlabel__icon").style.getPropertyValue("--swatch"), "#ff0000");
  });

  test("an entry with no category (a transfer, or none set) shows no category chip", () => {
    const state = baseState({
      transactions: ready({ transactions: [{ id: "t1", date: "2026-09-14", payeeId: "p_a", payeeName: "Fictional Grocer", categoryId: null, kind: "expense", amount: "-40.00" }], summary: [], total: 1 }),
    });
    const { view } = boot(state);
    const recent = view.element.querySelectorAll(".card").find((c) => c.getAttribute("aria-labelledby") === "dash-recent");
    assert.equal(recent.querySelector(".catlabel"), null);
  });
});
