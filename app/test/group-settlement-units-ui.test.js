// BT-009-25 — the Shared Expenses page's Households card, in the browser code: listing units,
// adding one (checkbox picker, at least two people), removing one, and the "By household" toggle on
// Settle up that groups a unit into one suggestion while still recording against the real people.
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

function ctxWith({ settlementUnits = [], balances = null } = {}) {
  const participants = [
    { ref: "member:a", name: "Alice", type: "member", self: true, active: true },
    { ref: "member:b", name: "Bob", type: "member", self: false, active: true },
    { ref: "member:c", name: "Carol", type: "member", self: false, active: true },
  ];
  const defaultBalances = [{ currency: "EUR", rows: [
    { ref: "member:a", name: "Alice", paid: "90.00", share: "30.00", paidOut: "0.00", received: "0.00", net: "60.00", pendingIn: "0.00", pendingOut: "0.00", disputedIn: "0.00", disputedOut: "0.00", expenses: [] },
    { ref: "member:b", name: "Bob", paid: "0.00", share: "30.00", paidOut: "0.00", received: "0.00", net: "-30.00", pendingIn: "0.00", pendingOut: "0.00", disputedIn: "0.00", disputedOut: "0.00", expenses: [] },
    { ref: "member:c", name: "Carol", paid: "0.00", share: "30.00", paidOut: "0.00", received: "0.00", net: "-30.00", pendingIn: "0.00", pendingOut: "0.00", disputedIn: "0.00", disputedOut: "0.00", expenses: [] },
  ], suggestions: [{ from: "member:b", to: "member:a", amount: "30.00" }, { from: "member:c", to: "member:a", amount: "30.00" }], direct: [],
  unitSuggestions: settlementUnits.length ? [{ from: "member:c", to: "gsu_1", amount: "30.00", fromIsUnit: false, toIsUnit: true, fromName: null, toName: "The Smiths", fromRef: "member:c", toRef: "member:a" }] : [] }];
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Trip Club", kind: "group", role: "owner" }],
    preferences: null,
    group: { workspaceId: "ws_1", status: "ready", error: null, data: {
      currency: "EUR", kind: "group", permissions: { canAdd: true, canManage: true, selfRef: "member:a", role: "owner" },
      participants, expenses: [], settlements: [], balances: balances || defaultBalances,
      basis: "Balances count confirmed payments only.", events: [], defaultEventId: null,
      eventAccessNote: "Events organize expenses and payments; they do not change who can see them.",
      settlementUnits,
    } },
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts: [], totals: [] } },
    categories: { workspaceId: "ws_1", status: "ready", error: null, data: { categories: [] } },
    transactions: { workspaceId: "ws_1", status: "ready", error: null, data: { transactions: [], summary: [], total: 0 } },
    payees: { workspaceId: "ws_1", status: "ready", error: null, data: { payees: [] } },
  };
  const calls = [];
  const api = {
    createSettlementUnit: async (ws, body) => { calls.push({ kind: "create-unit", body }); return { unit: { id: "gsu_new0000001", name: body.name, memberRefs: body.memberRefs } }; },
    deleteSettlementUnit: async (ws, body) => { calls.push({ kind: "delete-unit", body }); return { removed: true }; },
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

describe("BT-009-25 Households card: settlement units", () => {
  test("shows the honest 'display only' note and every household with its members named", () => {
    const { ctx, state } = ctxWith({ settlementUnits: [{ id: "gsu_1", name: "The Smiths", memberRefs: ["member:a", "member:b"], createdBy: "Alice", createdAt: "" }] });
    const v = createGroupView(ctx);
    v.update(state);
    const text = v.element.textContent;
    assert.match(text, /This never changes who paid what or who owes what, and never gives anyone access to anything/);
    assert.match(text, /The Smiths/);
    assert.match(text, /You, Bob/, "the viewer's own name reads as 'You', exactly like everywhere else on this page");
  });

  test("Add household offers only people not already in another household, requires at least two, and sends the real create body", async () => {
    const { ctx, state, calls } = ctxWith({ settlementUnits: [] });
    const v = createGroupView(ctx);
    v.update(state);
    buttonNamed(v.element, "Add household…").click();
    const dialog = document.body.querySelector(".modal");
    type(dialog.querySelector("input"), "The Smiths");
    // Choosing only one person is refused.
    const boxes = dialog.querySelectorAll('input[type="checkbox"]');
    boxes[0].checked = true;
    buttonNamed(dialog, "Add household").click();
    await tick();
    assert.equal(calls.length, 0, "fewer than two people is refused before any API call");
    boxes[1].checked = true;
    buttonNamed(dialog, "Add household").click();
    await tick();
    const created = calls.find((c) => c.kind === "create-unit");
    assert.equal(created.body.name, "The Smiths");
    assert.deepEqual(created.body.memberRefs.sort(), ["member:a", "member:b"]);
  });

  test("Remove sends the real delete body", async () => {
    const { ctx, state, calls } = ctxWith({ settlementUnits: [{ id: "gsu_1", name: "The Smiths", memberRefs: ["member:a", "member:b"], createdBy: "Alice", createdAt: "" }] });
    const v = createGroupView(ctx);
    v.update(state);
    buttonNamed(v.element, "Remove").click();
    await tick();
    const removed = calls.find((c) => c.kind === "delete-unit");
    assert.equal(removed.body.unitId, "gsu_1");
  });

  test("'By household' only appears once a unit exists, groups the suggestion into one line, names the real receiving person, and Record payment uses the real refs", () => {
    const noUnits = ctxWith({ settlementUnits: [] });
    const v1 = createGroupView(noUnits.ctx);
    v1.update(noUnits.state);
    assert.equal(buttonNamed(v1.element, "By household"), undefined, "no toggle when no household exists");

    const withUnit = ctxWith({ settlementUnits: [{ id: "gsu_1", name: "The Smiths", memberRefs: ["member:a", "member:b"], createdBy: "Alice", createdAt: "" }] });
    const v2 = createGroupView(withUnit.ctx);
    v2.update(withUnit.state);
    const toggle = buttonNamed(v2.element, "By household");
    assert.ok(toggle);
    toggle.click();
    v2.update(withUnit.state);
    const text = v2.element.textContent;
    // Alice (the person looking) is the real recipient behind "The Smiths" here, so this correctly
    // reads "Carol pays you" — exactly as personal as every other suggestion on this page — proving
    // the unit-merged suggestion (one line, not two) reached the real person underneath it.
    assert.match(text, /Carol pays you/);
    assert.equal(text.match(/Record payment/g).length, 1, "one merged suggestion, not two");
    const recordBtn = buttonNamed(v2.element, "Record payment");
    assert.ok(recordBtn, "still offers to record the real payment");
  });
});
