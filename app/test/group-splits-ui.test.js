// BT-009-25 — "Fixed amounts, then split the rest" in the Add/correct shared-expense dialog: a
// blank per-person value shares whatever is left, equally; a filled-in value is kept exactly. All
// names are fictional.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { openGroupExpense } from "../js/ui/views/group.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const type = (node, value) => { node.value = value; node.dispatchEvent(new DomEvent("input", { bubbles: true })); };
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
// By legend text, not position or a bare ".split-row" search: "Paid by" and "Shared by" are two
// separate fieldsets that can each have a person of the same name in their own row.
const fieldsetByLegend = (root, text) => root.querySelectorAll("fieldset").find((f) => f.querySelector("legend") && f.querySelector("legend").textContent === text);
const shareRow = (dialog, name) => fieldsetByLegend(dialog, "Shared by").querySelectorAll(".split-row").find((r) => r.querySelector("label") && r.querySelector("label").textContent.startsWith(name));

function fakeCtx() {
  const creates = [];
  const people = [
    { ref: "member:a", name: "Alice", type: "member", self: true, active: true },
    { ref: "member:b", name: "Bob", type: "member", self: false, active: true },
    { ref: "member:c", name: "Carol", type: "member", self: false, active: true },
  ];
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Cabin Club", kind: "group", role: "owner" }],
    preferences: null,
    group: { workspaceId: "ws_1", status: "ready", error: null, data: { currency: "EUR", permissions: { canAdd: true, selfRef: "member:a", role: "owner" }, participants: people, expenses: [], settlements: [], balances: [] } },
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts: [], totals: [] } },
    categories: { workspaceId: "ws_1", status: "ready", error: null, data: { categories: [] } },
  };
  const api = { createGroupExpense: async (ws, body) => { creates.push(body); return { expense: {} }; } };
  const store = { getState: () => state, actions: { write: async (fn) => { const result = await fn("ws_1"); return { ok: true, result }; }, refreshGroup: async () => {} } };
  return { ctx: { store, api }, creates };
}

describe('BT-009-25 "Fixed amounts, then split the rest" in the shared-expense dialog', () => {
  test("a fixed amount for one person and a blank value for the others sends exactly that contract to the server", async () => {
    const { ctx, creates } = fakeCtx();
    const dialog = openGroupExpense(ctx).element;
    type(dialog.querySelector('input[placeholder="For example: Dinner at the harbour"]'), "Cabin weekend");
    type(dialog.querySelector('input[placeholder="0.00 or 12.50+3.20"]'), "100.00");
    const split = dialog.querySelectorAll("select").find((s) => s.querySelectorAll("option").some((o) => o.value === "fixed-remainder"));
    split.value = "fixed-remainder";
    split.dispatchEvent(new DomEvent("change", { bubbles: true }));
    // Alice fixed at 30.00; Bob and Carol left blank to share the 70.00 remainder.
    type(dialog.querySelector('input[aria-label="Fixed amount for Alice"]'), "30.00");
    const bobShare = shareRow(dialog, "Bob").querySelector(".split-row__share").textContent;
    assert.match(bobShare, /35\.00/, "the live preview computes Bob's share of the 70.00 remainder, split equally");
    assert.equal(dialog.querySelector(".split-preview").textContent, "The shares add up to exactly EUR 100.00.");
    buttonNamed(dialog, "Save expense").click();
    await tick();
    assert.equal(creates.length, 1);
    assert.deepEqual(creates[0].split, {
      method: "fixed-remainder",
      lines: [{ ref: "member:a", value: "30.00" }, { ref: "member:b" }, { ref: "member:c" }],
    });
  });

  test("fixed amounts adding up to more than the expense are refused inside the dialog, before anything is sent", async () => {
    const { ctx, creates } = fakeCtx();
    const dialog = openGroupExpense(ctx).element;
    type(dialog.querySelector('input[placeholder="For example: Dinner at the harbour"]'), "Cabin weekend");
    type(dialog.querySelector('input[placeholder="0.00 or 12.50+3.20"]'), "50.00");
    const split = dialog.querySelectorAll("select").find((s) => s.querySelectorAll("option").some((o) => o.value === "fixed-remainder"));
    split.value = "fixed-remainder";
    split.dispatchEvent(new DomEvent("change", { bubbles: true }));
    type(dialog.querySelector('input[aria-label="Fixed amount for Alice"]'), "30.00");
    type(dialog.querySelector('input[aria-label="Fixed amount for Bob"]'), "30.00");
    // Carol is unchecked by default for a new expense unless active — ensure she is included and blank.
    const carol = shareRow(dialog, "Carol");
    if (!carol.querySelector('input[type="checkbox"]').checked) carol.querySelector('input[type="checkbox"]').click();
    assert.equal(dialog.querySelector(".split-problems").textContent, "The fixed amounts add up to 60.00, more than the expense's 50.00.");
    buttonNamed(dialog, "Save expense").click();
    await tick();
    assert.equal(creates.length, 0, "never sent while the dialog's own preview shows a problem");
  });
});
