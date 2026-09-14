// BT-004-05 — the Transactions view's dropdowns are TaskTracker's command picker: the four filters and
// the quick-entry form (account, category, type, destination account, status, and the new-merchant
// type). What is chosen through a picker is what the view filters by or saves; suggestions from a
// merchant fill the pickers and their reasons describe the triggers; the reversal lock disables the
// triggers it locks. Fictional data only. Layout and screen-reader output are checked in a browser.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { nativeDropdowns, pickerLabels, pickerNamed, pickerSpokenAs, chooseOption, offeredOptions, triggerFor } from "./pickerassert.js";
import { createView, openQuickEntry } from "../js/ui/views/transactions.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
import { spokenOf } from "./pickerassert.js";
// What a screen reader announces: the field's name, the value and how to use it (a11y review finding 6).
const spoken = (select) => spokenOf(triggerFor(select));
const key = (node, k) => node.dispatchEvent(new DomEvent("keydown", { bubbles: true, key: k }));

function txCtx({ params = {} } = {}) {
  const calls = { refresh: [], created: [], suggest: [] };
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner", kind: "household" }],
    preferences: null,
    accounts: ready({ accounts: [
      { id: "acc_joint", name: "Fictional joint", currency: "EUR", access: "shared", visibility: "shared", status: "open", capabilities: ["create"], icon: "bank" },
      { id: "acc_wallet", name: "Fictional wallet", currency: "EUR", access: "own", visibility: "private", ownedBySelf: true, status: "open", capabilities: ["create"], icon: "wallet" },
    ] }),
    categories: ready({ categories: [
      { id: "cat_food", name: "Groceries", color: "#2563eb", icon: "cart" },
      { id: "cat_fun", name: "Fun", color: "#16a34a", icon: null },
      { id: "cat_old", name: "Old hobby", color: "#9333ea", icon: null, archived: true },
    ] }),
    payees: ready({ payees: [
      { id: "p_bakery", name: "Fictional Bakery", status: "active", visibility: "shared", icon: "store" },
      { id: "p_video", name: "Fictional Video Store", status: "closed", visibility: "shared" },
    ] }),
    transactions: ready({ transactions: [], summary: [], total: 0 }),
  };
  const api = {
    createTransaction: async (ws, body) => { calls.created.push(body); return {}; },
    suggest: async (ws, id) => {
      calls.suggest.push(id);
      return { suggestion: { accountId: "acc_wallet", accountReason: "Your last entry at this merchant.", categoryId: "cat_fun", categoryReason: "Your usual category here.", amount: null, amountReason: "", tags: [] } };
    },
  };
  const store = {
    getState: () => state,
    actions: {
      refreshTransactions: async (filters) => { calls.refresh.push({ ...filters }); },
      write: async (fn) => { await fn("ws_1"); return { ok: true }; },
      refreshPayees: async () => {},
    },
  };
  return { ctx: { store, api, params }, state, calls };
}

describe("BT-004-05 transactions: an empty field reads naturally (UX review U6)", () => {
  test("the transfer's empty To account says “Choose an account…”, not “Choose to account…”", () => {
    const { ctx } = txCtx();
    openQuickEntry(ctx);
    const root = dom.body.querySelector(".modal");
    const to = pickerNamed(root, "To account");
    assert.equal(to.value, "", "nothing chosen yet");
    assert.equal(triggerFor(to).querySelector(".cmdpick__value").textContent, "Choose an account…");
    assert.equal(spoken(to), "To account: Choose an account…. Search and choose.");
  });
});

describe("BT-004-05 transactions: filters", () => {
  test("the filters are pickers with their marks; history keeps closed and archived choices, labelled", () => {
    const { ctx, state } = txCtx();
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    const grid = view.element.querySelector(".filters");
    assert.deepEqual(nativeDropdowns(grid), []);
    assert.deepEqual(pickerLabels(grid), ["Merchant", "Account", "Category", "Status"]);
    assert.equal(spoken(pickerNamed(grid, "Merchant")), "Merchant: Any. Search and choose.");
    assert.equal(spoken(pickerNamed(grid, "Status")), "Status: Any. Choose.");
    assert.deepEqual(offeredOptions(pickerNamed(grid, "Merchant")), ["Any", "Fictional Bakery", "Fictional Video Store (closed)"]);
    assert.deepEqual(offeredOptions(pickerNamed(grid, "Category")), ["Any", "Groceries", "Fun", "Old hobby (archived)"]);
    assert.deepEqual(offeredOptions(pickerNamed(grid, "Account")), ["Any", "Fictional joint", "Fictional wallet"]);
    triggerFor(pickerNamed(grid, "Account")).click();
    const accountRows = dom.body.querySelectorAll(".cmdpick__opt");
    assert.ok(accountRows[1].querySelector("svg") && accountRows[2].querySelector("svg"), "each account shows its icon");
    assert.ok(accountRows[0].querySelector("svg") === null, "Any has none");
  });

  test("a filter chosen through a picker is applied, and Clear filters puts every picker back to Any", async () => {
    const { ctx, state, calls } = txCtx();
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    const grid = view.element.querySelector(".filters");
    chooseOption(pickerNamed(grid, "Category"), "Groceries");
    await tick();
    assert.equal(calls.refresh.at(-1).categoryId, "cat_food");
    assert.equal(spoken(pickerNamed(grid, "Category")), "Category: Groceries. Search and choose.");
    assert.ok(triggerFor(pickerNamed(grid, "Category")).querySelector(".cmdpick__badge").querySelector(".catlabel__icon"), "the chosen category's mark is on the trigger");
    chooseOption(pickerNamed(grid, "Status"), "Cleared");
    await tick();
    assert.deepEqual({ categoryId: calls.refresh.at(-1).categoryId, status: calls.refresh.at(-1).status }, { categoryId: "cat_food", status: "cleared" });
    buttonNamed(view.element, "Clear filters").click();
    await tick();
    assert.equal(spoken(pickerNamed(grid, "Category")), "Category: Any. Search and choose.");
    assert.equal(spoken(pickerNamed(grid, "Status")), "Status: Any. Choose.");
    assert.deepEqual({ categoryId: calls.refresh.at(-1).categoryId, status: calls.refresh.at(-1).status }, { categoryId: undefined, status: undefined });
  });

  test("a merchant's history link from the Merchants page shows in the Merchant picker", () => {
    const { ctx, state } = txCtx({ params: { payeeId: "p_video" } });
    const view = createView(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    assert.equal(spoken(pickerNamed(view.element.querySelector(".filters"), "Merchant")), "Merchant: Fictional Video Store (closed). Search and choose.");
  });
});

describe("BT-004-05 transactions: quick entry", () => {
  test("every dropdown in quick entry is a picker; short lists have no search box", () => {
    const { ctx } = txCtx();
    openQuickEntry(ctx);
    const root = dom.body.querySelector(".modal");
    assert.deepEqual(nativeDropdowns(root), []);
    // The first Type is the new-merchant type (in the hidden "New merchant" box), the second the entry's.
    assert.deepEqual(pickerLabels(root), ["Type", "Account", "Category", "Type", "To account", "Status"]);
    assert.equal(spoken(pickerNamed(root, "Account")), "Account: Fictional joint (EUR). Search and choose.");
    assert.equal(spoken(pickerNamed(root, "Category")), "Category: Uncategorized. Search and choose.");
    assert.equal(spoken(pickerSpokenAs(root, "Type: Expense")), "Type: Expense. Choose.");
    assert.equal(spoken(pickerNamed(root, "Status")), "Status: Pending. Choose.");
    assert.equal(spoken(pickerSpokenAs(root, "Type: Other")), "Type: Other. Search and choose.", "fourteen merchant types");
    assert.deepEqual(offeredOptions(pickerNamed(root, "Category")), ["Uncategorized", "Groceries", "Fun"], "a new entry is not offered an archived category");
  });

  test("a transfer chosen entirely through the pickers is saved exactly", async () => {
    const { ctx, calls } = txCtx();
    openQuickEntry(ctx);
    const root = dom.body.querySelector(".modal");
    const kind = pickerSpokenAs(root, "Type: Expense");
    const to = pickerNamed(root, "To account");
    let box = triggerFor(to);
    while (box && !box.classList.contains("more")) box = box.parentNode;
    // Built hidden through el() (the attribute); the view then toggles the property. The double does
    // not reflect one into the other as a browser does, so each is read where it is set.
    assert.ok(box.hasAttribute("hidden"), "the transfer fields start hidden");
    chooseOption(kind, "Transfer");
    assert.equal(box.hidden, false, "choosing Transfer shows them");
    chooseOption(to, "Fictional wallet (EUR)");
    root.querySelector('input[placeholder="0.00 or 12.50+3.20"]').value = "25";
    buttonNamed(root, "Save expense").click();
    await tick();
    assert.equal(calls.created.length, 1);
    const { accountId, kind: sentKind, amount, transfer, status } = calls.created[0];
    assert.deepEqual({ accountId, kind: sentKind, amount, transfer, status }, { accountId: "acc_joint", kind: "transfer", amount: "25", transfer: { toAccountId: "acc_wallet" }, status: "pending" });
  });

  test("a merchant's suggestions fill the pickers and their reasons describe the triggers; choosing something else removes the reason", async () => {
    const { ctx, calls } = txCtx();
    openQuickEntry(ctx);
    const root = dom.body.querySelector(".modal");
    const merchant = root.querySelector('input[role="combobox"]');
    merchant.value = "bakery";
    merchant.dispatchEvent(new DomEvent("input", { bubbles: true }));
    key(merchant, "ArrowDown");
    key(merchant, "Enter");
    await tick();
    await tick();
    assert.deepEqual(calls.suggest, ["p_bakery"]);
    const category = pickerNamed(root, "Category");
    const account = pickerNamed(root, "Account");
    assert.equal(spoken(category), "Category: Fun. Search and choose.");
    assert.equal(spoken(account), "Account: Fictional wallet (EUR). Search and choose.");
    // The trigger's description is the suggestion's reason, followed by how to use the control (the
    // instructions moved from its name into its description, a11y review finding 6).
    const idsOf = (select) => String(triggerFor(select).getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    const hintOf = (select) => idsOf(select).map((id) => root.querySelector(`#${id}`)).find((n) => n && n.classList.contains("suggestion")) || null;
    const categoryHint = hintOf(category);
    assert.ok(categoryHint, "the trigger is described by the suggestion");
    assert.match(categoryHint.textContent, /Your usual category here\./);
    assert.match(hintOf(account).textContent, /Your last entry at this merchant\./);
    chooseOption(category, "Groceries");
    assert.deepEqual(idsOf(category), [`${triggerFor(category).id}-how`], "the reason no longer applies once the person chose; only how to use it remains");
    assert.equal(categoryHint.hidden, true);
  });

  test("the reversal lock disables the Type and Category triggers; Status stays open", () => {
    const { ctx } = txCtx();
    openQuickEntry(ctx, { transaction: {
      id: "txn_o", revision: 2, accountId: "acc_joint", kind: "expense", amount: "-100.00", currency: "EUR", date: "2026-09-12",
      categoryId: "cat_food", payeeId: null, tags: [], notes: "", status: "pending", reversedBy: "txn_r", links: {},
    } });
    const root = dom.body.querySelector(".modal");
    assert.deepEqual(nativeDropdowns(root), []);
    assert.equal(triggerFor(pickerSpokenAs(root, "Type: Expense")).disabled, true);
    assert.equal(triggerFor(pickerNamed(root, "Category")).disabled, true);
    assert.equal(triggerFor(pickerNamed(root, "Account")).disabled, true, "an entry keeps its account");
    assert.equal(triggerFor(pickerNamed(root, "Status")).disabled, false);
  });
});
