// BT-009 increment 1 review remediation in the browser code (financial review of f3ce009, finding 3;
// security review S2, S5, S6). Kept apart from group.test.js so the command-picker conversion of the
// Shared expenses view merges cleanly. All names and amounts are fictional.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { createView as createGroupView } from "../js/ui/views/group.js";
import { createView as createDashboard } from "../js/ui/views/dashboard.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const row = (ref, net) => ({ ref, net, netMinor: Math.round(Number(net) * 100), paid: "0.00", share: "0.00", paidOut: "0.00", received: "0.00",
  pendingIn: "0.00", pendingOut: "0.00", disputedIn: "0.00", disputedOut: "0.00", expenses: [] });

// A workspace now in USD where Bob still owes Alice (the viewer) EUR 45.00 from before the change.
function ctxWith(balances, { accounts = [], expenses = [], settlements = [], myLedgers = [] } = {}) {
  const participants = [
    { ref: "member:a", name: "Alice", type: "member", self: true, active: true },
    { ref: "member:b", name: "Bob", type: "member", self: false, active: true },
  ];
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Flat", kind: "group", role: "owner" }],
    preferences: null,
    group: { workspaceId: "ws_1", status: "ready", error: null, data: {
      currency: "USD", kind: "group", permissions: { canAdd: true, canManage: true, selfRef: "member:a", role: "owner" },
      participants, expenses, settlements, balances, myLedgers, basis: "Balances count confirmed payments only.",
    } },
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts, totals: [] } },
    categories: { workspaceId: "ws_1", status: "ready", error: null, data: { categories: [] } },
    transactions: { workspaceId: "ws_1", status: "ready", error: null, data: { transactions: [], summary: [], total: 0 } },
    payees: { workspaceId: "ws_1", status: "ready", error: null, data: { payees: [] } },
  };
  const calls = [];
  const api = { groupAction: async (ws, action, body, key) => { calls.push({ action, body, key }); return {}; } };
  const store = {
    getState: () => state,
    actions: {
      write: async (fn) => ({ ok: true, result: await fn("ws_1") }),
      refreshGroup: async () => {}, refreshTransactions: async () => {}, refreshBills: async () => {}, refreshForecast: async () => {},
    },
  };
  return { ctx: { store, api, state }, state, calls };
}

const STRANDED = [
  { currency: "EUR", rows: [row("member:a", "45.00"), row("member:b", "-45.00")], suggestions: [{ from: "member:b", to: "member:a", amount: "45.00", amountMinor: 4500 }], direct: [{ from: "member:b", to: "member:a", amount: "45.00", amountMinor: 4500 }] },
  { currency: "USD", rows: [row("member:a", "0.00"), row("member:b", "0.00")], suggestions: [], direct: [] },
];

describe("finding 3: every currency with an open balance is shown and can be settled", () => {
  test("Shared expenses shows the EUR balance in a USD workspace and does not say everyone is settled up", async () => {
    const { ctx, state, calls } = ctxWith(STRANDED);
    const v = createGroupView(ctx);
    v.update(state);
    const captions = v.element.querySelectorAll("caption").map((c) => c.textContent);
    assert.ok(captions.some((t) => t.startsWith("Balances in EUR")), captions.join(" | "));
    const text = v.element.textContent;
    assert.doesNotMatch(text, /Everyone is settled up/);
    assert.match(text, /Bob pays you/);
    // Recording the suggested EUR payment sends EUR, not the reporting currency.
    const record = v.element.querySelectorAll("button").find((b) => (b.getAttribute("aria-label") || "").startsWith("Record payment of EUR 45.00"));
    assert.ok(record, "a Record payment button for the EUR balance");
    record.click();
    const dialog = document.body.querySelector(".modal");
    assert.match(dialog.textContent, /Amount \(EUR\)/);
    // The amount is preset through the input's value attribute, which a browser shows as its value; the
    // DOM double keeps .value separate, so it is copied over here as a browser would.
    const amount = dialog.querySelector('input[placeholder="0.00"]');
    assert.equal(amount.getAttribute("value"), "45.00");
    amount.value = amount.getAttribute("value");
    buttonNamed(dialog, "Record payment").click();
    await tick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, "settle");
    assert.deepEqual([calls[0].body.from, calls[0].body.to, calls[0].body.amount, calls[0].body.currency], ["member:b", "member:a", "45.00", "EUR"]);
  });

  test("with every currency settled only the reporting currency's table is shown and everyone is settled up", () => {
    const settled = [{ ...STRANDED[0], rows: [row("member:a", "0.00"), row("member:b", "0.00")], suggestions: [], direct: [] }, STRANDED[1]];
    const { ctx, state } = ctxWith(settled);
    const v = createGroupView(ctx);
    v.update(state);
    const captions = v.element.querySelectorAll("caption").map((c) => c.textContent).filter((t) => t.startsWith("Balances in"));
    assert.deepEqual(captions.map((t) => t.slice(0, 15)), ["Balances in USD"]);
    assert.match(v.element.textContent, /Everyone is settled up/);
  });

  test("the dashboard shows the viewer's balance in every currency where it is not zero", () => {
    const { ctx, state } = ctxWith(STRANDED);
    const d = createDashboard(ctx);
    d.update(state);
    const text = d.element.textContent;
    assert.match(text, /You get back EUR 45\.00/);
    assert.doesNotMatch(text, /You are settled up/);
  });
});
