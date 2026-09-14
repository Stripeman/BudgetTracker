// BT-009 increment 1 review remediation in the browser code (financial review of f3ce009, finding 3;
// security review S2, S5, S6). Kept apart from group.test.js so the command-picker conversion of the
// Shared expenses view merges cleanly. All names and amounts are fictional.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { createView as createGroupView, openGroupExpense } from "../js/ui/views/group.js";
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
  const api = {
    groupAction: async (ws, action, body, key) => { calls.push({ action, body, key }); return {}; },
    createGroupExpense: async (ws, body, key) => { calls.push({ action: "create", body, key }); return { expense: {} }; },
  };
  const store = {
    getState: () => state,
    actions: {
      write: async (fn, refresh) => { const result = await fn("ws_1"); calls.refresh = refresh; return { ok: true, result }; },
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

describe("S5 and S6: how a payment's confirmation is shown", () => {
  const payment = (extra) => ({ id: "gst_1", from: "member:b", to: "member:a", amount: "20.00", amountMinor: 2000, currency: "USD", date: "2026-09-12", method: "",
    notes: "", status: "confirmed", voided: false, voidReason: "", disputeReason: "", confirmedByReporter: false, withdrawn: false,
    canConfirm: false, canDispute: false, canVoid: false, revision: 2, ...extra });

  test("a confirmation by the person who reported the payment is said so", () => {
    const { ctx, state } = ctxWith(STRANDED, { settlements: [payment({ confirmedByReporter: true })] });
    const v = createGroupView(ctx);
    v.update(state);
    assert.match(v.element.textContent, /Confirmed by the person who reported it\./);
  });

  test("a withdrawn confirmation says so with its reason, not only that it was voided", () => {
    const { ctx, state } = ctxWith(STRANDED, { settlements: [payment({ voided: true, withdrawn: true, voidReason: "The transfer bounced" })] });
    const v = createGroupView(ctx);
    v.update(state);
    assert.match(v.element.textContent, /Confirmation withdrawn: The transfer bounced/);
  });
});

describe("S2 and finding 2: the own-account choice", () => {
  const OWN = { id: "acc_own", name: "Alice Cash", currency: "USD", status: "open", visibility: "private", ownedBySelf: true, capabilities: ["create", "view-transactions"] };
  const JOINT = { id: "acc_joint", name: "Joint", currency: "USD", status: "open", visibility: "shared", ownedBySelf: false, capabilities: ["create", "view-transactions"] };
  const GRANTED = { id: "acc_granted", name: "Bob Card", currency: "USD", status: "open", visibility: "private", ownedBySelf: false, capabilities: ["create", "view-transactions"] };
  const ownFieldset = (dialog) => dialog.querySelectorAll("fieldset").find((f) => f.querySelector("legend") && f.querySelector("legend").textContent === "Your own account (optional)");
  const choiceLabel = (dialog) => dialog.querySelectorAll("label").find((l) => l.textContent === "Also record my part on my own account");

  test("only the viewer's own private accounts are offered, never a shared or granted one", () => {
    const { ctx } = ctxWith(STRANDED, { accounts: [JOINT, OWN, GRANTED] });
    const dialog = openGroupExpense(ctx).element;
    const fs = ownFieldset(dialog);
    assert.equal(fs.hidden, false, "Alice pays and shares by default");
    assert.deepEqual(fs.querySelector("select").querySelectorAll("option").map((o) => o.textContent), ["Alice Cash (USD)"]);
  });

  test("without an own private account the dialog says how to add one, and offers no account", () => {
    const { ctx } = ctxWith(STRANDED, { accounts: [JOINT, GRANTED] });
    const dialog = openGroupExpense(ctx).element;
    const fs = ownFieldset(dialog);
    assert.equal(fs.hidden, false);
    assert.match(fs.textContent, /Add a private account of your own on the Accounts page to record this there\./);
    assert.equal(choiceLabel(dialog).parentNode.parentNode.hidden, true, "no checkbox or account list");
  });

  test("once the viewer's part is recorded on an account, the dialog says where and offers no second choice", async () => {
    const { ctx, calls } = ctxWith(STRANDED, { accounts: [OWN], myLedgers: [{ currency: "USD", accountId: OWN.id, accountName: "Alice Cash", accountUnavailable: false, reviewCount: 0 }] });
    const dialog = openGroupExpense(ctx).element;
    const fs = ownFieldset(dialog);
    assert.match(fs.textContent, /Your part is recorded on Alice Cash, with your other shared expenses in USD\./);
    assert.equal(choiceLabel(dialog).parentNode.parentNode.hidden, true);
    dialog.querySelector('input[placeholder="For example: Dinner at the harbour"]').value = "Fictional lunch";
    dialog.querySelector('input[placeholder="0.00 or 12.50+3.20"]').value = "30.00";
    buttonNamed(dialog, "Save expense").click();
    await tick();
    assert.equal(calls[0].body.ledger, undefined, "the server follows the existing link");
    // The viewer's own account changes too, so it is re-read.
    assert.deepEqual(calls.refresh, ["group", "accounts", "transactions"]);
  });
});
