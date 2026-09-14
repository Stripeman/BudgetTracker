// BT-009 recheck of e747d5e in the browser code (financial recheck N1, N2, N3). Kept in its own file
// so the command-picker work in other files merges cleanly. Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { offeredOptions } from "./pickerassert.js";
import { createView, openQuickEntry } from "../js/ui/views/transactions.js";

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
    const { ctx, state } = txCtx();
    state.transactions.data = { transactions: [OWED], summary: [], total: 1 };
    const view = createView(ctx);
    document.body.appendChild(view.element);
    view.update(state);
    // The DOM double has no descendant selectors; the page's other buttons are not Edit, Reverse or Delete.
    const labels = view.element.querySelectorAll("button").map((b) => b.textContent);
    assert.ok(labels.includes("Edit"), labels.join(", "));
    assert.equal(labels.includes("Reverse"), false);
    assert.equal(labels.includes("Delete"), false);
  });
});
