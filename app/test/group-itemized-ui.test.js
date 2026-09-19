// BT-009-25 — itemized receipt allocation, in the browser code: the "Itemize a receipt…" dialog,
// adding item lines with quantities and shared allocation, tax/tip/discount/fee, the live
// reconciling preview, and the real create/correct body sent to the server. All names are fictional.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { createView as createGroupView, openItemizedExpenseModal } from "../js/ui/views/group.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const type = (node, value) => { node.value = value; node.dispatchEvent(new DomEvent("input", { bubbles: true })); };

function ctxWith({ expenses = [] } = {}) {
  const participants = [
    { ref: "member:a", name: "Alice", type: "member", self: true, active: true },
    { ref: "member:b", name: "Bob", type: "member", self: false, active: true },
    { ref: "member:c", name: "Carol", type: "member", self: false, active: true },
  ];
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Trip Club", kind: "group", role: "owner" }],
    preferences: null,
    group: { workspaceId: "ws_1", status: "ready", error: null, data: {
      currency: "EUR", kind: "group", permissions: { canAdd: true, canManage: true, selfRef: "member:a", role: "owner" },
      participants, expenses, settlements: [], balances: [{ currency: "EUR", rows: [], suggestions: [], direct: [], unitSuggestions: [] }],
      basis: "Balances count confirmed payments only.", events: [], defaultEventId: null,
      eventAccessNote: "Events organize expenses and payments; they do not change who can see them.",
      settlementUnits: [],
    } },
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts: [], totals: [] } },
    categories: { workspaceId: "ws_1", status: "ready", error: null, data: { categories: [] } },
    transactions: { workspaceId: "ws_1", status: "ready", error: null, data: { transactions: [], summary: [], total: 0 } },
    payees: { workspaceId: "ws_1", status: "ready", error: null, data: { payees: [] } },
  };
  const calls = [];
  const api = {
    createGroupExpense: async (ws, body) => { calls.push({ kind: "create-expense", body }); return { expense: {} }; },
    updateGroupExpense: async (ws, body) => { calls.push({ kind: "update-expense", body }); return { expense: {} }; },
  };
  const store = {
    getState: () => state,
    actions: {
      write: async (fn) => { const result = await fn("ws_1"); return { ok: true, result }; },
      refreshGroup: async () => {},
    },
  };
  return { ctx: { store, api }, state, calls };
}

describe("BT-009-25 itemized receipt allocation: the dialog", () => {
  test("the worked example from docs/BT-009-25-WORKED-EXAMPLES.md §2: Burger(Alice)+Salad(Bob)+shared appetizer, tax/tip/discount, reconciles live and sends the exact itemization", async () => {
    const { ctx, calls } = ctxWith();
    const modal = openItemizedExpenseModal(ctx);
    const dialog = modal.element;
    type(dialog.querySelector('input[placeholder="For example: Grocery run"]'), "Fictional dinner receipt");
    type(dialog.querySelector('input[placeholder="0.00"]'), "35.40");
    // First (default) line: Burger, Alice only.
    const firstCard = dialog.querySelectorAll('.item-line')[0];
    type(firstCard.querySelector('input[placeholder="Item"]'), "Burger");
    type(firstCard.querySelector('input[placeholder="1"]'), "1");
    type(firstCard.querySelector('input[placeholder="0.00"]'), "12.00");
    // Alice is checked by default (the payer); leave it.
    buttonNamed(dialog, "Add item line").click();
    const secondCard = dialog.querySelectorAll('.item-line')[1];
    type(secondCard.querySelector('input[placeholder="Item"]'), "Salad");
    type(secondCard.querySelector('input[placeholder="1"]'), "1");
    type(secondCard.querySelector('input[placeholder="0.00"]'), "10.00");
    // Uncheck Alice, check Bob only, on the Salad line.
    const secondBoxes = secondCard.querySelectorAll('input[type="checkbox"]');
    secondBoxes[0].checked = false; secondBoxes[0].dispatchEvent(new DomEvent("change", { bubbles: true }));
    secondBoxes[1].checked = true; secondBoxes[1].dispatchEvent(new DomEvent("change", { bubbles: true }));
    buttonNamed(dialog, "Add item line").click();
    const thirdCard = dialog.querySelectorAll('.item-line')[2];
    type(thirdCard.querySelector('input[placeholder="Item"]'), "Shared appetizer");
    type(thirdCard.querySelector('input[placeholder="1"]'), "1");
    type(thirdCard.querySelector('input[placeholder="0.00"]'), "8.00");
    const thirdBoxes = thirdCard.querySelectorAll('input[type="checkbox"]');
    thirdBoxes[1].checked = true; thirdBoxes[1].dispatchEvent(new DomEvent("change", { bubbles: true })); // Bob
    thirdBoxes[2].checked = true; thirdBoxes[2].dispatchEvent(new DomEvent("change", { bubbles: true })); // Carol
    // Tax/Tip/Discount.
    const feeInputs = dialog.querySelector(".itemized-fees").querySelectorAll("input");
    type(feeInputs[0], "2.40"); type(feeInputs[1], "6.00"); type(feeInputs[2], "3.00");
    assert.match(dialog.textContent, /Reconciles exactly to 35\.40 EUR/);
    buttonNamed(dialog, "Save expense").click();
    await tick();
    const created = calls.find((c) => c.kind === "create-expense");
    assert.equal(created.body.amount, "35.40");
    assert.equal(created.body.itemization.lines.length, 3);
    assert.equal(created.body.itemization.taxMinor, 240);
    assert.equal(created.body.itemization.tipMinor, 600);
    assert.equal(created.body.itemization.discountMinor, 300);
  });

  test("an unallocated remainder is shown live, and Save is refused until it reconciles", async () => {
    const { ctx, calls } = ctxWith();
    const modal = openItemizedExpenseModal(ctx);
    const dialog = modal.element;
    type(dialog.querySelector('input[placeholder="For example: Grocery run"]'), "x");
    type(dialog.querySelector('input[placeholder="0.00"]'), "35.40");
    const firstCard = dialog.querySelectorAll('.item-line')[0];
    type(firstCard.querySelector('input[placeholder="Item"]'), "Burger");
    type(firstCard.querySelector('input[placeholder="1"]'), "1");
    type(firstCard.querySelector('input[placeholder="0.00"]'), "12.00");
    assert.match(dialog.textContent, /23\.40 EUR of the 35\.40 EUR total is not yet allocated/);
    buttonNamed(dialog, "Save expense").click();
    await tick();
    assert.equal(calls.length, 0, "an unreconciled itemization is refused, never silently saved");
  });

  test("a genuine quantity (2x Pizza) is supported", async () => {
    const { ctx, calls } = ctxWith();
    const modal = openItemizedExpenseModal(ctx);
    const dialog = modal.element;
    type(dialog.querySelector('input[placeholder="For example: Grocery run"]'), "x");
    type(dialog.querySelector('input[placeholder="0.00"]'), "20.00");
    const firstCard = dialog.querySelectorAll('.item-line')[0];
    type(firstCard.querySelector('input[placeholder="Item"]'), "Pizza");
    type(firstCard.querySelector('input[placeholder="1"]'), "2");
    type(firstCard.querySelector('input[placeholder="0.00"]'), "10.00");
    assert.match(dialog.textContent, /Reconciles exactly to 20\.00 EUR/);
    buttonNamed(dialog, "Save expense").click();
    await tick();
    const created = calls.find((c) => c.kind === "create-expense");
    assert.equal(created.body.itemization.lines[0].quantity, 2);
    assert.equal(created.body.itemization.lines[0].unitPriceMinor, 1000);
  });
});
