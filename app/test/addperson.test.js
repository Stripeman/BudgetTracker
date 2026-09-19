// "ADD PERSON" (BT-016, Terry, 2026-09-18: "I figured you would add a button that opened the
// existing modal to add a person"). A small create-only dialog for a workspace-shared CONTACT —
// someone who takes part in shared expenses without ever being invited into the application
// (never signed in, never granted access; api/_shared/people.js's `contact:` reference records
// only who was involved). Reachable from the Add/Edit shared-expense dialog without losing anything
// already typed there; the new person is immediately selectable in both "Paid by" and "Shared by"
// once added. Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { openGroupExpense } from "../js/ui/views/group.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const shareRow = (dialog, name) => dialog.querySelectorAll(".split-row").find((r) => r.querySelector("label") && r.querySelector("label").textContent.startsWith(name));
// By legend text, not position: BT-009-13 added its own (initially hidden) fieldset ahead of
// "Paid by"/"Shared by" for a foreign-currency expense's exchange-rate details, so the first
// `.plain-fieldset`/second `<fieldset>` are no longer reliably "Paid by"/"Shared by".
const fieldsetByLegend = (root, text) => root.querySelectorAll("fieldset").find((f) => f.querySelector("legend") && f.querySelector("legend").textContent === text);

function fakeCtx({ canAdd = true } = {}) {
  const calls = { contacts: [] };
  const people = [
    { ref: "member:a", name: "Alice", type: "member", self: true, active: true },
    { ref: "member:b", name: "Bob", type: "member", self: false, active: true },
  ];
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Dinner Club", kind: "group", role: canAdd ? "owner" : "viewer" }],
    preferences: null,
    group: { workspaceId: "ws_1", status: "ready", error: null, data: { currency: "EUR", permissions: { canAdd, selfRef: "member:a", role: canAdd ? "owner" : "viewer" }, participants: people, expenses: [], settlements: [], balances: [] } },
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts: [], totals: [] } },
    categories: { workspaceId: "ws_1", status: "ready", error: null, data: { categories: [] } },
  };
  const api = {
    createGroupExpense: async (ws, body, key) => { calls.push = calls.push || []; return { expense: {} }; },
    request: async (route, opts) => {
      calls.contacts.push({ route, opts });
      return { contact: { id: "con_new", scope: "workspace", ref: "contact:con_new", name: opts.body.name, email: opts.body.email || "", kind: "person", notes: "", ownedBySelf: true, archived: false, history: [] } };
    },
  };
  const store = { getState: () => state, actions: { write: async (fn, refresh) => ({ ok: true, result: await fn("ws_1") }) } };
  return { ctx: { store, api }, calls, state };
}

describe("BT-016 \"Add person\" from the shared-expense dialog", () => {
  test("owners/managers see \"Add person…\"; a viewer never does", () => {
    const { ctx } = fakeCtx({ canAdd: true });
    const dialog = openGroupExpense(ctx).element;
    assert.ok(buttonNamed(dialog, "Add person…"), "an owner/manager is offered it");

    dom.teardown();
    dom = installDom();
    const { ctx: viewerCtx } = fakeCtx({ canAdd: false });
    const viewerDialog = openGroupExpense(viewerCtx).element;
    assert.equal(buttonNamed(viewerDialog, "Add person…"), undefined, "a viewer is never offered it");
  });

  test("an empty name is refused inline; nothing is sent", async () => {
    const { ctx, calls } = fakeCtx();
    const dialog = openGroupExpense(ctx).element;
    buttonNamed(dialog, "Add person…").click();
    const addModal = dom.body.querySelectorAll(".modal").find((m) => m.querySelector("h2").textContent === "Add person");
    assert.ok(addModal, "the Add person dialog opened");
    buttonNamed(addModal, "Add person").click();
    await tick();
    assert.equal(calls.contacts.length, 0);
    assert.equal(addModal.querySelector(".modal__error").textContent, "Give this person a name.");
  });

  test("adding a person creates a real workspace contact and adds them to BOTH lists — checked under Shared by, unchecked under Paid by — without losing what was already typed", async () => {
    const { ctx, calls } = fakeCtx();
    const dialog = openGroupExpense(ctx).element;
    const description = dialog.querySelector('input[placeholder="For example: Dinner at the harbour"]');
    description.value = "Fictional picnic";
    description.dispatchEvent(new DomEvent("input"));

    buttonNamed(dialog, "Add person…").click();
    const addModal = dom.body.querySelectorAll(".modal").find((m) => m.querySelector("h2").textContent === "Add person");
    const name = addModal.querySelectorAll("label").find((l) => l.textContent === "Name");
    dom.body.querySelector(`#${name.getAttribute("for")}`).value = "Carol Fictional";
    dom.body.querySelector(`#${name.getAttribute("for")}`).dispatchEvent(new DomEvent("input"));
    buttonNamed(addModal, "Add person").click();
    await tick();

    assert.equal(calls.contacts.length, 1);
    assert.deepEqual(calls.contacts[0], { route: "contacts", opts: { method: "POST", body: { scope: "workspace", workspaceId: "ws_1", name: "Carol Fictional", email: "" } } });
    assert.equal(dom.body.querySelectorAll(".modal").find((m) => m.querySelector("h2").textContent === "Add person"), undefined, "the Add person dialog closed");

    // Nothing already typed in the expense dialog was lost.
    assert.equal(description.value, "Fictional picnic");

    const paidRow = shareRow(fieldsetByLegend(dialog, "Paid by"), "Carol Fictional");
    assert.ok(paidRow, "Carol appears under Paid by");
    assert.equal(paidRow.querySelector('input[type="checkbox"]').checked, false, "not marked as having paid, by default");

    const sharedFieldset = fieldsetByLegend(dialog, "Shared by");
    const sharedRow = shareRow(sharedFieldset, "Carol Fictional");
    assert.ok(sharedRow, "Carol appears under Shared by");
    assert.equal(sharedRow.querySelector('input[type="checkbox"]').checked, true, "checked under Shared by — the reason to add someone here is that they took part");

    // The new row is genuinely wired up: ticking it recomputes the live preview like any other row.
    const amountInput = dialog.querySelector('input[placeholder="0.00 or 12.50+3.20"]');
    amountInput.value = "30";
    amountInput.dispatchEvent(new DomEvent("input"));
    const shares = dialog.querySelectorAll(".split-row__share").map((n) => n.textContent);
    assert.equal(shares.length, 3, "Alice, Bob and the newly added Carol all have a share row");
  });
});
