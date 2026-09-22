// BT-013-16 — Workspace settings (the page where the real Layout Picker itself lives) under each
// flagship layout. This page is already a `.grid.grid--two` of individually-carded sections
// (Members, Invite, Workspace settings, Layout, Backups and restore, Recent activity, Former
// members, Workspace changes, Category colours and icons, Account/Category/Merchant types, Icons for
// types); every one of them, and everything inside them, stays completely shared and unchanged. The
// SAME grid is reparented into a `.dashflag` accent wrapper for flagship layouts, the same minimal,
// low-risk pattern already used for Shared expenses and My Settings, given this page's size and
// permission-sensitive content (members, invitations, backups/restore, permanent deletion).
// Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { createView } from "../js/ui/views/workspace.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

function ready(data) { return { workspaceId: "ws_1", status: "ready", error: null, data }; }

function baseState(layoutId, overrides = {}) {
  return {
    selectedWorkspaceId: "ws_1",
    workspaces: [{ id: "ws_1", name: "Fictional Household", kind: "household", role: "owner", settingValues: { layoutId } }],
    preferences: null, layoutPreview: null,
    members: ready({ members: [{ id: "m_me", name: "Alice Fictional", role: "owner", self: true }] }),
    categories: ready({ categories: [], palette: [] }),
    icons: ready({ typeIcons: {}, canEditTypeIcons: false, catalog: null }),
    accountTypes: ready({ types: [], accountingClasses: ["checking"], palette: [] }),
    categoryTypes: ready({ types: [], categoryClasses: ["expense"], palette: [] }),
    merchantTypes: ready({ types: [], merchantClasses: ["other"], palette: [] }),
    ...overrides,
  };
}

function boot(state) {
  const api = {
    request: async (name) => {
      if (name === "workspaces") return { workspace: { settings: {}, settingsList: [], settingsHistory: [], history: [], lifecycle: [] } };
      if (name === "members") return { former: [] };
      return {};
    },
    workspaceLayouts: async () => ({ workspaceId: "ws_1", currentLayoutId: "classic", canApply: true, canManage: true, layouts: [], demoLayouts: [] }),
    invitations: async () => ({ invitations: [] }), backups: async () => ({ archives: [], policy: "" }), audit: async () => ({ entries: [] }),
  };
  const store = { getState: () => state, actions: { write: async (fn) => { try { await fn("ws_1"); return { ok: true }; } catch (error) { return { ok: false, error }; } }, refreshWorkspaces: async () => ({ ok: true }) } };
  const view = createView({ api, store });
  dom.body.appendChild(view.element);
  view.update(state);
  return { view };
}

describe("BT-013-16 Workspace settings renders the workspace's real, applied layout", () => {
  test("Classic never shows the flagship wrapper", async () => {
    const { view } = boot(baseState("classic"));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(view.element.querySelector(".dashflag"), null);
  });

  for (const layoutId of ["ledgerfly-forecast", "finexa-budget", "acru-overview"]) {
    test(`${layoutId}: every real card (Members, Layout, Backups and restore) survives inside the flagship wrapper, unchanged`, async () => {
      const { view } = boot(baseState(layoutId));
      await new Promise((r) => setTimeout(r, 0));
      const flag = view.element.querySelector(".dashflag");
      assert.ok(flag);
      assert.ok(flag.querySelector("section[aria-labelledby='ws-members']"), "Members");
      assert.ok(flag.querySelector("section[aria-labelledby='ws-layout']"), "the real Layout Picker card itself");
      assert.ok(flag.querySelector("section[aria-labelledby='ws-backups']"), "Backups and restore");
      assert.match(flag.textContent, /Alice Fictional/);
    });
  }

  test("an unknown/demo-only layoutId falls back to Classic", async () => {
    const { view } = boot(baseState("analyst-workspace"));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(view.element.querySelector(".dashflag"), null);
    assert.ok(view.element.querySelector("section[aria-labelledby='ws-layout']"));
  });

  test("switching layouts keeps the real Layout Picker card working (the grid is reparented as one unit, never rebuilt)", async () => {
    const state = baseState("classic");
    const { view } = boot(state);
    await new Promise((r) => setTimeout(r, 0));
    state.workspaces[0].settingValues.layoutId = "finexa-budget";
    view.update(state);
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(view.element.querySelector(".dashflag"));
    assert.ok(view.element.querySelector("section[aria-labelledby='ws-layout']"));
  });
});
