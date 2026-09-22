// BT-021 (Terry, 2026-09-22): the Workspace page's own "General" / "Layout & colours" /
// "Categories & types" sub-tabs — real ARIA tabs (role="tablist"/"tab"/"tabpanel"), automatic
// activation (arrow keys move AND select, matching the WAI-ARIA APG tabs pattern), remembered per
// browser, and a setting deep link always lands on General regardless of the remembered tab (the
// Workspace settings card that focus targets lives there). Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { createView as createWorkspace } from "../js/ui/views/workspace.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => { dom.teardown(); delete globalThis.localStorage; });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 5; i += 1) await tick(); };
const fire = (node, type, init) => node.dispatchEvent(new DomEvent(type, { bubbles: true, ...init }));

function fixture({ params } = {}) {
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  const state = {
    selectedWorkspaceId: "ws_1", preferences: null,
    workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner" }],
    members: ready({ members: [{ id: "m_me", name: "Me Fictional", role: "owner", self: true }] }),
    categories: ready({ categories: [], palette: [] }), icons: ready({ typeIcons: {}, canEditTypeIcons: false, catalog: null }),
    accountTypes: ready({ types: [], accountingClasses: ["checking"], palette: [] }),
    categoryTypes: ready({ types: [], categoryClasses: ["expense", "income"], palette: [] }),
    merchantTypes: ready({ types: [], merchantClasses: ["retailer"], palette: [] }),
  };
  const api = {
    invitations: async () => ({ invitations: [] }), backups: async () => ({ archives: [], policy: "" }), audit: async () => ({ entries: [] }),
    request: async (name) => {
      if (name === "workspaces") return { workspace: { history: [], lifecycle: [], settingsList: [{ key: "sharedExpenses", group: "Shared expenses", type: "boolean", label: "Use Shared expenses in this workspace", explanation: "x", value: true, default: true, changedBy: "manager", canChange: true }], settingsHistory: [] } };
      if (name === "members") return { former: [] };
      return {};
    },
    workspaceLayouts: async () => ({ layouts: [], demoLayouts: [], canApply: false, canManage: false }),
  };
  const store = { getState: () => state, actions: {
    write: async (fn) => { try { await fn("ws_1"); return { ok: true }; } catch (error) { return { ok: false, error }; } },
    refreshWorkspaces: async () => ({ ok: true }),
  } };
  return { ctx: { api, store, params }, state };
}

async function open(options) {
  const { ctx, state } = fixture(options);
  const view = createWorkspace(ctx);
  dom.body.appendChild(view.element);
  view.update(state);
  await settle();
  return { view, root: view.element };
}

const tabs = (root) => root.querySelectorAll('[role="tab"]');
const tabNamed = (root, name) => tabs(root).find((t) => t.textContent === name);
const panelOf = (root, tab) => root.querySelector(`#${tab.getAttribute("aria-controls")}`);

describe("BT-021/BT-022 Workspace page: General / Layout & colours / Categories & types / Management sub-tabs", () => {
  test("four real tabs, General active by default: correct roving tabindex, aria-selected, and only its own panel visible", async () => {
    const { root } = await open();
    const list = root.querySelector('[role="tablist"]');
    assert.ok(list, "a real tablist exists");
    assert.equal(list.getAttribute("aria-label"), "Workspace sections");
    const all = tabs(root);
    assert.deepEqual(all.map((t) => t.textContent), ["General", "Layout & colours", "Categories & types", "Management"]);
    assert.deepEqual(all.map((t) => t.getAttribute("aria-selected")), ["true", "false", "false", "false"]);
    assert.deepEqual(all.map((t) => t.getAttribute("tabindex")), ["0", "-1", "-1", "-1"]);
    const general = tabNamed(root, "General");
    const appearance = tabNamed(root, "Layout & colours");
    assert.equal(panelOf(root, general).hidden, false);
    assert.equal(panelOf(root, appearance).hidden, true);
    // The General panel's own real content — Members — is there; Layout & colours' own real
    // content — Layout — is not shown while it is the hidden panel.
    assert.match(panelOf(root, general).textContent, /Members/);
    assert.doesNotMatch(panelOf(root, general).textContent, /Layout/);
  });

  test("BT-022: Management holds the renamed Soft Delete Workspace and PERMANENT deletion cards, and only those", async () => {
    const { root } = await open();
    const management = tabNamed(root, "Management");
    const panel = panelOf(root, management);
    assert.match(panel.textContent, /Soft Delete Workspace/);
    assert.match(panel.textContent, /Permanently Delete This workspace- \(Cannot be undone\)/);
    // Moved off every other tab: General/Layout & colours/Categories & types no longer show them.
    for (const name of ["General", "Layout & colours", "Categories & types"]) {
      const other = panelOf(root, tabNamed(root, name));
      assert.doesNotMatch(other.textContent, /Soft Delete Workspace/, name);
      assert.doesNotMatch(other.textContent, /Permanently Delete This workspace/, name);
    }
  });

  test("clicking a tab switches which panel is visible and updates aria-selected/tabindex on both", async () => {
    const { root } = await open();
    const general = tabNamed(root, "General");
    const appearance = tabNamed(root, "Layout & colours");
    fire(appearance, "click");
    assert.equal(appearance.getAttribute("aria-selected"), "true");
    assert.equal(appearance.getAttribute("tabindex"), "0");
    assert.equal(general.getAttribute("aria-selected"), "false");
    assert.equal(general.getAttribute("tabindex"), "-1");
    assert.equal(panelOf(root, appearance).hidden, false);
    assert.equal(panelOf(root, general).hidden, true);
    assert.match(panelOf(root, appearance).textContent, /Layout/);
  });

  test("keyboard: ArrowRight moves focus AND activates the next tab (automatic activation, WAI-ARIA APG), wraps around through all four; Home/End jump to the first/last", async () => {
    const { root } = await open();
    const general = tabNamed(root, "General");
    const management = tabNamed(root, "Management");
    fire(general, "keydown", { key: "ArrowRight" });
    let active = tabs(root).find((t) => t.getAttribute("aria-selected") === "true");
    assert.equal(active.textContent, "Layout & colours");
    assert.ok(root.ownerDocument.activeElement === active, "focus followed the activation");
    fire(active, "keydown", { key: "ArrowRight" });
    active = tabs(root).find((t) => t.getAttribute("aria-selected") === "true");
    assert.equal(active.textContent, "Categories & types");
    fire(active, "keydown", { key: "ArrowRight" });
    active = tabs(root).find((t) => t.getAttribute("aria-selected") === "true");
    assert.equal(active.textContent, "Management");
    // Wraps around: ArrowRight from the last tab goes back to the first.
    fire(active, "keydown", { key: "ArrowRight" });
    active = tabs(root).find((t) => t.getAttribute("aria-selected") === "true");
    assert.equal(active.textContent, "General");
    fire(general, "keydown", { key: "End" });
    active = tabs(root).find((t) => t.getAttribute("aria-selected") === "true");
    assert.equal(active.textContent, "Management");
    fire(management, "keydown", { key: "Home" });
    active = tabs(root).find((t) => t.getAttribute("aria-selected") === "true");
    assert.equal(active.textContent, "General");
  });

  test("ArrowLeft moves to the previous tab, wrapping from the first to the last (Management)", async () => {
    const { root } = await open();
    const general = tabNamed(root, "General");
    fire(general, "keydown", { key: "ArrowLeft" });
    const active = tabs(root).find((t) => t.getAttribute("aria-selected") === "true");
    assert.equal(active.textContent, "Management");
  });

  test("the chosen tab is remembered per browser: a fresh page instance opens on it again", async () => {
    const store = {};
    globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
    const { root } = await open();
    fire(tabNamed(root, "Categories & types"), "click");
    const { root: root2 } = await open();
    const remembered = tabs(root2).find((t) => t.getAttribute("aria-selected") === "true");
    assert.equal(remembered.textContent, "Categories & types");
  });

  test("a link naming a workspace setting always lands on General, whatever tab was last remembered, so the focused field is actually visible", async () => {
    const store = {};
    globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
    // Remember "Layout & colours" from an earlier visit.
    const first = await open();
    fire(tabNamed(first.root, "Layout & colours"), "click");
    // A fresh view opened from a link that names a setting (e.g. the Shared expenses "off" page).
    const { root } = await open({ params: { setting: "sharedExpenses" } });
    const active = tabs(root).find((t) => t.getAttribute("aria-selected") === "true");
    assert.equal(active.textContent, "General", "the setting's own card lives on General, so the link must land there even over a remembered tab");
  });
});
