// BT-009-26 — Splitwise import, in the browser code: the "Import from Splitwise…" dialog's three
// steps (choose a file, map Splitwise's own named people to real participants, review and confirm),
// and the real requests it sends. No live Splitwise account or credentials are used — the file is
// read entirely client-side. All names are fictional.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { createView as createGroupView } from "../js/ui/views/group.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);

function ctxWith({ previewResult, confirmResult } = {}) {
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
  const defaultPreview = {
    header: ["Date", "Description", "Category", "Cost", "Currency", "Alice", "Bob"], personColumns: ["Alice", "Bob"],
    rows: [{ index: 0, ok: true, kind: "expense", raw: { description: "Fictional Dinner" }, date: "2026-09-01", amount: "90.00", currency: "EUR", duplicateOf: null, roundingNote: null }],
    summary: { total: 1, importable: 1, duplicates: 0, refused: 0 },
  };
  const api = {
    previewSplitwiseImport: async (ws, body) => { calls.push({ kind: "preview", ws, body }); return previewResult || defaultPreview; },
    confirmSplitwiseImport: async (ws, body) => { calls.push({ kind: "confirm", ws, body }); return confirmResult || { imported: [{ index: 0, kind: "expense", id: "gex_1" }], skipped: [] }; },
  };
  const store = {
    getState: () => state,
    actions: { write: async (fn) => { const result = await fn("ws_1"); return { ok: true, result }; }, refreshGroup: async () => {} },
  };
  return { ctx: { store, api }, state, calls };
}

// domdouble has no real File API, so the file input's own `files`/`.text()` are stubbed directly —
// the same shape the browser's own File object exposes to `renderChoose`'s change handler.
function attachFakeFile(dialog, text) {
  const input = dialog.querySelector('input[type="file"]');
  input.files = [{ text: async () => text }];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

describe("BT-009-26 Splitwise import dialog", () => {
  test("Import from Splitwise… opens a dialog that discloses this reads a CSV file and imports nothing until confirmed", () => {
    const { ctx, state } = ctxWith();
    const v = createGroupView(ctx);
    v.update(state);
    buttonNamed(v.element, "Import from Splitwise…").click();
    const dialog = document.body.querySelector(".modal");
    assert.match(dialog.textContent, /Splitwise/);
    assert.match(dialog.textContent, /Nothing is imported until you review and confirm it/);
    assert.ok(dialog.querySelector('input[type="file"]'));
  });

  test("choosing a file previews it, then shows a mapping field for each Splitwise person column", async () => {
    const { ctx, state, calls } = ctxWith();
    const v = createGroupView(ctx);
    v.update(state);
    buttonNamed(v.element, "Import from Splitwise…").click();
    const dialog = document.body.querySelector(".modal");
    attachFakeFile(dialog, "Date,Description,Category,Cost,Currency,Alice,Bob\n2026-09-01,Fictional Dinner,Food,90.00,EUR,60.00,-30.00");
    await tick();
    const preview = calls.find((c) => c.kind === "preview");
    assert.equal(preview.body.csv.includes("Fictional Dinner"), true);
    assert.match(dialog.textContent, /Match each person Splitwise names/);
    assert.match(dialog.textContent, /Alice/);
    assert.match(dialog.textContent, /Bob/);
    assert.ok(buttonNamed(dialog, "Preview import…"));
  });

  test("Preview import… fetches the review with the real mapping, and Import selected sends the real csv/mapping/rows", async () => {
    const { ctx, state, calls } = ctxWith();
    const v = createGroupView(ctx);
    v.update(state);
    buttonNamed(v.element, "Import from Splitwise…").click();
    const dialog = document.body.querySelector(".modal");
    attachFakeFile(dialog, "Date,Description,Category,Cost,Currency,Alice,Bob\n2026-09-01,Fictional Dinner,Food,90.00,EUR,60.00,-30.00");
    await tick();
    buttonNamed(dialog, "Preview import…").click();
    await tick();
    assert.match(dialog.textContent, /can be imported as shown/);
    assert.match(dialog.textContent, /Fictional Dinner/);
    const importBtn = buttonNamed(dialog, "Import selected");
    assert.ok(importBtn);
    importBtn.click();
    await tick();
    const confirmed = calls.find((c) => c.kind === "confirm");
    assert.ok(confirmed, "Import selected sends the confirm-import request");
    assert.deepEqual(confirmed.body.rows, [0]);
    assert.equal(confirmed.body.csv.includes("Fictional Dinner"), true);
  });

  test("a refused row is shown with its reason and its checkbox starts unchecked, never silently imported", async () => {
    const previewResult = {
      header: ["Date", "Description", "Category", "Cost", "Currency", "Alice", "Bob"], personColumns: ["Alice", "Bob"],
      rows: [{ index: 0, ok: false, reason: "unsupported_currency", message: "This workspace's shared expenses are recorded in EUR.", raw: { description: "Fictional Taxi" } }],
      summary: { total: 1, importable: 0, duplicates: 0, refused: 1 },
    };
    const { ctx, state, calls } = ctxWith({ previewResult });
    const v = createGroupView(ctx);
    v.update(state);
    buttonNamed(v.element, "Import from Splitwise…").click();
    const dialog = document.body.querySelector(".modal");
    attachFakeFile(dialog, "Date,Description,Category,Cost,Currency,Alice,Bob\n2026-09-03,Fictional Taxi,Travel,50.00,USD,25.00,-25.00");
    await tick();
    buttonNamed(dialog, "Preview import…").click();
    await tick();
    assert.match(dialog.textContent, /This workspace's shared expenses are recorded in EUR/);
    const cb = dialog.querySelector('input[type="checkbox"]');
    assert.equal(cb.checked, false);
    assert.equal(cb.disabled, true);
    buttonNamed(dialog, "Import selected").click();
    await tick();
    assert.equal(calls.some((c) => c.kind === "confirm"), false, "nothing to import — no request is sent, and the dialog says so");
  });
});
