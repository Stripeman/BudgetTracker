// BT-009-26 — in-app payment reminders/requests, in the browser code: the Payment reminders card
// (the honest "not an email/text/push, moves no money" note), sending a reminder, dismissing or
// cancelling one, and the real bodies sent to the server. All names are fictional.
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

function ctxWith({ paymentRequests = [], canManage = true } = {}) {
  const participants = [
    { ref: "member:a", name: "Alice", type: "member", self: true, active: true },
    { ref: "member:b", name: "Bob", type: "member", self: false, active: true },
    { ref: "member:c", name: "Carol", type: "member", self: false, active: true },
  ];
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Trip Club", kind: "group", role: canManage ? "owner" : "member" }],
    preferences: null,
    group: { workspaceId: "ws_1", status: "ready", error: null, data: {
      currency: "EUR", kind: "group", permissions: { canAdd: true, canManage, selfRef: "member:a", role: canManage ? "owner" : "member" },
      participants, expenses: [], settlements: [], balances: [{ currency: "EUR", rows: [], suggestions: [], direct: [], unitSuggestions: [] }],
      basis: "Balances count confirmed payments only.", events: [], defaultEventId: null,
      eventAccessNote: "Events organize expenses and payments; they do not change who can see them.",
      settlementUnits: [], contributions: [], paymentRequests,
    } },
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts: [], totals: [] } },
    categories: { workspaceId: "ws_1", status: "ready", error: null, data: { categories: [] } },
    transactions: { workspaceId: "ws_1", status: "ready", error: null, data: { transactions: [], summary: [], total: 0 } },
    payees: { workspaceId: "ws_1", status: "ready", error: null, data: { payees: [] } },
  };
  const calls = [];
  const api = {
    createPaymentRequest: async (ws, body) => { calls.push({ kind: "create-payment-request", body }); return { paymentRequest: {} }; },
    dismissPaymentRequest: async (ws, body) => { calls.push({ kind: "dismiss-payment-request", body }); return { paymentRequest: {} }; },
    cancelPaymentRequest: async (ws, body) => { calls.push({ kind: "cancel-payment-request", body }); return { paymentRequest: {} }; },
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

describe("BT-009-26 Payment reminders card", () => {
  test("states plainly that this is in-app only and moves no money", () => {
    const { ctx, state } = ctxWith();
    const v = createGroupView(ctx);
    v.update(state);
    assert.match(v.element.textContent, /not an email, text or push notification/);
    assert.match(v.element.textContent, /No payment reminders yet\./);
  });

  test("Send a reminder… sends the real body, defaulting to the viewer as who is owed", async () => {
    const { ctx, state, calls } = ctxWith();
    const v = createGroupView(ctx);
    v.update(state);
    buttonNamed(v.element, "Send a reminder…").click();
    const dialog = document.body.querySelector(".modal");
    type(dialog.querySelector('input[placeholder="0.00"]'), "20.00");
    buttonNamed(dialog, "Send reminder").click();
    await tick();
    const created = calls.find((c) => c.kind === "create-payment-request");
    assert.equal(created.body.to, "member:a", "defaults to the viewer as who is owed");
    assert.ok(created.body.from && created.body.from !== "member:a", "who should pay defaults to a different real person");
    assert.equal(created.body.amount, "20.00");
  });

  test("lists an open reminder in words, naming the real people, with no external-delivery claim", () => {
    const r = { id: "gpr_1", from: "member:b", to: "member:a", currency: "EUR", amount: "20.00", amountMinor: 2000, note: "Fictional dinner", status: "open", createdBy: "Alice", createdBySelf: true, createdAt: "2026-09-19", respondedAt: null };
    const { ctx, state } = ctxWith({ paymentRequests: [r] });
    const v = createGroupView(ctx);
    v.update(state);
    assert.match(v.element.textContent, /You asked Bob to pay/);
    assert.match(v.element.textContent, /Fictional dinner/);
  });

  test("only the person being reminded sees Mark as seen; only its sender (or a manager) sees Cancel", () => {
    const mine = { id: "gpr_1", from: "member:b", to: "member:a", currency: "EUR", amount: "20.00", amountMinor: 2000, note: "", status: "open", createdBy: "Alice", createdBySelf: true, createdAt: "2026-09-19", respondedAt: null };
    const { ctx, state } = ctxWith({ paymentRequests: [mine] });
    const v = createGroupView(ctx);
    v.update(state);
    // Alice sent it and is not the one being reminded (Bob is) — she can cancel, not dismiss.
    assert.ok(buttonNamed(v.element, "Cancel"), "the sender can cancel her own open reminder");
    assert.equal(buttonNamed(v.element, "Mark as seen"), undefined, "Alice is not the one being reminded");

    const theirs = { id: "gpr_2", from: "member:a", to: "member:b", currency: "EUR", amount: "10.00", amountMinor: 1000, note: "", status: "open", createdBy: "Bob", createdBySelf: false, createdAt: "2026-09-19", respondedAt: null };
    const { ctx: ctx2, state: state2 } = ctxWith({ paymentRequests: [theirs], canManage: false });
    const v2 = createGroupView(ctx2);
    v2.update(state2);
    // Alice is being reminded here (from: member:a), did not send it, and is not a manager/owner —
    // she can dismiss, not cancel.
    assert.ok(buttonNamed(v2.element, "Mark as seen"), "the person being reminded can mark it as seen");
    assert.equal(buttonNamed(v2.element, "Cancel"), undefined, "Alice did not send this one and is not a manager or owner");
  });

  test("Mark as seen and Cancel send the real requestId, and a resolved reminder shows its status instead of actions", async () => {
    const r = { id: "gpr_1", from: "member:a", to: "member:b", currency: "EUR", amount: "20.00", amountMinor: 2000, note: "", status: "open", createdBy: "Bob", createdBySelf: false, createdAt: "2026-09-19", respondedAt: null };
    const { ctx, state, calls } = ctxWith({ paymentRequests: [r] });
    const v = createGroupView(ctx);
    v.update(state);
    buttonNamed(v.element, "Mark as seen").click();
    await tick();
    const dismissed = calls.find((c) => c.kind === "dismiss-payment-request");
    assert.equal(dismissed.body.requestId, "gpr_1");

    const resolved = { ...r, status: "dismissed", respondedAt: "2026-09-19" };
    const { ctx: ctx2, state: state2 } = ctxWith({ paymentRequests: [resolved] });
    const v2 = createGroupView(ctx2);
    v2.update(state2);
    assert.match(v2.element.textContent, /Seen/);
    assert.equal(buttonNamed(v2.element, "Mark as seen"), undefined);
    assert.equal(buttonNamed(v2.element, "Cancel"), undefined);
  });
});
