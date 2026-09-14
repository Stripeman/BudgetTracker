// BT-009 recheck of e747d5e in the browser code (financial recheck N1, N2, N3). Kept in its own file
// so the command-picker work in other files merges cleanly. Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { offeredOptions } from "./pickerassert.js";
import { createView, openQuickEntry, entryAmount } from "../js/ui/views/transactions.js";
import { directionOf } from "../js/ui/icons.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

function txCtx() {
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional flat", role: "owner", kind: "group" }],
    preferences: null,
    accounts: ready({ accounts: [
      { id: "acc_wallet", name: "Fictional wallet", currency: "EUR", access: "own", visibility: "private", ownedBySelf: true, status: "open", capabilities: ["create", "edit"], icon: "wallet" },
    ] }),
    categories: ready({ categories: [{ id: "cat_food", name: "Groceries", color: "#2563eb", icon: "cart" }] }),
    payees: ready({ payees: [] }),
    transactions: ready({ transactions: [], summary: [], total: 0 }),
  };
  const calls = [];
  const api = { createTransaction: async (ws, body) => { calls.push(body); return {}; }, updateTransaction: async (ws, body) => { calls.push(body); return {}; } };
  const store = {
    getState: () => state,
    actions: { write: async (fn) => { await fn("ws_1"); return { ok: true }; }, refreshTransactions: async () => {}, refreshPayees: async () => {} },
  };
  return { ctx: { store, api, params: {} }, state, calls };
}
const openDialog = (ctx, options) => { openQuickEntry(ctx, options); return document.body.querySelector(".modal"); };
// The entry's own Type picker (the new-merchant form in the same dialog has a "Type" too).
const entryType = (dialog) => dialog.querySelectorAll("select").find((s) => s.querySelectorAll("option").some((o) => o.textContent === "Expense"));
const listOf = (entries) => {
  const { ctx, state } = txCtx();
  state.transactions.data = { transactions: entries, summary: [], total: entries.length };
  const view = createView(ctx);
  document.body.appendChild(view.element);
  view.update(state);
  return view.element;
};

// Bob's 80.00 owed for Alice's dinner, recorded on his wallet from Shared expenses.
const OWED = {
  id: "txn_owed", accountId: "acc_wallet", accountName: "Fictional wallet", kind: "payable", amountMinor: 8000, amount: "80.00", currency: "EUR",
  date: "2026-09-12", postedDate: null, status: "pending", payeeId: null, payeeName: "", categoryId: null, splits: [], tags: [],
  notes: "Owed to others for shared expense: Fictional dinner", links: { groupExpenseId: "gex_1" }, revision: 1, amendmentCount: 0,
  reversedBy: null, transferId: null, canEdit: true, canDelete: true, responsible: null, responsibleRef: null, original: null,
};

describe("N1: quick entry never offers kinds only Shared expenses make", () => {
  test("the Type choices are an explicit list without Owed to others or Repayment made", () => {
    const { ctx } = txCtx();
    const dialog = openDialog(ctx);
    assert.deepEqual(offeredOptions(entryType(dialog)), ["Expense", "Income", "Transfer", "Refund", "Fee", "Reimbursement received", "Advance (lent)", "Adjustment", "Interest"]);
  });
});

describe("N2: entries recorded from Shared expenses are locked on the Transactions page", () => {
  test("the edit form locks amount, type and date and says to change them in Shared expenses", () => {
    const { ctx } = txCtx();
    const dialog = openDialog(ctx, { transaction: OWED });
    assert.match(dialog.textContent, /follow the shared expense\. Change it in Shared expenses/);
    assert.equal(dialog.querySelector('input[placeholder="0.00 or 12.50+3.20"]').hasAttribute("disabled"), true, "amount");
    assert.equal(dialog.querySelector('input[type="date"]').hasAttribute("disabled"), true, "date");
    assert.equal(entryType(dialog).hasAttribute("disabled"), true, "type");
  });

  test("the list offers Edit but no Reverse or Delete for them", () => {
    // The DOM double has no descendant selectors; the page's other buttons are not Edit, Reverse or Delete.
    const labels = listOf([OWED]).querySelectorAll("button").map((b) => b.textContent);
    assert.ok(labels.includes("Edit"), labels.join(", "));
    assert.equal(labels.includes("Reverse"), false);
    assert.equal(labels.includes("Delete"), false);
  });
});

describe("N3: an amount owed shows no money arrow, because no money moved", () => {
  test("a payable and its reversal have no direction; repayment, reimbursement and advance keep theirs", () => {
    assert.equal(directionOf({ kind: "payable", amountMinor: 2500 }), "none");
    assert.equal(directionOf({ kind: "payable", amountMinor: -2500, links: { reverses: "txn_x" } }), "none");
    assert.equal(directionOf({ kind: "repayment", amountMinor: -2500 }), "money-out");
    assert.equal(directionOf({ kind: "reimbursement", amountMinor: 2500 }), "money-in");
    assert.equal(directionOf({ kind: "advance", amountMinor: -2500 }), "money-out");
    assert.equal(directionOf({ kind: "expense", amountMinor: -2500 }), "money-out");
    assert.equal(directionOf({ kind: "repayment", amountMinor: 2500, links: { reverses: "txn_y" } }), "reversal");
  });

  test("an amount owed says No money moved beside it, with no arrow; a repayment keeps its money-out arrow", () => {
    const owed = entryAmount({ kind: "payable", amountMinor: 2500, amount: "25.00", currency: "EUR" }, { effective: {} });
    assert.ok(owed.querySelector("svg") === null, "no arrow");
    assert.match(owed.textContent, /EUR 25\.00/);
    assert.match(owed.textContent, /No money moved/);
    const repaid = entryAmount({ kind: "repayment", amountMinor: -2500, amount: "-25.00", currency: "EUR" }, { effective: {} });
    assert.equal(repaid.querySelector("svg").getAttribute("data-icon"), "money-out");
  });

  test("the Transactions list shows Bob's 80.00 owed without a money-in arrow", () => {
    const list = listOf([OWED]);
    assert.match(list.textContent, /EUR 80\.00\s*No money moved/);
    assert.equal(list.querySelectorAll("svg").filter((s) => s.getAttribute("data-icon") === "money-in").length, 0);
  });
});
