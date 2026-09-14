// BT-006-05 "Move to another account": row action, eligible destinations (same currency, open, where
// the caller may add entries, excluding the current account), reason pre-filled "Wrong account", a
// plain balance-impact summary, a visibility-change note, and an ineligible entry explained as text
// (not only by leaving the action off). Fictional data only; layout is checked in a real browser.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { chooseOption, offeredOptions, triggerFor, pickerNamed } from "./pickerassert.js";
import { createView } from "../js/ui/views/transactions.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
// Rows are found by their (fictional, unique) merchant name rather than the displayed amount: the
// amount column applies a money arrow and locale grouping, so it never contains a plain "-40.00".
const rowFor = (root, merchant) => root.querySelectorAll("tr").find((r) => r.textContent.includes(merchant));

const ACCOUNTS = [
  { id: "acc_checking", name: "Alice Checking", currency: "EUR", access: "own", visibility: "private", ownedBySelf: true, status: "open", capabilities: ["view-balances", "view-transactions", "create", "edit", "delete"], icon: "bank", balance: "500.00" },
  { id: "acc_wallet", name: "Alice Wallet", currency: "EUR", access: "own", visibility: "private", ownedBySelf: true, status: "open", capabilities: ["view-balances", "view-transactions", "create", "edit", "delete"], icon: "wallet", balance: "200.00" },
  { id: "acc_joint", name: "Fictional Joint", currency: "EUR", access: "shared", visibility: "shared", status: "open", capabilities: ["view-balances", "view-transactions", "create", "edit", "delete"], icon: "bank", balance: "1000.00" },
  { id: "acc_usd", name: "Alice USD", currency: "USD", access: "own", visibility: "private", ownedBySelf: true, status: "open", capabilities: ["view-balances", "view-transactions", "create", "edit", "delete"], balance: "50.00" },
  { id: "acc_closed", name: "Alice Old Bank", currency: "EUR", access: "own", visibility: "private", ownedBySelf: true, status: "closed", capabilities: ["view-balances", "view-transactions", "create", "edit", "delete"], balance: "0.00" },
  { id: "acc_bobcard", name: "Bob Card", currency: "EUR", access: "granted", visibility: "private", ownedBySelf: false, ownerName: "Bob Fictional", status: "open", capabilities: ["view-balances", "view-transactions"], balance: "-250.00" },
];

function moveCtx({ transactions = [] } = {}) {
  const calls = { moved: [], refreshed: [] };
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner", kind: "household" }],
    preferences: null,
    accounts: ready({ accounts: ACCOUNTS }),
    categories: ready({ categories: [] }),
    payees: ready({ payees: [] }),
    transactions: ready({ transactions, summary: [], total: transactions.length, entryKinds: [] }),
  };
  const api = { moveTransaction: async (ws, body) => { calls.moved.push({ ws, body }); return { transactions: [] }; } };
  const store = {
    getState: () => state,
    actions: {
      refreshTransactions: async () => { calls.refreshed.push("transactions"); },
      write: async (fn, refresh = ["accounts", "transactions", "payees"]) => {
        try {
          const result = await fn(state.selectedWorkspaceId);
          calls.refreshed.push(...refresh);
          return { ok: true, result };
        } catch (err) { return { ok: false, error: err }; }
      },
    },
  };
  return { ctx: { store, api, params: {} }, state, calls };
}

const BASE_TXN = {
  id: "txn_1", accountId: "acc_checking", accountName: "Alice Checking", kind: "expense", amount: "-40.00", amountMinor: -4000, currency: "EUR",
  date: "2026-09-14", postedDate: null, status: "pending", payeeId: null, payeeName: "Wrong Account Expense", categoryId: null, splits: [], tags: [], notes: "",
  responsibleRef: null, responsible: null, transferId: null, counterpartAccountId: null, owedPairId: null, paidBySomeoneElse: false, links: {},
  createdAt: "2026-09-14T10:00:00Z", updatedAt: null, revision: 1, amendmentCount: 0, reversedBy: null, createdBySelf: true, deletedAt: null,
  canEdit: true, canDelete: true, canMove: true, moveBlockedReason: null,
};

describe("BT-006-05 the row action", () => {
  test("an eligible entry offers Move to another account; an ineligible-but-editable one explains why, as text", async () => {
    const eligible = { ...BASE_TXN };
    const reconciled = { ...BASE_TXN, id: "txn_2", payeeName: "Reconciled Fictional Expense", status: "reconciled", canMove: false, moveBlockedReason: "This entry is reconciled. Change its status to cleared before moving it." };
    const viewerRow = { ...BASE_TXN, id: "txn_3", payeeName: "Viewer Fictional Expense", canEdit: false, canDelete: false, canMove: false, moveBlockedReason: null };
    const { ctx, state } = moveCtx({ transactions: [eligible, reconciled, viewerRow] });
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    const enabled = buttonNamed(rowFor(view.element, "Wrong Account Expense"), "Move to another account");
    assert.ok(enabled && !enabled.disabled, "the eligible row offers a working Move action");
    const disabled = buttonNamed(rowFor(view.element, "Reconciled Fictional Expense"), "Move to another account");
    assert.ok(disabled && disabled.disabled, "the reconciled row's Move action is present but disabled");
    const tip = disabled.parentNode;
    assert.equal(tip.className, "tip");
    assert.match(tip.getAttribute("data-tip"), /reconciled/i, "a hover tooltip carries the reason");
    const hintId = disabled.getAttribute("aria-describedby");
    const hint = view.element.querySelector(`#${hintId}`);
    assert.ok(hint && /reconciled/i.test(hint.textContent), "a visible (screen-reader) text also carries the reason, not colour alone");
    assert.equal(buttonNamed(rowFor(view.element, "Viewer Fictional Expense"), "Move to another account"), undefined, "no edit right: nothing is offered, like Edit and Delete");
  });
});

describe("BT-006-05 the move dialog", () => {
  test("eligible destinations exclude the current, other-currency, closed and no-create accounts; the reason is pre-filled", () => {
    const { ctx, state } = moveCtx({ transactions: [BASE_TXN] });
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    buttonNamed(rowFor(view.element, "Wrong Account Expense"), "Move to another account").click();
    const root = dom.body.querySelector(".modal");
    assert.ok(root, "the dialog opened");
    assert.deepEqual(offeredOptions(pickerNamed(root, "Move to")), ["Alice Wallet (EUR)", "Fictional Joint (EUR)"]);
    assert.equal(root.querySelector('input[maxlength="200"]').value, "Wrong account");
  });

  test("choosing a destination shows the balance impact and, moving to a shared account, the visibility note", async () => {
    const { ctx, state } = moveCtx({ transactions: [BASE_TXN] });
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    buttonNamed(rowFor(view.element, "Wrong Account Expense"), "Move to another account").click();
    const root = dom.body.querySelector(".modal");
    chooseOption(pickerNamed(root, "Move to"), "Fictional Joint (EUR)");
    await tick();
    // Checking 500.00 − (−40.00) = 540.00; Joint 1,000.00 + (−40.00) = 960.00.
    assert.match(root.textContent, /Alice Checking goes from .*500\.00.* to .*540\.00.*Fictional Joint from .*1,000\.00.* to .*960\.00/s);
    assert.match(root.textContent, /Moving to a shared account makes this entry visible to everyone who can see that account\./);
  });

  test("moving from a shared account to a private one shows the reverse note; a same-owner private move shows none", async () => {
    const sharedTxn = { ...BASE_TXN, id: "txn_s", accountId: "acc_joint", accountName: "Fictional Joint" };
    const { ctx, state } = moveCtx({ transactions: [sharedTxn] });
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    buttonNamed(rowFor(view.element, "Wrong Account Expense"), "Move to another account").click();
    let root = dom.body.querySelector(".modal");
    assert.deepEqual(offeredOptions(pickerNamed(root, "Move to")), ["Alice Checking (EUR)", "Alice Wallet (EUR)"]);
    chooseOption(pickerNamed(root, "Move to"), "Alice Checking (EUR)");
    await tick();
    assert.match(root.textContent, /Moving to your private account makes this entry visible only to you/);
    buttonNamed(root, "Cancel").click();

    const { ctx: ctx2, state: state2 } = moveCtx({ transactions: [BASE_TXN] });
    const view2 = createView(ctx2);
    dom.body.appendChild(view2.element);
    view2.update(state2);
    buttonNamed(rowFor(view2.element, "Wrong Account Expense"), "Move to another account").click();
    root = dom.body.querySelector(".modal");
    chooseOption(pickerNamed(root, "Move to"), "Alice Wallet (EUR)");
    await tick();
    assert.doesNotMatch(root.textContent, /visible/, "private to private, same owner: no visibility change to report");
  });

  test("submitting sends transactionId, revision, toAccountId and the reason, and refreshes accounts and transactions", async () => {
    const { ctx, state, calls } = moveCtx({ transactions: [BASE_TXN] });
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    buttonNamed(rowFor(view.element, "Wrong Account Expense"), "Move to another account").click();
    const root = dom.body.querySelector(".modal");
    chooseOption(pickerNamed(root, "Move to"), "Alice Wallet (EUR)");
    await tick();
    root.querySelector('input[maxlength="200"]').value = "Wrong account, receipt shows the wallet";
    buttonNamed(root, "Move entry").click();
    await tick();
    assert.deepEqual(calls.moved, [{ ws: "ws_1", body: { transactionId: "txn_1", revision: 1, toAccountId: "acc_wallet", reason: "Wrong account, receipt shows the wallet" } }]);
    assert.ok(calls.refreshed.includes("accounts") && calls.refreshed.includes("transactions"), "both accounts (balances) and transactions refresh");
    assert.equal(dom.body.querySelector(".modal"), null, "the dialog closed");
  });

  test("an empty reason is refused without submitting; choosing nothing is refused too", async () => {
    const { ctx, state, calls } = moveCtx({ transactions: [BASE_TXN] });
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    buttonNamed(rowFor(view.element, "Wrong Account Expense"), "Move to another account").click();
    let root = dom.body.querySelector(".modal");
    buttonNamed(root, "Move entry").click();
    await tick();
    assert.equal(calls.moved.length, 0, "no destination chosen: refused before calling the API");
    chooseOption(pickerNamed(root, "Move to"), "Alice Wallet (EUR)");
    await tick();
    root.querySelector('input[maxlength="200"]').value = "";
    root.querySelector('input[maxlength="200"]').dispatchEvent(new DomEvent("input", { bubbles: true }));
    buttonNamed(root, "Move entry").click();
    await tick();
    assert.equal(calls.moved.length, 0, "empty reason: refused before calling the API");
    assert.equal(root.querySelector('input[maxlength="200"]').getAttribute("aria-invalid"), "true");
  });

  test("no eligible destination (only currency mismatch, closed or no-create accounts left) explains itself and disables Move", () => {
    const usdTxn = { ...BASE_TXN, id: "txn_u", accountId: "acc_usd", accountName: "Alice USD", payeeName: "USD Fictional Expense", amount: "-5.00", currency: "USD" };
    const { ctx, state } = moveCtx({ transactions: [usdTxn] });
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    buttonNamed(rowFor(view.element, "USD Fictional Expense"), "Move to another account").click();
    const root = dom.body.querySelector(".modal");
    assert.match(root.textContent, /no other open account in USD/);
    assert.equal(buttonNamed(root, "Move entry").disabled, true);
  });
});
