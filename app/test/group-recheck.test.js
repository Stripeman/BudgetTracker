// BT-009 recheck of e747d5e in the browser code (financial recheck N1, N2, N3). Kept in its own file
// so the command-picker work in other files merges cleanly. Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { offeredOptions } from "./pickerassert.js";
import { createView, openQuickEntry, entryAmount, sharedLinked } from "../js/ui/views/transactions.js";
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

  test("when the group allows entering them by hand (Terry's decision C), the server's list adds Owed to others and Repayment made", () => {
    const { ctx, state } = txCtx();
    state.transactions.data = { ...state.transactions.data, entryKinds: ["expense", "income", "transfer", "refund", "fee", "reimbursement", "advance", "adjustment", "interest", "payable", "repayment"] };
    const dialog = openDialog(ctx);
    assert.deepEqual(offeredOptions(entryType(dialog)), ["Expense", "Income", "Transfer", "Refund", "Fee", "Reimbursement received", "Advance (lent)", "Adjustment", "Interest", "Owed to others", "Repayment made"]);
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
    // BT-015: the row's actions are inside a compact "::" menu — open it first (a floating overlay
    // on document.body once open). The DOM double has no descendant selectors; the page's other
    // buttons are not Edit, Reverse or Delete.
    const root = listOf([OWED]);
    root.querySelectorAll("button").find((b) => b.classList.contains("actionsmenu__toggle")).click();
    const labels = document.body.querySelectorAll("button").map((b) => b.textContent);
    assert.ok(labels.includes("Edit"), labels.join(", "));
    assert.equal(labels.includes("Reverse"), false);
    assert.equal(labels.includes("Delete"), false);
  });
});

describe("R3-3: an entry from Shared expenses is locked by its flag, even when its link is not shown", () => {
  test("sharedLinked follows fromSharedExpense when the server leaves the link out", () => {
    assert.equal(sharedLinked({ fromSharedExpense: true, links: {} }), true);
    assert.equal(sharedLinked({ fromSharedExpense: false, links: {} }), false);
    assert.equal(sharedLinked({ links: { groupExpenseId: "gex_x" } }), true);
  });
});

describe("N3: an amount owed shows the no-money-moved mark, never a money arrow", () => {
  test("a payable and its reversal get the no-money-moved mark; repayment, reimbursement and advance keep their arrows", () => {
    assert.equal(directionOf({ kind: "payable", amountMinor: 2500 }), "no-money-moved");
    assert.equal(directionOf({ kind: "payable", amountMinor: -2500, links: { reverses: "txn_x" } }), "no-money-moved");
    assert.equal(directionOf({ kind: "repayment", amountMinor: -2500 }), "money-out");
    assert.equal(directionOf({ kind: "reimbursement", amountMinor: 2500 }), "money-in");
    assert.equal(directionOf({ kind: "advance", amountMinor: -2500 }), "money-out");
    assert.equal(directionOf({ kind: "expense", amountMinor: -2500 }), "money-out");
    assert.equal(directionOf({ kind: "repayment", amountMinor: 2500, links: { reverses: "txn_y" } }), "reversal");
  });

  test("an amount owed shows the no-money-moved mark beside the words No money moved; a repayment keeps its money-out arrow", () => {
    const owed = entryAmount({ kind: "payable", amountMinor: 2500, amount: "25.00", currency: "EUR" }, { effective: {} });
    const marks = owed.querySelectorAll("svg").map((s) => s.getAttribute("data-icon"));
    assert.deepEqual(marks, ["no-money-moved"], "one mark, no arrow");
    assert.match(owed.textContent, /EUR 25\.00/);
    assert.match(owed.textContent, /No money moved/);
    const repaid = entryAmount({ kind: "repayment", amountMinor: -2500, amount: "-25.00", currency: "EUR" }, { effective: {} });
    assert.equal(repaid.querySelector("svg").getAttribute("data-icon"), "money-out");
  });

  test("a share someone else paid gets the no-money-moved mark and the words Paid by someone else; a share one paid oneself keeps its money-out arrow (financial recheck L4)", () => {
    assert.equal(directionOf({ kind: "expense", amountMinor: -8000, paidBySomeoneElse: true }), "no-money-moved");
    assert.equal(directionOf({ kind: "expense", amountMinor: 8000, paidBySomeoneElse: true, links: { reverses: "txn_z" } }), "no-money-moved");
    assert.equal(directionOf({ kind: "expense", amountMinor: -8000, paidBySomeoneElse: false }), "money-out");
    const share = entryAmount({ kind: "expense", amountMinor: -8000, amount: "-80.00", currency: "EUR", paidBySomeoneElse: true }, { effective: {} });
    assert.deepEqual(share.querySelectorAll("svg").map((s) => s.getAttribute("data-icon")), ["no-money-moved"], "one mark, no arrow");
    assert.match(share.textContent, /Paid by someone else/);
    assert.doesNotMatch(share.textContent, /No money moved/);
    const own = entryAmount({ kind: "expense", amountMinor: -8000, amount: "-80.00", currency: "EUR", paidBySomeoneElse: false }, { effective: {} });
    assert.equal(own.querySelector("svg").getAttribute("data-icon"), "money-out");
  });

  test("the Transactions list shows Bob's 80.00 owed with the no-money-moved mark and no money-in arrow", () => {
    const list = listOf([OWED]);
    assert.match(list.textContent, /EUR 80\.00\s*No money moved/);
    const marks = list.querySelectorAll("svg").map((s) => s.getAttribute("data-icon"));
    assert.ok(marks.includes("no-money-moved"), marks.join(", "));
    assert.equal(marks.includes("money-in"), false);
  });
});
