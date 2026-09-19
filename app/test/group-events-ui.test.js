// BT-009-20/21 — the Shared Expenses page's event directory and picker, in the browser code: the
// events card (access-scope note, status, counts), creating a named event and switching straight to
// viewing it, the manager/owner-only lifecycle actions (matching the server's own transitions), and
// a new expense/payment started while viewing one event joining that event. All names are fictional.
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

function ctxWith({ events = [], currentEvent = null, canManage = true, canAdd = true } = {}) {
  const participants = [
    { ref: "member:a", name: "Alice", type: "member", self: true, active: true },
    { ref: "member:b", name: "Bob", type: "member", self: false, active: true },
  ];
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Trip Club", kind: "group", role: canManage ? "owner" : "member" }],
    preferences: null,
    group: { workspaceId: "ws_1", status: "ready", error: null, data: {
      currency: "EUR", kind: "group", permissions: { canAdd, canManage, selfRef: "member:a", role: canManage ? "owner" : "member" },
      participants, expenses: [], settlements: [], balances: [{ currency: "EUR", rows: [], suggestions: [], direct: [] }],
      basis: "Balances count confirmed payments only.", events, defaultEventId: events[0] ? events[0].id : null,
      ...(currentEvent ? { currentEvent } : {}),
      eventAccessNote: "Events organize expenses and payments; they do not change who can see them. Everyone who can see Shared expenses in this workspace can see every event in it.",
    } },
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts: [], totals: [] } },
    categories: { workspaceId: "ws_1", status: "ready", error: null, data: { categories: [] } },
    transactions: { workspaceId: "ws_1", status: "ready", error: null, data: { transactions: [], summary: [], total: 0 } },
    payees: { workspaceId: "ws_1", status: "ready", error: null, data: { payees: [] } },
  };
  const calls = [];
  const api = {
    createGroupEvent: async (ws, body) => { calls.push({ kind: "create-event", body }); return { event: { id: "gev_new0000001", name: body.name, description: body.description, status: "active", isDefault: false, expenseCount: 0, settlementCount: 0 } }; },
    groupEventStatus: async (ws, body) => { calls.push({ kind: "event-status", body }); return { event: {} }; },
    createGroupExpense: async (ws, body, key) => { calls.push({ kind: "create-expense", body, key }); return { expense: {} }; },
    groupAction: async (ws, action, body) => { calls.push({ kind: action, body }); return {}; },
    sharedExport: async (ws, format, eventId) => { calls.push({ kind: "export", ws, format, eventId }); return { filename: `shared-expenses.${format}`, mime: "text/plain", content: "x", encoding: "text" }; },
  };
  const store = {
    getState: () => state,
    actions: {
      write: async (fn) => { const result = await fn("ws_1"); return { ok: true, result }; },
      refreshGroup: async () => {},
      setGroupEventFilter: async (eventId) => { calls.push({ kind: "set-filter", eventId }); },
    },
  };
  return { ctx: { store, api }, state, calls };
}

describe("BT-009-20/21 events card: the directory, its access note, and lifecycle actions", () => {
  test("shows the access-scope note and every event with its status and counts", () => {
    const events = [
      { id: "gev_1", name: "Ski trip", description: "", icon: null, color: null, status: "active", isDefault: true, expenseCount: 3, settlementCount: 1, createdBy: "Alice", createdAt: "2026-09-19T00:00:00Z" },
      { id: "gev_2", name: "Summer BBQ", description: "", icon: null, color: null, status: "closed", isDefault: false, expenseCount: 1, settlementCount: 0, createdBy: "Alice", createdAt: "2026-09-19T00:00:00Z" },
    ];
    const { ctx, state } = ctxWith({ events });
    const v = createGroupView(ctx);
    v.update(state);
    const text = v.element.textContent;
    assert.match(text, /Events organize expenses and payments; they do not change who can see them/);
    assert.match(text, /Ski trip/);
    assert.match(text, /\(default\)/);
    assert.match(text, /3 expenses, 1 payment/);
    assert.match(text, /Summer BBQ/);
    assert.match(text, /1 expense, 0 payments/);
    assert.match(text, /Closed/);
  });

  test("a manager/owner sees Close/Archive for an active event and Reopen for a closed one; a plain member sees neither", () => {
    const events = [
      { id: "gev_1", name: "Active One", status: "active", isDefault: true, expenseCount: 0, settlementCount: 0, createdBy: "Alice", createdAt: "" },
      { id: "gev_2", name: "Closed One", status: "closed", isDefault: false, expenseCount: 0, settlementCount: 0, createdBy: "Alice", createdAt: "" },
    ];
    const managerView = ctxWith({ events, canManage: true });
    const v1 = createGroupView(managerView.ctx);
    v1.update(managerView.state);
    assert.ok(buttonNamed(v1.element, "Close"), "a manager can close the active event");
    assert.ok(buttonNamed(v1.element, "Archive"), "a manager can archive either event");
    assert.ok(buttonNamed(v1.element, "Reopen"), "a manager can reopen the closed event");

    dom.teardown();
    dom = installDom();
    const memberView = ctxWith({ events, canManage: false });
    const v2 = createGroupView(memberView.ctx);
    v2.update(memberView.state);
    assert.equal(buttonNamed(v2.element, "Close"), undefined, "a plain member never sees lifecycle actions");
    assert.equal(buttonNamed(v2.element, "Archive"), undefined);
    assert.equal(buttonNamed(v2.element, "Reopen"), undefined);
  });

  test("View switches the store's event filter; closing an event opens a confirm dialog stating the real effect, and sends the right status", async () => {
    const events = [{ id: "gev_1", name: "Ski trip", status: "active", isDefault: true, expenseCount: 2, settlementCount: 0, createdBy: "Alice", createdAt: "" }];
    const { ctx, state, calls } = ctxWith({ events, canManage: true });
    const v = createGroupView(ctx);
    v.update(state);

    buttonNamed(v.element, "View").click();
    await tick();
    assert.deepEqual(calls.find((c) => c.kind === "set-filter"), { kind: "set-filter", eventId: "gev_1" });

    buttonNamed(v.element, "Close").click();
    const dialog = document.body.querySelector(".modal");
    assert.match(dialog.textContent, /settling up.*stays possible/s);
    assert.match(dialog.textContent, /no balance is forgiven/);
    type(dialog.querySelector('input[placeholder="Optional"]'), "Trip is over");
    buttonNamed(dialog, "Close").click();
    await tick();
    const sent = calls.find((c) => c.kind === "event-status");
    assert.deepEqual(sent.body, { eventId: "gev_1", status: "closed", reason: "Trip is over" });
  });

  test("Add event opens a dialog; creating one switches straight to viewing it", async () => {
    const { ctx, state, calls } = ctxWith({ events: [] });
    const v = createGroupView(ctx);
    v.update(state);
    assert.match(v.element.textContent, /No named events yet/);
    buttonNamed(v.element, "Add event…").click();
    const dialog = document.body.querySelector(".modal");
    type(dialog.querySelector("input"), "Winter trip");
    buttonNamed(dialog, "Add event").click();
    await tick();
    const created = calls.find((c) => c.kind === "create-event");
    assert.equal(created.body.name, "Winter trip");
    assert.deepEqual(calls.find((c) => c.kind === "set-filter"), { kind: "set-filter", eventId: "gev_new0000001" });
  });

  test("a new expense started while viewing one event's own scoped page is created with that event's id; the combined (unscoped) page sends none", async () => {
    const events = [{ id: "gev_1", name: "Ski trip", status: "active", isDefault: true, expenseCount: 0, settlementCount: 0, createdBy: "Alice", createdAt: "" }];
    const scoped = ctxWith({ events, currentEvent: events[0] });
    const v1 = createGroupView(scoped.ctx);
    v1.update(scoped.state);
    assert.match(v1.element.textContent, /Showing only "Ski trip"/);
    buttonNamed(v1.element, "Add expense").click();
    const dialog1 = document.body.querySelector(".modal");
    type(dialog1.querySelector('input[placeholder="For example: Dinner at the harbour"]'), "Lift passes");
    type(dialog1.querySelector('input[placeholder="0.00 or 12.50+3.20"]'), "80.00");
    buttonNamed(dialog1, "Save expense").click();
    await tick();
    assert.equal(scoped.calls.find((c) => c.kind === "create-expense").body.eventId, "gev_1");

    dom.teardown();
    dom = installDom();
    const combined = ctxWith({ events });
    const v2 = createGroupView(combined.ctx);
    v2.update(combined.state);
    buttonNamed(v2.element, "Add expense").click();
    const dialog2 = document.body.querySelector(".modal");
    type(dialog2.querySelector('input[placeholder="For example: Dinner at the harbour"]'), "Lift passes");
    type(dialog2.querySelector('input[placeholder="0.00 or 12.50+3.20"]'), "80.00");
    buttonNamed(dialog2, "Save expense").click();
    await tick();
    assert.equal("eventId" in combined.calls.find((c) => c.kind === "create-expense").body, false, "the combined view never silently picks an event for a new expense");
  });

  test("BT-009-23: Export on one event's row downloads only that event; Export everything sends no eventId", async () => {
    const events = [{ id: "gev_1", name: "Ski trip", status: "active", isDefault: true, expenseCount: 2, settlementCount: 0, createdBy: "Alice", createdAt: "" }];
    const { ctx, state, calls } = ctxWith({ events });
    const v = createGroupView(ctx);
    v.update(state);

    buttonNamed(v.element, "Export…").click();
    const dialog = document.body.querySelectorAll(".modal").find((m) => m.querySelector("h2").textContent === 'Export "Ski trip"');
    assert.ok(dialog, "an export dialog titled for the one event opens");
    buttonNamed(dialog, "CSV").click();
    await tick();
    const scoped = calls.find((c) => c.kind === "export");
    assert.deepEqual(scoped, { kind: "export", ws: "ws_1", format: "csv", eventId: "gev_1" });

    buttonNamed(v.element, "Export everything…").click();
    const dialog2 = document.body.querySelectorAll(".modal").find((m) => m.querySelector("h2").textContent === "Export every shared expense");
    assert.ok(dialog2, "an export-everything dialog opens");
    buttonNamed(dialog2, "JSON").click();
    await tick();
    const combined = calls.filter((c) => c.kind === "export").find((c) => c.format === "json");
    assert.deepEqual(combined, { kind: "export", ws: "ws_1", format: "json", eventId: null });
  });
});
