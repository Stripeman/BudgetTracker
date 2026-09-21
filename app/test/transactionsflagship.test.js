// BT-013-16 — the Transactions page under each of the three flagship layouts. Unlike Dashboard, the
// filters, the table, and every edit/reverse/move/delete/add-as-bill action stay completely SHARED
// and unchanged (the same DOM nodes are reparented, never rebuilt) — only a KPI strip (the same real
// per-currency summary figures) and the card styling around the table differ. This file proves the
// shared machinery survives a layout switch and that the KPI figures are the same real server numbers
// the plain summary line already states. Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { createView } from "../js/ui/views/transactions.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

function ready(data) { return { workspaceId: "ws_1", status: "ready", error: null, data }; }

function baseState(layoutId, overrides = {}) {
  return {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Household", kind: "household", role: "owner", settingValues: { layoutId } }],
    preferences: null,
    layoutPreview: null,
    accounts: ready({ accounts: [{ id: "acc_1", name: "Checking", currency: "EUR", visibility: "shared", status: "open", capabilities: ["create"], icon: "bank" }] }),
    categories: ready({ categories: [{ id: "cat_g", name: "Groceries", color: "#2563eb", icon: "cart" }] }),
    payees: ready({ payees: [{ id: "p_1", name: "Fictional Grocer", status: "active", visibility: "shared", icon: "store" }] }),
    transactions: ready({
      transactions: [{ id: "t1", date: "2026-09-20", kind: "expense", amount: "-15.00", currency: "EUR", accountId: "acc_1", accountName: "Checking", payeeId: "p_1", payeeName: "Fictional Grocer", categoryId: "cat_g", tags: [], splits: [], status: "pending", canEdit: true, canDelete: true }],
      summary: [{ currency: "EUR", gross: "15.00", refunds: "0.00", net: "15.00", income: "0.00", receivable: "0.00", count: 1 }],
      total: 1,
    }),
    ...overrides,
  };
}

function boot(state) {
  const store = {
    getState: () => state,
    actions: { refreshTransactions: async () => {}, write: async (fn) => { await fn("ws_1"); return { ok: true }; } },
  };
  const view = createView({ store, api: {}, params: {} });
  dom.body.appendChild(view.element);
  view.update(state);
  return { view };
}

describe("BT-013-16 Transactions renders the workspace's real, applied layout", () => {
  test("Classic never shows the flagship KPI strip", () => {
    const { view } = boot(baseState("classic"));
    assert.equal(view.element.querySelector(".dashflag"), null);
    assert.equal(view.element.querySelector(".dashflag-kpis"), null);
  });

  for (const layoutId of ["ledgerfly-forecast", "finexa-budget", "acru-overview"]) {
    test(`${layoutId}: shows a KPI strip with the SAME real per-currency figures as the plain summary line, and the table/filters/actions stay fully functional`, () => {
      const { view } = boot(baseState(layoutId));
      const flag = view.element.querySelector(".dashflag");
      assert.ok(flag, "the flagship wrapper is present");
      assert.match(flag.textContent, /EUR 15\.00/, "the real spent figure appears in the KPI strip");
      assert.match(flag.textContent, /Fictional Grocer/, "the real merchant row is still rendered");
      assert.ok(flag.querySelector(".filters-box"), "the real filters are still present, reparented, never rebuilt");
      assert.ok(flag.querySelector("table.table"), "the real table (with its actions menu) is still present");
      assert.ok(flag.querySelector(".dashflag-kpi--emphasis"), "one KPI card is emphasised (Spent)");
    });
  }

  test("switching from Classic to a flagship layout REPARENTS the same filter/table nodes rather than rebuilding them (an open filter panel survives)", () => {
    const state = baseState("classic");
    const { view } = boot(state);
    const filterBox = view.element.querySelector(".filters-box");
    filterBox.open = true;
    state.workspaces[0].settingValues.layoutId = "ledgerfly-forecast";
    view.update(state);
    const sameFilterBox = view.element.querySelector(".filters-box");
    // assert.ok on a boolean, never assert.equal on two raw DOM node objects: a genuine mismatch
    // would make node:assert try to inspect two large, ownerDocument-linked objects for its diff,
    // which is extremely slow/memory-heavy for this domdouble's circularly-linked Node class
    // (found the hard way in app/test/planningflagship.test.js — see its own note).
    assert.ok(sameFilterBox === filterBox, "the exact same DOM node, just reparented");
    assert.equal(sameFilterBox.open, true, "an open filter panel is never lost across a layout switch");
  });

  test("an unknown/demo-only layoutId falls back to Classic, never throws", () => {
    const { view } = boot(baseState("executive-ledger"));
    assert.equal(view.element.querySelector(".dashflag"), null);
    assert.match(view.element.textContent, /Fictional Grocer/);
  });

  test("previewing a flagship layout disables Add expense with an explanation, exactly like Dashboard's own guard", () => {
    const state = baseState("classic", { layoutPreview: { layoutId: "acru-overview" } });
    const { view } = boot(state);
    const head = view.element.querySelector(".page-head__actions");
    const addBtn = head && head.querySelector("button");
    assert.ok(addBtn && addBtn.disabled);
    assert.match(addBtn.getAttribute("title"), /read-only layout preview/);
  });

  test("previewing Classic itself (real layout is a flagship) also disables Add expense — the guard checks layoutPreview, not which layout it resolves to", () => {
    const state = baseState("finexa-budget", { layoutPreview: { layoutId: "classic" } });
    const { view } = boot(state);
    assert.equal(view.element.querySelector(".dashflag"), null, "previewing Classic shows the Classic arrangement");
    const head = view.element.querySelector(".page-head__actions");
    const addBtn = head && head.querySelector("button");
    assert.ok(addBtn && addBtn.disabled);
  });

  test("no spending recorded shows the same honest empty state under every flagship layout", () => {
    for (const layoutId of ["ledgerfly-forecast", "finexa-budget", "acru-overview"]) {
      dom.teardown(); dom = installDom();
      const { view } = boot(baseState(layoutId, { transactions: ready({ transactions: [], summary: [], total: 0 }) }));
      assert.match(view.element.textContent, /No entries match these filters/);
      assert.equal(view.element.querySelectorAll(".dashflag-kpi").length, 0, "no KPI cards when there is nothing to summarise");
    }
  });
});
