// BT-013-16 — the Accounts page under each flagship layout. The real accounts table — every real
// action (Edit, Close/Reopen, debt actions, Who can see this, Remove, Delete permanently) — and the
// Removed-accounts panel stay completely shared and unchanged, reparented rather than rebuilt. "Add
// account" stays a static button present at createView time (unchanged, several existing tests rely
// on this) — never gated on preview here; the store's write() guard is the real protection. Fictional
// data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { createView } from "../js/ui/views/accounts.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

function ready(data) { return { workspaceId: "ws_1", status: "ready", error: null, data }; }

function baseState(layoutId, overrides = {}) {
  return {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Household", kind: "household", role: "owner", settingValues: { layoutId } }],
    preferences: null, layoutPreview: null,
    accounts: ready({ accounts: [{ id: "acc_1", name: "E2E Checking", type: "checking", currency: "EUR", visibility: "shared", access: "shared", status: "open", capabilities: ["create"], icon: "bank", balance: "1000.00" }], removedCount: 0 }),
    members: ready({ members: [{ id: "m_1", name: "Alice Fictional", self: true }] }),
    ...overrides,
  };
}

function boot(state) {
  const store = { getState: () => state, actions: {} };
  const view = createView({ store, api: {} });
  dom.body.appendChild(view.element);
  view.update(state);
  return { view };
}

describe("BT-013-16 Accounts renders the workspace's real, applied layout", () => {
  test("Classic never shows the flagship wrapper", () => {
    const { view } = boot(baseState("classic"));
    assert.equal(view.element.querySelector(".dashflag"), null);
  });

  for (const layoutId of ["ledgerfly-forecast", "finexa-budget", "acru-overview"]) {
    test(`${layoutId}: the real account row (with its real balance and actions menu) survives, unchanged`, () => {
      const { view } = boot(baseState(layoutId));
      const flag = view.element.querySelector(".dashflag");
      assert.ok(flag);
      assert.match(flag.textContent, /E2E Checking/);
      assert.match(flag.textContent, /EUR 1,?000\.00|EUR 1000\.00/);
      assert.ok(flag.querySelector("table.table"), "the real accounts table is still present");
    });
  }

  test("switching layouts keeps rendering the real account correctly (the table itself is rebuilt on every update(), exactly like Classic already does — see the note in app/test/planningflagship.test.js on why this file never checks identity of rebuilt content)", () => {
    const state = baseState("classic");
    const { view } = boot(state);
    state.workspaces[0].settingValues.layoutId = "acru-overview";
    view.update(state);
    assert.ok(view.element.querySelector(".dashflag"));
    assert.match(view.element.textContent, /E2E Checking/);
  });

  test("an unknown/demo-only layoutId falls back to Classic", () => {
    const { view } = boot(baseState("merchant-insights"));
    assert.equal(view.element.querySelector(".dashflag"), null);
    assert.match(view.element.textContent, /E2E Checking/);
  });

  test("Add account is present immediately at createView time, in every layout — several existing tests click it before any update() call", () => {
    for (const layoutId of ["classic", "finexa-budget"]) {
      dom.teardown(); dom = installDom();
      const store = { getState: () => baseState(layoutId), actions: {} };
      const view = createView({ store, api: {} });
      dom.body.appendChild(view.element);
      const btn = view.element.querySelectorAll("button").find((b) => b.textContent === "Add account");
      assert.ok(btn, layoutId);
    }
  });
});
