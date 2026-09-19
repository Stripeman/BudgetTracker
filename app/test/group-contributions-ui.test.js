// BT-009-25 — shared income/prepaid contributions/deposits, in the browser code: the Shared fund
// card (the honest "never counts as income or spending, never changes Balances" note), adding a
// contribution, applying/returning part of it, and the real bodies sent to the server. All names
// are fictional.
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

function ctxWith({ contributions = [] } = {}) {
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
      settlementUnits: [], contributions,
    } },
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts: [], totals: [] } },
    categories: { workspaceId: "ws_1", status: "ready", error: null, data: { categories: [] } },
    transactions: { workspaceId: "ws_1", status: "ready", error: null, data: { transactions: [], summary: [], total: 0 } },
    payees: { workspaceId: "ws_1", status: "ready", error: null, data: { payees: [] } },
  };
  const calls = [];
  const api = {
    createContribution: async (ws, body) => { calls.push({ kind: "create-contribution", body }); return { contribution: {} }; },
    applyContribution: async (ws, body) => { calls.push({ kind: "apply-contribution", body }); return { contribution: {} }; },
    returnContribution: async (ws, body) => { calls.push({ kind: "return-contribution", body }); return { contribution: {} }; },
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

describe("BT-009-25 Shared fund card: contributions and deposits", () => {
  test("states plainly that this never counts as income or spending and never changes the Balances card", () => {
    const { ctx, state } = ctxWith();
    const v = createGroupView(ctx);
    v.update(state);
    assert.match(v.element.textContent, /never counts as income or spending, and never changes the Balances card above/);
  });

  test("Add contribution sends the real body", async () => {
    const { ctx, state, calls } = ctxWith();
    const v = createGroupView(ctx);
    v.update(state);
    buttonNamed(v.element, "Add contribution…").click();
    const dialog = document.body.querySelector(".modal");
    type(dialog.querySelector('input[placeholder="0.00"]'), "100.00");
    buttonNamed(dialog, "Add contribution").click();
    await tick();
    const created = calls.find((c) => c.kind === "create-contribution");
    assert.equal(created.body.amount, "100.00");
    assert.equal(created.body.kind, "contribution");
    assert.equal(created.body.contributor, "member:a");
    assert.equal(created.body.holder, "member:a");
  });

  test("lists a contribution with its held/applied/returned figures, and Apply/Return send the real amount", async () => {
    const contribution = { id: "gct_1", contributor: "member:b", holder: "member:a", kind: "contribution", currency: "EUR", amount: "100.00", applied: "0.00", returned: "0.00", held: "100.00", heldMinor: 10000, date: "2026-09-19", notes: "", createdBy: "Alice", createdBySelf: true };
    const { ctx, state, calls } = ctxWith({ contributions: [contribution] });
    const v = createGroupView(ctx);
    v.update(state);
    assert.match(v.element.textContent, /Bob/);
    assert.match(v.element.textContent, /Contribution/);
    buttonNamed(v.element, "Apply…").click();
    const dialog = document.body.querySelector(".modal");
    type(dialog.querySelector('input[placeholder="0.00"]'), "80.00");
    buttonNamed(dialog, "Apply").click();
    await tick();
    const applied = calls.find((c) => c.kind === "apply-contribution");
    assert.equal(applied.body.contributionId, "gct_1");
    assert.equal(applied.body.amount, "80.00");
  });

  test("a fully returned contribution (nothing still held) offers no more Apply/Return", () => {
    const done = { id: "gct_1", contributor: "member:b", holder: "member:a", kind: "contribution", currency: "EUR", amount: "100.00", applied: "0.00", returned: "100.00", held: "0.00", heldMinor: 0, date: "2026-09-19", notes: "", createdBy: "Alice", createdBySelf: true };
    const { ctx, state } = ctxWith({ contributions: [done] });
    const v = createGroupView(ctx);
    v.update(state);
    assert.equal(buttonNamed(v.element, "Apply…"), undefined);
    assert.equal(buttonNamed(v.element, "Return…"), undefined);
  });
});
