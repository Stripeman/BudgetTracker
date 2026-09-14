// BT-009 recheck of e747d5e in the browser code (financial recheck N1, N2, N3). Kept in its own file
// so the command-picker work in other files merges cleanly. Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { offeredOptions } from "./pickerassert.js";
import { openQuickEntry } from "../js/ui/views/transactions.js";

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

describe("N1: quick entry never offers kinds only Shared expenses make", () => {
  test("the Type choices are an explicit list without Owed to others or Repayment made", () => {
    const { ctx } = txCtx();
    const dialog = openDialog(ctx);
    assert.deepEqual(offeredOptions(entryType(dialog)), ["Expense", "Income", "Transfer", "Refund", "Fee", "Reimbursement received", "Advance (lent)", "Adjustment", "Interest"]);
  });
});
