// BT-009-25 — saved split presets in the shared-expense dialog: choosing one replaces who is
// checked and their values; saving the current split offers it next time. All names are fictional.
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
const fieldsetByLegend = (root, text) => root.querySelectorAll("fieldset").find((f) => f.querySelector("legend") && f.querySelector("legend").textContent === text);
const shareRow = (dialog, name) => fieldsetByLegend(dialog, "Shared by").querySelectorAll(".split-row").find((r) => r.querySelector("label") && r.querySelector("label").textContent.startsWith(name));

function fakeCtx({ splitPresets = [] } = {}) {
  const calls = [];
  const people = [
    { ref: "member:a", name: "Alice", type: "member", self: true, active: true },
    { ref: "member:b", name: "Bob", type: "member", self: false, active: true },
    { ref: "member:c", name: "Carol", type: "member", self: false, active: true },
  ];
  const state = {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Housemates", kind: "group", role: "owner" }],
    preferences: null,
    group: { workspaceId: "ws_1", status: "ready", error: null, data: { currency: "EUR", permissions: { canAdd: true, selfRef: "member:a", role: "owner" }, participants: people, expenses: [], settlements: [], balances: [], splitPresets } },
    accounts: { workspaceId: "ws_1", status: "ready", error: null, data: { accounts: [], totals: [] } },
    categories: { workspaceId: "ws_1", status: "ready", error: null, data: { categories: [] } },
  };
  const api = {
    createGroupExpense: async (ws, body) => { calls.push({ kind: "create", body }); return { expense: {} }; },
    createSplitPreset: async (ws, body) => { calls.push({ kind: "save-preset", body }); return { preset: { id: "gsp_new1", name: body.name } }; },
  };
  const store = { getState: () => state, actions: { write: async (fn) => { const result = await fn("ws_1"); return { ok: true, result }; }, refreshGroup: async () => {} } };
  return { ctx: { store, api }, calls };
}

describe("BT-009-25 saved split presets in the shared-expense dialog", () => {
  test("with no presets saved yet, no picker is offered", () => {
    const { ctx } = fakeCtx({ splitPresets: [] });
    const dialog = openGroupExpense(ctx).element;
    assert.equal(dialog.querySelectorAll("label").find((l) => l.textContent === "Use a saved split"), undefined);
  });

  test("choosing a preset replaces who is checked and their split values", async () => {
    const preset = { id: "gsp_1", name: "Bob and Carol, 60/40", method: "percentages", lines: [{ ref: "member:b", value: "60" }, { ref: "member:c", value: "40" }] };
    const { ctx } = fakeCtx({ splitPresets: [preset] });
    const dialog = openGroupExpense(ctx).element;
    // Alice is checked by default (the caller's own default "everyone"); the preset replaces that.
    assert.equal(shareRow(dialog, "Alice").querySelector('input[type="checkbox"]').checked, true);
    const picker = dialog.querySelectorAll("select").find((s) => s.querySelectorAll("option").some((o) => o.value === "gsp_1"));
    picker.value = "gsp_1";
    picker.dispatchEvent(new DomEvent("change", { bubbles: true }));
    assert.equal(shareRow(dialog, "Alice").querySelector('input[type="checkbox"]').checked, false, "the preset does not include Alice");
    assert.equal(shareRow(dialog, "Bob").querySelector('input[type="checkbox"]').checked, true);
    assert.equal(shareRow(dialog, "Bob").querySelector('input[type="text"]').value, "60");
    assert.equal(shareRow(dialog, "Carol").querySelector('input[type="text"]').value, "40");
    const splitMethodSelect = dialog.querySelectorAll("select").find((s) => s.querySelectorAll("option").some((o) => o.value === "percentages"));
    assert.equal(splitMethodSelect.value, "percentages");
  });

  test("saving the current split as a preset sends the right method/lines contract and never sends a money-shaped split", async () => {
    const { ctx, calls } = fakeCtx();
    const dialog = openGroupExpense(ctx).element;
    // By shares: Bob 2 shares, Carol 1 share (Alice unchecked).
    const splitMethodSelect = dialog.querySelectorAll("select").find((s) => s.querySelectorAll("option").some((o) => o.value === "shares"));
    splitMethodSelect.value = "shares";
    splitMethodSelect.dispatchEvent(new DomEvent("change", { bubbles: true }));
    shareRow(dialog, "Alice").querySelector('input[type="checkbox"]').click();
    type(shareRow(dialog, "Bob").querySelector('input[type="text"]'), "2");
    type(shareRow(dialog, "Carol").querySelector('input[type="text"]'), "1");
    buttonNamed(dialog, "Save this split as a preset…").click();
    // Two ".modal" elements exist now — the original Add-expense dialog AND this new nested one —
    // found by its own title, not position (the established pattern for a dialog opened from
    // within another already-open dialog, e.g. addperson.test.js).
    const modal = document.body.querySelectorAll(".modal").find((m) => m.querySelector("h2").textContent === "Save this split as a preset");
    type(modal.querySelector("input"), "Bob and Carol, 2:1");
    buttonNamed(modal, "Save preset").click();
    await tick();
    const saved = calls.find((c) => c.kind === "save-preset");
    assert.equal(saved.body.name, "Bob and Carol, 2:1");
    assert.equal(saved.body.method, "shares");
    assert.deepEqual(saved.body.lines, [{ ref: "member:b", value: 2 }, { ref: "member:c", value: 1 }]);
  });

  test("a money-shaped split (fixed amounts) cannot be saved as a preset — it says so, and sends nothing", async () => {
    const { ctx, calls } = fakeCtx();
    const dialog = openGroupExpense(ctx).element;
    const splitMethodSelect = dialog.querySelectorAll("select").find((s) => s.querySelectorAll("option").some((o) => o.value === "fixed-remainder"));
    splitMethodSelect.value = "fixed-remainder";
    splitMethodSelect.dispatchEvent(new DomEvent("change", { bubbles: true }));
    buttonNamed(dialog, "Save this split as a preset…").click();
    await tick();
    // The original Add-expense dialog is itself a ".modal" — a bare selector would always find
    // it; the real check is that no SECOND, nested "Save this split as a preset" dialog opened.
    assert.equal(document.body.querySelectorAll(".modal").find((m) => m.querySelector("h2").textContent === "Save this split as a preset"), undefined, "no save-preset dialog opens for a money-shaped split");
    assert.equal(calls.find((c) => c.kind === "save-preset"), undefined);
  });
});
