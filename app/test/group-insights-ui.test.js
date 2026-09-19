// BT-009-26 — insights, in the browser code: the Insights card fetches derived spending/category/
// participant/settlement summaries (its own read-only route, refetched only when the workspace or
// the viewed event changes) and renders them. All names are fictional.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { createView as createGroupView } from "../js/ui/views/group.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function ctxWith({ insightsResult = null } = {}) {
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
      settlementUnits: [], contributions: [],
    } },
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts: [], totals: [] } },
    categories: { workspaceId: "ws_1", status: "ready", error: null, data: { categories: [] } },
    transactions: { workspaceId: "ws_1", status: "ready", error: null, data: { transactions: [], summary: [], total: 0 } },
    payees: { workspaceId: "ws_1", status: "ready", error: null, data: { payees: [] } },
  };
  const calls = [];
  const defaultInsights = { insights: [{
    currency: "EUR", totalSpentMinor: 9000, totalSpent: "90.00", expenseCount: 1,
    byCategory: [{ categoryId: null, name: "Uncategorized", totalMinor: 9000, total: "90.00", count: 1 }],
    byParticipant: [
      { ref: "member:a", name: "Alice Fictional", paidMinor: 9000, paid: "90.00", shareMinor: 4500, share: "45.00" },
      { ref: "member:b", name: "Bob Fictional", paidMinor: 0, paid: "0.00", shareMinor: 4500, share: "45.00" },
    ],
    settlements: { confirmedMinor: 0, confirmed: "0.00", confirmedCount: 0, pendingMinor: 0, pending: "0.00", pendingCount: 0, disputedMinor: 0, disputed: "0.00", disputedCount: 0 },
  }] };
  const api = {
    groupInsights: async (ws, eventId) => { calls.push({ kind: "insights", ws, eventId }); return insightsResult || defaultInsights; },
  };
  const store = {
    getState: () => state,
    actions: { write: async (fn) => { const result = await fn("ws_1"); return { ok: true, result }; }, refreshGroup: async () => {} },
  };
  return { ctx: { store, api }, state, calls };
}

describe("BT-009-26 Insights card", () => {
  test("fetches insights for the workspace and renders category/participant/settlement summaries", async () => {
    const { ctx, state, calls } = ctxWith();
    const v = createGroupView(ctx);
    v.update(state);
    await tick();
    v.update(state);
    assert.equal(calls.length, 1, "fetched exactly once for the same workspace/event");
    assert.match(v.element.textContent, /Total spent/);
    assert.match(v.element.textContent, /Uncategorized/);
    assert.match(v.element.textContent, /You.*paid EUR 90\.00/, "the viewer's own name reads as 'You', exactly like everywhere else on this page");
    assert.match(v.element.textContent, /Bob.*paid EUR 0\.00/);
  });

  test("with no shared expenses yet, says so plainly instead of showing an empty table", async () => {
    const { ctx, state } = ctxWith({ insightsResult: { insights: [{ currency: "EUR", totalSpentMinor: 0, totalSpent: "0.00", expenseCount: 0, byCategory: [], byParticipant: [], settlements: { confirmedMinor: 0, confirmed: "0.00", confirmedCount: 0, pendingMinor: 0, pending: "0.00", pendingCount: 0, disputedMinor: 0, disputed: "0.00", disputedCount: 0 } }] } });
    const v = createGroupView(ctx);
    v.update(state);
    await tick();
    v.update(state);
    assert.match(v.element.textContent, /insights will appear once there are some/);
  });

  test("re-fetches when the viewed event changes", async () => {
    const events = [{ id: "gev_1", name: "Ski trip", status: "active", isDefault: true, expenseCount: 0, settlementCount: 0, createdBy: "Alice", createdAt: "" }];
    const { ctx, state, calls } = ctxWith();
    state.group.data.events = events;
    state.group.data.defaultEventId = events[0].id;
    const v = createGroupView(ctx);
    v.update(state);
    await tick();
    v.update(state);
    assert.equal(calls.filter((c) => c.kind === "insights").length, 1);
    state.group.data.currentEvent = events[0];
    v.update(state);
    await tick();
    v.update(state);
    const afterScope = calls.filter((c) => c.kind === "insights");
    assert.equal(afterScope.length, 2, "a new fetch happens once the viewed event actually changes");
    assert.equal(afterScope[1].eventId, "gev_1");
  });
});
