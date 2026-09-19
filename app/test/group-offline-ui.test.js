// BT-009-26 offline entry, in the browser code: the Offline entry card (opt-in toggle, disclosure,
// the local queue), and the guard in Add expense/Record payment that queues a NEW record instead of
// showing an error only when this device has explicitly opted in AND the failure is a genuine
// connectivity problem — never anything the server actually looked at and refused. All names are
// fictional.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { createView as createGroupView, openGroupExpense } from "../js/ui/views/group.js";
import { ErrorKind } from "../js/core/errors.js";
import * as offline from "../js/core/offline.js";

let dom;
function fakeStorage() {
  const store = {};
  return { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
}
beforeEach(() => { dom = installDom(); globalThis.localStorage = fakeStorage(); });
afterEach(() => { dom.teardown(); delete globalThis.localStorage; });

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const type = (node, value) => { node.value = value; node.dispatchEvent(new DomEvent("input", { bubbles: true })); };
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const OFFLINE = '[aria-labelledby="grp-offline"]';
const fillMinimalExpense = (dialog) => {
  type(dialog.querySelector('input[placeholder="For example: Dinner at the harbour"]'), "Fictional Dinner");
  type(dialog.querySelector('input[placeholder="0.00 or 12.50+3.20"]'), "20.00");
};

function ctxWith({ createGroupExpense } = {}) {
  const participants = [
    { ref: "member:a", name: "Alice", type: "member", self: true, active: true },
    { ref: "member:b", name: "Bob", type: "member", self: false, active: true },
  ];
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Trip Club", kind: "group", role: "owner" }],
    preferences: null,
    group: { workspaceId: "ws_1", status: "ready", error: null, data: {
      currency: "EUR", kind: "group", permissions: { canAdd: true, canManage: true, selfRef: "member:a", role: "owner" },
      participants, expenses: [], settlements: [], balances: [{ currency: "EUR", rows: [], suggestions: [], direct: [], unitSuggestions: [] }],
      basis: "Balances count confirmed payments only.", events: [], defaultEventId: null,
      eventAccessNote: "Events organize expenses and payments; they do not change who can see them.",
      settlementUnits: [], contributions: [], paymentRequests: [],
    } },
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts: [], totals: [] } },
    categories: { workspaceId: "ws_1", status: "ready", error: null, data: { categories: [] } },
    transactions: { workspaceId: "ws_1", status: "ready", error: null, data: { transactions: [], summary: [], total: 0 } },
    payees: { workspaceId: "ws_1", status: "ready", error: null, data: { payees: [] } },
  };
  const calls = [];
  const api = {
    createGroupExpense: createGroupExpense || (async (ws, body, key) => { calls.push({ ws, body, key }); return { expense: { id: "gex_1" } }; }),
    groupAction: async () => ({}),
  };
  const store = {
    getState: () => state,
    actions: {
      write: async (fn) => { try { const result = await fn("ws_1"); return { ok: true, result }; } catch (err) { return { ok: false, error: err }; } },
      refreshGroup: async () => { calls.push({ kind: "refresh" }); },
    },
  };
  return { ctx: { store, api }, state, calls };
}

describe("BT-009-26 Offline entry card", () => {
  test("off by default, discloses in words what is kept and what is not, and says nothing is waiting", () => {
    const { ctx, state } = ctxWith();
    const v = createGroupView(ctx);
    v.update(state);
    const card = v.element.querySelector(OFFLINE);
    assert.match(card.textContent, /Only what you typed is kept on this device/);
    assert.match(card.textContent, /Nothing is currently waiting to be sent/);
    assert.equal(card.querySelector('input[type="checkbox"]').checked, false);
  });

  test("the toggle turns offline entry on and off for this device", () => {
    const { ctx, state } = ctxWith();
    const v = createGroupView(ctx);
    v.update(state);
    const toggle = v.element.querySelector(OFFLINE).querySelector('input[type="checkbox"]');
    toggle.checked = true;
    toggle.dispatchEvent(new DomEvent("change", { bubbles: true }));
    assert.equal(offline.isEnabled(), true);
    toggle.checked = false;
    toggle.dispatchEvent(new DomEvent("change", { bubbles: true }));
    assert.equal(offline.isEnabled(), false);
  });
});

describe("BT-009-26 offline entry: queuing a new expense", () => {
  test("with offline entry OFF, a genuine connectivity failure shows as a normal error — never silently queued without consent", async () => {
    offline.setEnabled(false);
    const { ctx, state } = ctxWith({ createGroupExpense: async () => { throw { kind: ErrorKind.NETWORK, message: "" }; } });
    const modal = openGroupExpense(ctx, {});
    fillMinimalExpense(modal.element);
    buttonNamed(modal.element, "Save expense").click();
    await tick();
    assert.equal(offline.queueFor("ws_1").length, 0, "not queued — the device never opted in");
    assert.ok(document.body.querySelector(".modal"), "the dialog stays open to show the error");
  });

  test("with offline entry ON, the same failure is saved on this device instead of shown as an error, with the exact idempotency key it would have used", async () => {
    offline.setEnabled(true);
    const { ctx, state } = ctxWith({ createGroupExpense: async () => { throw { kind: ErrorKind.NETWORK, message: "" }; } });
    const modal = openGroupExpense(ctx, {});
    fillMinimalExpense(modal.element);
    buttonNamed(modal.element, "Save expense").click();
    await tick();
    const queued = offline.queueFor("ws_1");
    assert.equal(queued.length, 1);
    assert.equal(queued[0].kind, "expense");
    assert.equal(queued[0].body.description, "Fictional Dinner");
    assert.ok(queued[0].idempotencyKey);
    assert.equal(document.body.querySelector(".modal"), null, "the dialog closes — it is treated as handled, not failed");
    offline.discard(queued[0].id);
  });

  test("a real rejection (not connectivity) is never queued even with offline entry on — the server already looked at it", async () => {
    offline.setEnabled(true);
    const { ctx, state } = ctxWith({ createGroupExpense: async () => { throw { kind: ErrorKind.FORBIDDEN, message: "You do not have permission to do that." }; } });
    const modal = openGroupExpense(ctx, {});
    fillMinimalExpense(modal.element);
    buttonNamed(modal.element, "Save expense").click();
    await tick();
    assert.equal(offline.queueFor("ws_1").length, 0);
    assert.ok(document.body.querySelector(".modal"), "the dialog stays open to show the real error");
  });
});

describe("BT-009-26 offline entry: syncing what is queued", () => {
  test("a page render with something queued attempts to send it, and clears it on success", async () => {
    offline.setEnabled(true);
    const entry = offline.enqueue({ wsId: "ws_1", kind: "expense", body: { description: "Fictional Snacks", amount: "5.00" }, idempotencyKey: "k-sync-1" });
    const { ctx, state, calls } = ctxWith();
    const v = createGroupView(ctx);
    v.update(state);
    await tick();
    assert.ok(calls.some((c) => c.body && c.body.description === "Fictional Snacks"), "the queued item was replayed through the real create route");
    assert.equal(offline.queueFor("ws_1").length, 0, "sent, so no longer queued");
    offline.discard(entry.id); // defensive, in case the assertion above ever fails first
  });

  test("still offline: a queued item stays queued (un-blocked) and is shown as waiting", async () => {
    offline.setEnabled(true);
    const entry = offline.enqueue({ wsId: "ws_1", kind: "expense", body: { description: "Fictional Snacks", amount: "5.00" }, idempotencyKey: "k-sync-2" });
    const { ctx, state } = ctxWith({ createGroupExpense: async () => { throw { kind: ErrorKind.NETWORK, message: "" }; } });
    const v = createGroupView(ctx);
    v.update(state);
    await tick();
    const mine = offline.queueFor("ws_1");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].blocked, false);
    assert.match(v.element.querySelector(OFFLINE).textContent, /Waiting to send/);
    offline.discard(entry.id);
  });
});
