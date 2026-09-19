// BT-009-25 — linked refunds, in the browser code: the "Refund…" action (only offered when the
// server says one may still be recorded), the dialog defaulting to the original expense's own
// split, an explicit reviewed adjustment, and the original expense's own record staying untouched.
// All names are fictional.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { createView as createGroupView } from "../js/ui/views/group.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const type = (node, value) => { node.value = value; node.dispatchEvent(new DomEvent("input", { bubbles: true })); };

function expenseFixture({ canRefund = true, refundedMinor = 0 } = {}) {
  return {
    id: "exp_1", description: "Fictional dinner", date: "2026-09-11", categoryId: null, notes: "",
    currency: "EUR", amount: "90.00", amountMinor: 9000, eventId: null, original: null,
    payers: [{ ref: "member:a", amount: "90.00", amountMinor: 9000 }],
    split: { method: "equal", lines: [{ ref: "member:a", value: null }, { ref: "member:b", value: null }, { ref: "member:c", value: null }] },
    shares: [{ ref: "member:a", amount: "30.00", amountMinor: 3000 }, { ref: "member:b", amount: "30.00", amountMinor: 3000 }, { ref: "member:c", amount: "30.00", amountMinor: 3000 }],
    revision: 1, canEdit: true, canVoid: true, myLedger: null, amendmentCount: 0,
    refundedMinor, refunded: (refundedMinor / 100).toFixed(2), canRefund,
  };
}

function ctxWith({ expense = expenseFixture() } = {}) {
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
      participants, expenses: [expense], settlements: [], balances: [{ currency: "EUR", rows: [], suggestions: [], direct: [], unitSuggestions: [] }],
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
    createRefund: async (ws, body) => { calls.push({ kind: "create-refund", body }); return { refund: { id: "grf_new001" } }; },
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

describe("BT-009-25 linked refunds: the Refund action", () => {
  test("is offered only when the server says canRefund is true, and shows how much has already been refunded", () => {
    const refundable = ctxWith({ expense: expenseFixture({ canRefund: true, refundedMinor: 3000 }) });
    const v1 = createGroupView(refundable.ctx);
    v1.update(refundable.state);
    assert.ok(buttonNamed(v1.element, "Refund…"));
    assert.match(v1.element.textContent, /Refunded: EUR 30\.00/);

    dom.teardown(); dom = installDom();
    const notRefundable = ctxWith({ expense: expenseFixture({ canRefund: false }) });
    const v2 = createGroupView(notRefundable.ctx);
    v2.update(notRefundable.state);
    assert.equal(buttonNamed(v2.element, "Refund…"), undefined);
  });

  test("defaults to the original expense's own split (method and people), reconciles live, and requires a reason", async () => {
    const { ctx, state, calls } = ctxWith();
    const v = createGroupView(ctx);
    v.update(state);
    buttonNamed(v.element, "Refund…").click();
    const dialog = document.body.querySelector(".modal");
    assert.match(dialog.textContent, /Refund "Fictional dinner"/);
    // Amount defaults to the full remaining refundable amount.
    assert.equal(dialog.querySelector('input[inputmode="decimal"]').value, "90.00");
    // Saving without a reason is refused.
    buttonNamed(dialog, "Record refund").click();
    await tick();
    assert.equal(calls.length, 0);
    assert.match(dialog.textContent, /Give a reason for this refund/);
    type(dialog.querySelector('input[placeholder="Why is this being refunded?"]'), "Restaurant overcharge");
    buttonNamed(dialog, "Record refund").click();
    await tick();
    const created = calls.find((c) => c.kind === "create-refund");
    assert.equal(created.body.expenseId, "exp_1");
    assert.equal(created.body.amount, "90.00");
    assert.equal(created.body.split.method, "equal");
    assert.deepEqual(created.body.split.lines.map((l) => l.ref).sort(), ["member:a", "member:b", "member:c"]);
  });

  test("an explicitly reviewed adjustment: unchecking a person and lowering the amount allocates the refund differently from the original split", async () => {
    const { ctx, state, calls } = ctxWith();
    const v = createGroupView(ctx);
    v.update(state);
    buttonNamed(v.element, "Refund…").click();
    const dialog = document.body.querySelector(".modal");
    type(dialog.querySelector('input[inputmode="decimal"]'), "10.00");
    // Uncheck Bob and Carol — only Alice's own line stays checked.
    const boxes = dialog.querySelectorAll('input[type="checkbox"]');
    boxes[1].checked = false; boxes[1].dispatchEvent(new DomEvent("change", { bubbles: true }));
    boxes[2].checked = false; boxes[2].dispatchEvent(new DomEvent("change", { bubbles: true }));
    type(dialog.querySelector('input[placeholder="Why is this being refunded?"]'), "Only Alice's item");
    buttonNamed(dialog, "Record refund").click();
    await tick();
    const created = calls.find((c) => c.kind === "create-refund");
    assert.equal(created.body.amount, "10.00");
    assert.deepEqual(created.body.split.lines.map((l) => l.ref), ["member:a"]);
  });

  test("the original expense's own data in the store is never mutated by opening or submitting the refund dialog", async () => {
    const { ctx, state } = ctxWith();
    const originalExpenseSnapshot = JSON.stringify(state.group.data.expenses[0]);
    const v = createGroupView(ctx);
    v.update(state);
    buttonNamed(v.element, "Refund…").click();
    const dialog = document.body.querySelector(".modal");
    type(dialog.querySelector('input[placeholder="Why is this being refunded?"]'), "x");
    buttonNamed(dialog, "Record refund").click();
    await tick();
    assert.equal(JSON.stringify(state.group.data.expenses[0]), originalExpenseSnapshot, "the expense record itself was never mutated client-side");
  });
});
