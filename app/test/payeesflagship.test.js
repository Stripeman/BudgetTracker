// BT-013-16 — the Merchants page under each flagship layout. The real merchant list — every real
// action (Edit, History, Close/Reopen, Delete permanently) — and the pending-merchants panel stay
// completely shared and unchanged; only the surrounding card wrapper per layout differs. Fictional
// data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { createView } from "../js/ui/views/payees.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

function ready(data) { return { workspaceId: "ws_1", status: "ready", error: null, data }; }

function baseState(layoutId, overrides = {}) {
  return {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Household", kind: "household", role: "owner", settingValues: { layoutId } }],
    preferences: null, layoutPreview: null,
    payees: ready({ payees: [{ id: "p_1", name: "E2E Fictional Grocer", status: "active", visibility: "shared", icon: "store", canEdit: true, stats: [{ currency: "EUR", gross: "42.50", refunds: "0.00", net: "42.50", count: 1, lastDate: "2026-09-20" }] }] }),
    bills: ready({ recurring: [] }),
    ...overrides,
  };
}

function boot(state) {
  const store = { getState: () => state, actions: { refreshPayees: async () => {}, refreshBills: async () => {} } };
  const view = createView({ store, api: {}, navigate: () => {} });
  dom.body.appendChild(view.element);
  view.update(state);
  return { view };
}

describe("BT-013-16 Merchants renders the workspace's real, applied layout", () => {
  test("Classic never shows the flagship wrapper", () => {
    const { view } = boot(baseState("classic"));
    assert.equal(view.element.querySelector(".dashflag"), null);
  });

  for (const layoutId of ["ledgerfly-forecast", "finexa-budget", "acru-overview"]) {
    test(`${layoutId}: the real merchant row (with its real spend figure and actions menu) survives, unchanged`, () => {
      const { view } = boot(baseState(layoutId));
      const flag = view.element.querySelector(".dashflag");
      assert.ok(flag);
      assert.match(flag.textContent, /E2E Fictional Grocer/);
      assert.match(flag.textContent, /EUR 42\.50/);
      assert.ok(flag.querySelector("table.table"), "the real merchants table is still present");
    });
  }

  test("an unknown/demo-only layoutId falls back to Classic", () => {
    const { view } = boot(baseState("focus-mode"));
    assert.equal(view.element.querySelector(".dashflag"), null);
    assert.match(view.element.textContent, /E2E Fictional Grocer/);
  });

  test("previewing disables Add merchant with an explanation, in every layout", () => {
    for (const layoutId of ["classic", "acru-overview"]) {
      dom.teardown(); dom = installDom();
      const { view } = boot(baseState(layoutId, { layoutPreview: { layoutId: "finexa-budget" } }));
      const head = view.element.querySelector(".page-head__actions");
      const addBtn = head && head.querySelector("button");
      assert.ok(addBtn && addBtn.disabled, layoutId);
    }
  });
});
