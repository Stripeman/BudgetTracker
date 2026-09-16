// BT-004-05 — the Shared expenses view's dropdowns are TaskTracker's command picker: the expense
// dialog (category, split method, own account), Record a payment (from, to, own account), Confirm
// payment and Record on my account (own account). The own-account picker follows its checkbox (the
// view disables it from code); what is chosen through the pickers is what is sent. Fictional names
// only. Layout and screen-reader output are checked in a real browser.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { nativeDropdowns, pickerLabels, pickerNamed, chooseOption, chooseByKeyboard, offeredOptions, triggerFor } from "./pickerassert.js";
import { createView, openGroupExpense, openRecordPayment } from "../js/ui/views/group.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
import { spokenOf } from "./pickerassert.js";
// What a screen reader announces: the field's name, the value and how to use it (a11y review finding 6).
const spoken = (select) => spokenOf(triggerFor(select));
const type = (node, value) => { node.value = value; node.dispatchEvent(new DomEvent("input", { bubbles: true })); };
const labelled = (root, text) => { const label = root.querySelectorAll("label").find((l) => l.textContent === text); return root.querySelector(`#${label.getAttribute("for")}`); };

function groupCtx({ expenses = [], settlements = [] } = {}) {
  const calls = { expenses: [], actions: [] };
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Dinner Club", kind: "group", role: "owner" }],
    preferences: null,
    group: ready({
      currency: "EUR", basis: "Fictional basis.", permissions: { canAdd: true, selfRef: "member:a", role: "owner" },
      participants: [
        { ref: "member:a", name: "Alice", type: "member", self: true, active: true },
        { ref: "member:b", name: "Bob", type: "member", self: false, active: true },
        { ref: "contact:d", name: "Dana", type: "contact", self: false, active: true },
      ],
      expenses, settlements, balances: [],
    }),
    // Only the person's own private accounts are offered for their part (BT-009 review S2).
    accounts: ready({ accounts: [{ id: "acc_cash", name: "Alice Cash", currency: "EUR", status: "open", visibility: "private", ownedBySelf: true, capabilities: ["create"], icon: "wallet" }], totals: [] }),
    categories: ready({ categories: [
      { id: "cat_food", name: "Groceries", color: "#16a34a", icon: null },
      { id: "cat_fun", name: "Outings", color: "#2563eb", icon: "ticket" },
      { id: "cat_pay", name: "Salary", type: "income", color: "#9333ea", icon: null },
    ] }),
  };
  const api = {
    createGroupExpense: async (ws, body) => { calls.expenses.push(body); return { expense: {} }; },
    groupAction: async (ws, action, body) => { calls.actions.push({ action, body }); return {}; },
  };
  const store = { getState: () => state, actions: { write: async (fn) => { await fn("ws_1"); return { ok: true }; }, refreshGroup: async () => {} } };
  return { ctx: { store, api }, state, calls };
}

describe("BT-004-05 shared expenses: the expense dialog", () => {
  test("Category, Split and the own account are pickers; the account picker follows its checkbox", () => {
    const { ctx } = groupCtx();
    const dialog = openGroupExpense(ctx).element;
    assert.deepEqual(nativeDropdowns(dialog), []);
    assert.deepEqual(pickerLabels(dialog), ["Category", "Split", "Account"]);
    assert.equal(spoken(pickerNamed(dialog, "Category")), "Category: No category. Choose.");
    assert.equal(spoken(pickerNamed(dialog, "Split")), "Split: Equally. Choose.");
    assert.deepEqual(offeredOptions(pickerNamed(dialog, "Category")), ["No category", "Groceries", "Outings"], "income categories are not offered");
    const account = pickerNamed(dialog, "Account");
    assert.equal(spoken(account), "Account: Alice Cash (EUR). Choose.");
    assert.equal(triggerFor(account).disabled, true, "off until the person asks to record it on their account");
    labelled(dialog, "Also record my part on my own account").click();
    assert.equal(triggerFor(account).disabled, false, "the view enabled it from code, and the picker followed");
  });

  test("the split method and category chosen through the pickers, and the own account, are what is sent", async () => {
    const { ctx, calls } = groupCtx();
    const dialog = openGroupExpense(ctx).element;
    type(dialog.querySelector('input[placeholder="For example: Dinner at the harbour"]'), "Fictional picnic");
    type(dialog.querySelector('input[placeholder="0.00 or 12.50+3.20"]'), "90.00");
    chooseOption(pickerNamed(dialog, "Split"), "By shares");
    const dana = dialog.querySelectorAll(".split-row").find((r) => r.querySelector(".split-row__share") && r.querySelector("label").textContent.startsWith("Dana"));
    dana.querySelector('input[type="checkbox"]').click();
    type(dialog.querySelector('input[aria-label="Shares for Alice"]'), "1");
    type(dialog.querySelector('input[aria-label="Shares for Bob"]'), "2");
    chooseByKeyboard(pickerNamed(dialog, "Category"), { type: "out" });
    labelled(dialog, "Also record my part on my own account").click();
    buttonNamed(dialog, "Save expense").click();
    await tick();
    assert.equal(calls.expenses.length, 1);
    const { split, categoryId, ledger } = calls.expenses[0];
    assert.deepEqual({ split, categoryId, ledger }, {
      split: { method: "shares", lines: [{ ref: "member:a", value: 1 }, { ref: "member:b", value: 2 }] },
      categoryId: "cat_fun",
      ledger: { accountId: "acc_cash" },
    });
  });
});

describe("BT-004-05 shared expenses: payments", () => {
  test("Record a payment: From and To are people pickers; receiving it offers the repayment; the payment sent is what was chosen", async () => {
    const { ctx, calls } = groupCtx();
    const dialog = openRecordPayment(ctx).element;
    assert.deepEqual(nativeDropdowns(dialog), []);
    assert.deepEqual(pickerLabels(dialog), ["From", "To", "Account"]);
    assert.equal(spoken(pickerNamed(dialog, "From")), "From: Alice (you). Choose.");
    assert.equal(spoken(pickerNamed(dialog, "To")), "To: Bob. Choose.");
    assert.deepEqual(offeredOptions(pickerNamed(dialog, "To")), ["Alice (you)", "Bob", "Dana · contact"]);
    const repayment = labelled(dialog, "Also record it on my account as a repayment").parentNode.parentNode;
    assert.equal(repayment.hidden, true, "paying someone else offers no repayment on my account");
    chooseOption(pickerNamed(dialog, "From"), "Bob");
    chooseOption(pickerNamed(dialog, "To"), "Alice (you)");
    assert.equal(repayment.hidden, false, "receiving it does");
    assert.match(dialog.textContent, /You are recording money you received/);
    dialog.querySelector('input[placeholder="0.00"]').value = "20.00";
    buttonNamed(dialog, "Record payment").click();
    await tick();
    assert.equal(calls.actions.length, 1);
    assert.equal(calls.actions[0].action, "settle");
    assert.deepEqual({ from: calls.actions[0].body.from, to: calls.actions[0].body.to, amount: calls.actions[0].body.amount }, { from: "member:b", to: "member:a", amount: "20.00" });
  });

  test("Confirm payment: the own-account picker waits for its checkbox, and the account chosen is sent", async () => {
    const settlement = { id: "set_1", from: "member:b", to: "member:a", amount: "20.00", currency: "EUR", status: "reported", canConfirm: true, canDispute: true, revision: 1, date: "2026-09-12" };
    const { ctx, state, calls } = groupCtx({ settlements: [settlement] });
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    view.element.querySelectorAll("button").find((b) => b.getAttribute("aria-label") === "Confirm Bob paid you").click();
    const dialog = dom.body.querySelector(".modal");
    assert.deepEqual(nativeDropdowns(dialog), []);
    const account = pickerNamed(dialog, "Account");
    assert.equal(triggerFor(account).disabled, true);
    labelled(dialog, "Also record it on my account as a repayment").click();
    assert.equal(triggerFor(account).disabled, false);
    buttonNamed(dialog, "Confirm").click();
    await tick();
    assert.deepEqual(calls.actions, [{ action: "confirm", body: { settlementId: "set_1", revision: 1, ledger: { accountId: "acc_cash" } } }]);
  });

  test("Record on my account: the account is a picker and the one chosen is sent", async () => {
    const expense = { id: "exp_1", description: "Fictional dinner", date: "2026-09-12", amount: "30.00", currency: "EUR", status: "active",
      payers: [{ ref: "member:a", amount: "30.00" }], shares: [{ ref: "member:a", amount: "15.00" }, { ref: "member:b", amount: "15.00" }], canEdit: false, canVoid: false };
    const { ctx, state, calls } = groupCtx({ expenses: [expense] });
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    view.element.querySelectorAll("button").find((b) => b.getAttribute("aria-label") === "Record Fictional dinner on my account").click();
    const dialog = dom.body.querySelector(".modal");
    assert.deepEqual(nativeDropdowns(dialog), []);
    assert.equal(spoken(pickerNamed(dialog, "Account")), "Account: Alice Cash (EUR). Choose.");
    buttonNamed(dialog, "Record").click();
    await tick();
    assert.deepEqual(calls.actions, [{ action: "ledger", body: { expenseId: "exp_1", accountId: "acc_cash" } }]);
  });
});
