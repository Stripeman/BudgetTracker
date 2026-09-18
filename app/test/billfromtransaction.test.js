// "ADD AS BILL" (Terry, 2026-09-18: "button next to a transaction to add transaction as a bill and
// carry over/refill data from the transaction to bill"). A compact-menu item on each entry opens
// the SAME "Add bill" dialog bills.js already uses, pre-filled from that entry's own account,
// amount, category, merchant, notes and responsible person — never switched into "editing" mode, so
// every field stays exactly as editable as a normal new bill, and what is actually submitted always
// comes from the live form controls (createBody()), never silently from the prefill itself.
// Fictional data only. Real-browser, real-viewport proof (no-reflow, real submission through the
// API) is scripts/dev/e2e/transactions.mjs.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { pickerNamed, triggerFor, spokenOf } from "./pickerassert.js";
import { createView, billPrefillFrom } from "../js/ui/views/transactions.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const rowFor = (root, text) => root.querySelectorAll("tr").find((r) => r.textContent.includes(text));
// BT-015's compact "::" menu: open the row's own toggle before looking for one of its items (same
// mechanism movetransaction.test.js uses).
const openRowMenu = (root, text) => {
  const openToggle = dom.body.querySelectorAll("button.actionsmenu__toggle").find((b) => b.getAttribute("aria-expanded") === "true");
  if (openToggle) openToggle.click();
  const row = rowFor(root, text);
  const toggle = row && row.querySelectorAll("button").find((b) => b.classList.contains("actionsmenu__toggle"));
  if (toggle) toggle.click();
  return row;
};

const ACCOUNTS = [
  { id: "acc_checking", name: "Fictional Checking", currency: "EUR", access: "own", visibility: "private", ownedBySelf: true, status: "open", capabilities: ["view-balances", "view-transactions", "create", "edit", "delete"], icon: "bank" },
  { id: "acc_savings", name: "Fictional Savings", currency: "EUR", access: "own", visibility: "private", ownedBySelf: true, status: "open", capabilities: ["view-balances", "view-transactions", "create", "edit", "delete"], icon: "piggy-bank" },
];
const CATEGORIES = [{ id: "cat_groceries", name: "Groceries", color: "#16a34a", icon: "cart" }];
const PAYEES = [{ id: "pay_grocer", name: "Fictional Grocer", visibility: "shared", status: "active" }];

function txnCtx({ transactions = [] } = {}) {
  const calls = { created: [] };
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner", kind: "household" }],
    preferences: null,
    accounts: ready({ accounts: ACCOUNTS }),
    categories: ready({ categories: CATEGORIES }),
    payees: ready({ payees: PAYEES }),
    transactions: ready({ transactions, summary: [], total: transactions.length, entryKinds: [] }),
  };
  const api = {
    people: async () => ({ options: [{ ref: "member:m_bob", label: "Bob Fictional", type: "member" }] }),
    createBill: async (ws, body) => { calls.created.push(body); return {}; },
  };
  const store = {
    getState: () => state,
    actions: {
      refreshTransactions: async () => {},
      write: async (fn, refresh) => { const result = await fn("ws_1"); return { ok: true, result }; },
    },
  };
  return { ctx: { store, api, params: {} }, state, calls };
}

const BASE_TXN = {
  // A transaction's own amount is SIGNED (money out is negative, per ledger.transactionView /
  // money.toDecimal) — unlike a bill's own amount, which is always an unsigned magnitude.
  id: "txn_1", accountId: "acc_checking", accountName: "Fictional Checking", kind: "expense", amount: "-45.67", amountMinor: -4567, currency: "EUR",
  date: "2026-09-05", postedDate: null, status: "pending", payeeId: "pay_grocer", payeeName: "Fictional Grocer", categoryId: "cat_groceries", splits: [], tags: [],
  notes: "E2E carried notes", responsibleRef: "member:m_bob", responsible: { ref: "member:m_bob", label: "Bob Fictional", type: "member" },
  transferId: null, counterpartAccountId: null, owedPairId: null, paidBySomeoneElse: false, links: {},
  createdAt: "2026-09-05T10:00:00Z", updatedAt: null, revision: 1, amendmentCount: 0, reversedBy: null, createdBySelf: true, deletedAt: null,
  canEdit: true, canDelete: true, canMove: true, moveBlockedReason: null,
};

describe("billPrefillFrom (BT-NEW): what a new bill starts with from an entry", () => {
  test("an expense carries its account, amount, category, merchant, notes, responsible person and date; kind/billType are left at the form's own defaults", () => {
    const p = billPrefillFrom(BASE_TXN);
    assert.deepEqual(p, {
      name: "Fictional Grocer", accountId: "acc_checking", kind: undefined, billType: undefined, toAccountId: undefined,
      amount: "45.67", categoryId: "cat_groceries", payeeId: "pay_grocer", payeeName: "Fictional Grocer",
      notes: "E2E carried notes", responsible: { ref: "member:m_bob", label: "Bob Fictional", type: "member" },
      schedule: { startDate: "2026-09-05" },
    });
  });
  test("income maps onto the bill's own income kind and billType", () => {
    const p = billPrefillFrom({ ...BASE_TXN, kind: "income" });
    assert.equal(p.kind, "income");
    assert.equal(p.billType, "income");
  });
  test("a transfer carries its own account as the bill's account and its counterpart as the To account", () => {
    const p = billPrefillFrom({ ...BASE_TXN, kind: "transfer", counterpartAccountId: "acc_savings", payeeId: null, payeeName: "", categoryId: null });
    assert.equal(p.kind, "transfer");
    assert.equal(p.toAccountId, "acc_savings");
    assert.equal(p.billType, undefined, "billType is left at the form's own default for a transfer, same as for any other non-income kind");
  });
  test("an unrecognized kind (e.g. an adjustment) leaves kind/billType at the form's own defaults, same as expense", () => {
    const p = billPrefillFrom({ ...BASE_TXN, kind: "adjustment" });
    assert.equal(p.kind, undefined);
    assert.equal(p.billType, undefined);
  });
});

describe("BT-NEW: \"Add as bill\" on a transaction's compact actions menu", () => {
  test("opens the SAME Add bill dialog, titled for the entry, with every field pre-filled and still editable", () => {
    const { ctx } = txnCtx({ transactions: [BASE_TXN] });
    (() => { const view = createView(ctx); dom.body.appendChild(view.element); view.update(ctx.store.getState()); })();
    const root = dom.body;
    openRowMenu(root, "Fictional Grocer");
    const addAsBill = buttonNamed(dom.body, "Add as bill");
    assert.ok(addAsBill, "the menu offers \"Add as bill\"");
    addAsBill.click();
    const modal = dom.body.querySelector(".modal");
    assert.ok(modal, "the Add bill dialog opened");
    assert.equal(modal.querySelector("h2").textContent, "New bill from entry");
    assert.equal(spokenOf(triggerFor(pickerNamed(modal, "Account"))), "Account: Fictional Checking (EUR). Choose.");
    assert.equal(spokenOf(triggerFor(pickerNamed(modal, "Direction"))), "Direction: Money out. Choose.");
    assert.equal(spokenOf(triggerFor(pickerNamed(modal, "Category"))), "Category: Groceries. Choose.");
    assert.equal(spokenOf(triggerFor(pickerNamed(modal, "Merchant"))), "Merchant: Fictional Grocer. Search and choose.");
    const amount = modal.querySelector("#" + modal.querySelectorAll("label").find((l) => l.textContent === "Amount").getAttribute("for"));
    assert.equal(amount.value, "45.67");
    // A <textarea>'s seeded content is checked via textContent, not .value: this dom-double, unlike
    // a real browser, does not derive an unedited textarea's .value from its initial text content
    // (the real browser's own "default value" behaviour is proven by scripts/dev/e2e/transactions.mjs).
    const notes = modal.querySelector("#" + modal.querySelectorAll("label").find((l) => l.textContent === "Notes").getAttribute("for"));
    assert.equal(notes.textContent, "E2E carried notes");
    const firstPayment = modal.querySelector("#" + modal.querySelectorAll("label").find((l) => l.textContent === "First payment").getAttribute("for"));
    assert.equal(firstPayment.value, "2026-09-05");
    // Still a genuinely NEW bill, not an edit: the account/direction/schedule fields (locked only
    // while editing an existing bill) stay enabled.
    assert.equal(triggerFor(pickerNamed(modal, "Account")).disabled, false);
    assert.equal(triggerFor(pickerNamed(modal, "Direction")).disabled, false);
  });

  test("submitting sends the values from the live form, not silently from the prefill, and creates a real new bill (never edits the transaction)", async () => {
    const { ctx, calls } = txnCtx({ transactions: [BASE_TXN] });
    (() => { const view = createView(ctx); dom.body.appendChild(view.element); view.update(ctx.store.getState()); })();
    openRowMenu(dom.body, "Fictional Grocer");
    buttonNamed(dom.body, "Add as bill").click();
    const modal = dom.body.querySelector(".modal");
    const name = modal.querySelector("#" + modal.querySelectorAll("label").find((l) => l.textContent === "Name").getAttribute("for"));
    name.value = "Fictional Grocer Rent";
    name.dispatchEvent(new DomEvent("input"));
    const save = buttonNamed(modal, "Add bill");
    save.dispatchEvent(new DomEvent("click"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.created.length, 1);
    assert.equal(calls.created[0].name, "Fictional Grocer Rent", "the typed name is sent, not the merchant name it started from");
    assert.equal(calls.created[0].accountId, "acc_checking");
    assert.equal(calls.created[0].amount, "45.67");
    assert.equal(calls.created[0].categoryId, "cat_groceries");
    assert.equal(calls.created[0].payeeId, "pay_grocer");
    assert.equal(calls.created[0].schedule.startDate, "2026-09-05");
  });

  test("the item is absent when the entry cannot be edited, or when no account can take a new bill", () => {
    const { ctx: viewOnlyCtx } = txnCtx({ transactions: [{ ...BASE_TXN, canEdit: false }] });
    (() => { const view = createView(viewOnlyCtx); dom.body.appendChild(view.element); view.update(viewOnlyCtx.store.getState()); })();
    assert.equal(buttonNamed(dom.body, "Add as bill"), undefined, "no edit right: no menu item");

    dom.teardown();
    dom = installDom();
    const { ctx: noAccountsCtx } = txnCtx({ transactions: [BASE_TXN] });
    noAccountsCtx.store.getState().accounts.data.accounts.forEach((a) => { a.capabilities = a.capabilities.filter((c) => c !== "create"); });
    (() => { const view = createView(noAccountsCtx); dom.body.appendChild(view.element); view.update(noAccountsCtx.store.getState()); })();
    assert.equal(buttonNamed(dom.body, "Add as bill"), undefined, "no account can take a new bill: no menu item");
  });
});
