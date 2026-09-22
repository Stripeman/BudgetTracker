// BT-013-16 — the real Layout Preview: a client-only, ephemeral override (never a server write,
// never seen by another member), and the real safety net that refuses every OTHER write while it is
// active. Covered here: the store's own guard and actions directly, and the shell's persistent
// banner (present on every page, Apply/Exit, Apply visible to owners/managers only). Fictional data
// only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { createStore } from "../js/core/store.js";
import { createShell } from "../js/ui/shell.js";
import { createThemeController } from "../js/ui/theme.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

describe("BT-013-16 the store's own layout-preview override and its write guard", () => {
  function fakeApi() {
    const slice = (name) => async () => ({ [name]: [] });
    return {
      me: async () => ({ user: { name: "Alice Fictional" }, app: {}, site: null, workspaces: [{ id: "ws_1", name: "Fictional Household", status: "active", role: "owner" }], preferences: { effective: {}, sources: {} } }),
      workspaces: async () => ({ workspaces: [{ id: "ws_1", name: "Fictional Household", status: "active", role: "owner" }] }),
      accounts: slice("accounts"), categories: slice("categories"), payees: slice("payees"), members: slice("members"),
      icons: async () => ({ catalog: {}, catalogEtag: "e1", typeIcons: {} }),
    };
  }

  test("previewLayout/exitLayoutPreview set and clear state.layoutPreview; nothing is ever sent to the server", async () => {
    const store = createStore({ api: fakeApi() });
    await store.actions.init();
    assert.equal(store.getState().layoutPreview, null);
    store.actions.previewLayout("ledgerfly-forecast");
    assert.deepEqual(store.getState().layoutPreview, { layoutId: "ledgerfly-forecast" });
    store.actions.exitLayoutPreview();
    assert.equal(store.getState().layoutPreview, null);
  });

  test("while previewing, store.actions.write is refused UNLESS the caller explicitly allows it — a real safety net for every page, not a per-button check", async () => {
    const store = createStore({ api: fakeApi() });
    await store.actions.init();
    store.actions.previewLayout("acru-overview");
    const calls = [];
    const blocked = await store.actions.write(async (id) => { calls.push(id); return "should never run"; }, []);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, "preview_read_only");
    assert.deepEqual(calls, [], "the write function itself is never even called");
    const allowed = await store.actions.write(async (id) => { calls.push(id); return "ran"; }, [], { allowDuringPreview: true });
    assert.deepEqual([allowed.ok, allowed.result], [true, "ran"]);
    assert.deepEqual(calls, ["ws_1"]);
  });

  test("switching workspaces clears an active preview (the same synchronous reset selectedWorkspaceId already gets)", async () => {
    const api = fakeApi();
    api.workspaces = async () => ({ workspaces: [{ id: "ws_1", name: "A", status: "active", role: "owner" }, { id: "ws_2", name: "B", status: "active", role: "owner" }] });
    const store = createStore({ api });
    await store.actions.init();
    store.actions.previewLayout("finexa-budget");
    assert.ok(store.getState().layoutPreview);
    await store.actions.selectWorkspace("ws_2");
    assert.equal(store.getState().layoutPreview, null);
  });

  test("write's normal behaviour (no preview active) is completely unchanged", async () => {
    const store = createStore({ api: fakeApi() });
    await store.actions.init();
    const out = await store.actions.write(async () => "ok", []);
    assert.deepEqual([out.ok, out.result], [true, "ok"]);
  });
});

describe("BT-013-16 the shell's persistent Layout Preview banner", () => {
  function boot({ role = "owner", layoutPreview = null } = {}) {
    const state = {
      auth: { status: "ready", user: { name: "Alice Fictional" } },
      workspaces: [{ id: "ws_1", name: "Fictional Household", status: "active", role }],
      selectedWorkspaceId: "ws_1", preferences: null, site: null, app: { version: "0.0.0-test", environment: "test" },
      layoutPreview,
    };
    const noop = async () => {};
    const calls = { exited: 0, patched: [], refreshed: 0 };
    const store = {
      getState: () => state,
      subscribe() {},
      actions: {
        selectWorkspace: noop, refreshTransactions: noop, refreshBills: noop, refreshForecast: noop, refreshGroup: noop,
        refreshWeekActivity: noop, refreshMonthActivity: noop, savePreferences: async () => ({ ok: true }),
        refreshWorkspaces: async () => { calls.refreshed += 1; },
        exitLayoutPreview: () => { calls.exited += 1; state.layoutPreview = null; shell.render(); },
        write: async (fn, refresh, opts) => { calls.patched.push({ opts }); const result = await fn("ws_1"); return { ok: true, result }; },
      },
    };
    const api = { request: async (route, o) => { calls.patched.push({ route, o }); return { workspace: {} }; } };
    const theme = createThemeController({ root: { setAttribute() {} }, storage: { getItem: () => null, setItem() {} }, media: { matches: false, addEventListener() {} } });
    const router = { current: () => ({ id: "dashboard", params: {} }), subscribe() {}, navigate() {} };
    const mountPoint = document.createElement("div");
    dom.body.appendChild(mountPoint);
    const shell = createShell({ mountPoint, store, router, theme, api });
    shell.render();
    return { root: mountPoint, shell, calls, state };
  }

  const bannerOf = (root) => root.querySelector(".preview-banner");
  const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);

  test("hidden when not previewing; shown, named, and identifies the workspace and layout, while previewing", () => {
    const { root } = boot({ layoutPreview: null });
    assert.equal(bannerOf(root).hidden, true);
  });

  test("shows the real layout name and workspace name; Apply is offered to an owner", () => {
    const { root } = boot({ role: "owner", layoutPreview: { layoutId: "ledgerfly-forecast" } });
    const banner = bannerOf(root);
    assert.equal(banner.hidden, false);
    assert.match(banner.textContent, /Executive Forecast/);
    assert.match(banner.textContent, /Fictional Household/);
    assert.match(banner.textContent, /read-only/);
    assert.ok(buttonNamed(root, "Apply to workspace"));
    assert.ok(buttonNamed(root, "Exit preview"));
  });

  test("a plain member never sees Apply, only Exit — they may preview but never change the shared default", () => {
    const { root } = boot({ role: "member", layoutPreview: { layoutId: "finexa-budget" } });
    const applyBtn = buttonNamed(root, "Apply to workspace");
    assert.ok(!applyBtn || applyBtn.hidden);
    assert.ok(buttonNamed(root, "Exit preview"));
  });

  test("Exit preview clears the override and hides the banner, with no server call at all", () => {
    const { root, calls } = boot({ layoutPreview: { layoutId: "acru-overview" } });
    buttonNamed(root, "Exit preview").click();
    assert.equal(calls.exited, 1);
    assert.deepEqual(calls.patched, [], "exiting a preview never calls the server");
    assert.equal(bannerOf(root).hidden, true);
  });

  test("Apply sends the real settings PATCH with allowDuringPreview, the one write allowed through", async () => {
    const { root, calls } = boot({ layoutPreview: { layoutId: "acru-overview" } });
    buttonNamed(root, "Apply to workspace").click();
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
    const call = calls.patched.find((c) => c.opts && c.opts.allowDuringPreview);
    assert.ok(call, "the apply write is explicitly marked allowDuringPreview");
    assert.equal(calls.exited, 1, "a successful apply exits the preview");
  });
});
