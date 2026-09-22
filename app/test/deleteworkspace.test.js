// An owner deletes their own workspace, and brings it back from My settings (Terry, 2026-09-14: "the
// workspace owner should be able to delete their own workspace(s)"; no site-administrator delete).
// Underneath it is the recoverable archive: nothing is erased. Covered here: the store switches away
// through its synchronous reset and never opens a deleted workspace; the header and onboarding count only
// workspaces that are not deleted; the Workspace page offers "Delete workspace" to owners only, with a
// typed confirmation and errors inside the dialog; My settings lists "Deleted workspaces" with "Bring back".
// Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { createStore } from "../js/core/store.js";
import { createShell } from "../js/ui/shell.js";
import { createThemeController } from "../js/ui/theme.js";
import { createView as createWorkspace } from "../js/ui/views/workspace.js";
import { createView as createSettings } from "../js/ui/views/settings.js";
import { offeredOptions, pickerNamed } from "./pickerassert.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 6; i += 1) await tick(); };
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const labelled = (root, text) => { const l = root.querySelectorAll("label").find((x) => x.textContent === text); return l ? root.querySelector(`#${l.getAttribute("for")}`) : null; };

const HOME = { id: "ws_home", name: "Fictional household", status: "active", role: "owner" };
const TRIP = { id: "ws_trip", name: "Fictional trip", status: "active", role: "member" };
const OLD = { id: "ws_old", name: "Fictional old flat", status: "archived", role: "owner", archivedAt: "2026-09-13T10:00:00.000Z" };

// The API as the real store uses it; every call is recorded.
function fakeApi({ workspaces, preferred = "", refuseDelete = null, refuseRestore = null } = {}) {
  let list = workspaces.map((w) => ({ ...w }));
  const calls = [];
  const slice = (name) => async (id) => { calls.push([name, id]); return name === "icons" ? { catalog: {}, catalogEtag: "e1", typeIcons: {} } : { [name]: [] }; };
  const api = {
    me: async () => ({ user: { name: "Alice Fictional" }, app: {}, site: null, workspaces: list, preferences: { effective: { defaultWorkspaceId: preferred }, sources: {} } }),
    workspaces: async () => { calls.push(["workspaces"]); return { workspaces: list }; },
    accounts: slice("accounts"), categories: slice("categories"), payees: slice("payees"), members: slice("members"), icons: slice("icons"),
    deleteWorkspace: async (id, body) => {
      calls.push(["delete", id, body]);
      if (refuseDelete) throw refuseDelete;
      list = list.map((w) => (w.id === id ? { ...w, status: "archived" } : w)).filter((w) => w.status !== "archived" || w.role === "owner");
      return { workspace: list.find((w) => w.id === id) };
    },
    restoreWorkspace: async (id, body) => {
      calls.push(["restore", id, body]);
      if (refuseRestore) throw refuseRestore;
      list = list.map((w) => (w.id === id ? { ...w, status: "active", archivedAt: null } : w));
      return { workspace: list.find((w) => w.id === id) };
    },
  };
  return { api, calls };
}

describe("the store never opens a deleted workspace and switches away from one it deletes", () => {
  test("on start a deleted workspace is skipped, even when it is the default workspace", async () => {
    const { api, calls } = fakeApi({ workspaces: [OLD, HOME], preferred: "ws_old" });
    const store = createStore({ api });
    await store.actions.init();
    assert.equal(store.getState().selectedWorkspaceId, "ws_home");
    assert.ok(!calls.some((c) => c[1] === "ws_old"), "nothing is asked of the deleted workspace");
  });

  test("with only deleted workspaces none is opened (the person is offered to create one)", async () => {
    const { api, calls } = fakeApi({ workspaces: [OLD] });
    const store = createStore({ api });
    await store.actions.init();
    assert.equal(store.getState().selectedWorkspaceId, null);
    assert.deepEqual(calls, []);
  });

  test("deleting the open workspace sends the reason, then switches to the default (or first) other workspace with its data reset in the same step", async () => {
    const { api, calls } = fakeApi({ workspaces: [HOME, TRIP], preferred: "ws_trip" });
    const store = createStore({ api });
    await store.actions.init();
    await store.actions.selectWorkspace("ws_home");
    const seen = [];
    store.subscribe((s) => seen.push([s.selectedWorkspaceId, s.accounts.workspaceId, s.workspaces.map((w) => `${w.id}:${w.status}`).join(",")]));
    calls.length = 0;
    const out = await store.actions.deleteWorkspace("ws_home", "No longer needed");
    assert.equal(out.ok, true);
    assert.deepEqual(calls.slice(0, 2), [["delete", "ws_home", { reason: "No longer needed" }], ["workspaces"]]);
    // The first commit already names the new workspace, with its slices reset and the new list: nothing
    // from the deleted one can render in between.
    assert.deepEqual(seen[0], ["ws_trip", "ws_trip", "ws_home:archived,ws_trip:active"]);
    assert.equal(store.getState().selectedWorkspaceId, "ws_trip");
    assert.ok(calls.some((c) => c[0] === "accounts" && c[1] === "ws_trip"));
  });

  test("deleting the only workspace leaves none open and every slice empty", async () => {
    const { api } = fakeApi({ workspaces: [HOME] });
    const store = createStore({ api });
    await store.actions.init();
    assert.equal((await store.actions.deleteWorkspace("ws_home", "")).ok, true);
    const s = store.getState();
    assert.deepEqual([s.selectedWorkspaceId, s.accounts.workspaceId, s.accounts.status], [null, null, "idle"]);
  });

  test("a refused delete is reported and changes nothing", async () => {
    const refusal = Object.assign(new Error("Only an owner can archive a workspace."), { kind: "forbidden", status: 403 });
    const { api, calls } = fakeApi({ workspaces: [HOME, TRIP], refuseDelete: refusal });
    const store = createStore({ api });
    await store.actions.init();
    calls.length = 0;
    const out = await store.actions.deleteWorkspace("ws_home", "No longer needed");
    assert.equal(out.ok, false);
    assert.equal(out.error, refusal);
    assert.equal(store.getState().selectedWorkspaceId, "ws_home");
    assert.deepEqual(calls, [["delete", "ws_home", { reason: "No longer needed" }]]);
  });

  test("bringing one back re-reads the list; with no workspace open it opens the one brought back; a refusal is reported", async () => {
    const { api } = fakeApi({ workspaces: [OLD] });
    const store = createStore({ api });
    await store.actions.init();
    assert.equal((await store.actions.restoreWorkspace("ws_old")).ok, true);
    assert.deepEqual(store.getState().workspaces.map((w) => [w.id, w.status]), [["ws_old", "active"]]);
    assert.equal(store.getState().selectedWorkspaceId, "ws_old");
    const limit = Object.assign(new Error("You can have up to 20 active workspaces that you created. Delete one you no longer use, then bring this one back."), { kind: "conflict", status: 409, code: "workspace_limit" });
    const second = fakeApi({ workspaces: [HOME, OLD], refuseRestore: limit });
    const other = createStore({ api: second.api });
    await other.actions.init();
    const out = await other.actions.restoreWorkspace("ws_old");
    assert.deepEqual([out.ok, out.error], [false, limit]);
    assert.equal(other.getState().selectedWorkspaceId, "ws_home");
  });
});

function boot(workspaces, selectedWorkspaceId) {
  const state = { auth: { status: "ready", user: { name: "Alice Fictional" } }, workspaces, selectedWorkspaceId, preferences: null, site: null, app: { version: "0.0.0-test", environment: "test" } };
  const noop = async () => {};
  const store = { getState: () => state, subscribe() {}, actions: { selectWorkspace: noop, refreshTransactions: noop, refreshBills: noop, refreshForecast: noop, refreshGroup: noop, refreshWeekActivity: noop, refreshMonthActivity: noop, savePreferences: async () => ({ ok: true }) } };
  const theme = createThemeController({ root: { setAttribute() {} }, storage: { getItem: () => null, setItem() {} }, media: { matches: false, addEventListener() {} } });
  const router = { current: () => ({ id: "dashboard", params: {} }), subscribe() {}, navigate() {} };
  const mountPoint = document.createElement("div");
  dom.body.appendChild(mountPoint);
  createShell({ mountPoint, store, router, theme, api: {} }).render();
  return mountPoint;
}

describe("the header and onboarding count only workspaces that are not deleted", () => {
  test("a deleted workspace is not in the workspace picker", () => {
    const root = boot([HOME, OLD, TRIP], "ws_home");
    const options = root.querySelector("#workspace-picker").querySelectorAll("option").map((o) => o.textContent);
    assert.deepEqual(options, ["Fictional household", "Fictional trip"]);
  });

  test("with only deleted workspaces the person is asked to create one, with no picker and no sections", () => {
    const root = boot([OLD], null);
    assert.equal(root.querySelector(".picker--workspace"), null);
    assert.equal(root.querySelector("h1").textContent, "Create your first workspace");
    assert.equal(root.querySelector(".app__nav").hidden, true);
  });
});

// The Workspace page, as in workspacesettings.test.js, with the store's delete action recorded.
function workspacePage({ role = "owner", refuse = null } = {}) {
  const calls = { deleted: [], navigated: [] };
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  const state = {
    selectedWorkspaceId: "ws_1", preferences: null,
    workspaces: [{ id: "ws_1", name: "Fictional household", status: "active", role }],
    members: ready({ members: [{ id: "m_me", name: "Me Fictional", role, self: true }, { id: "m_2", name: "Other Fictional", role: role === "owner" ? "member" : "owner" }] }),
    categories: ready({ categories: [], palette: [] }), icons: ready({ typeIcons: {}, canEditTypeIcons: false, catalog: null }),
  };
  const api = {
    invitations: async () => ({ invitations: [] }), backups: async () => ({ archives: [], policy: "" }), audit: async () => ({ entries: [] }),
    request: async (name) => (name === "workspaces" ? { workspace: { history: [], lifecycle: [], settingsList: [], settingsHistory: [] } } : name === "members" ? { former: [] } : {}),
  };
  const store = { getState: () => state, actions: {
    write: async (fn) => { try { await fn("ws_1"); return { ok: true }; } catch (error) { return { ok: false, error }; } },
    refreshWorkspaces: async () => ({ ok: true }),
    deleteWorkspace: async (id, reason) => { calls.deleted.push([id, reason]); return refuse ? { ok: false, error: refuse } : { ok: true }; },
  } };
  return { ctx: { api, store, navigate: (id) => calls.navigated.push(id) }, state, calls };
}

async function openWorkspace(options) {
  const { ctx, state, calls } = workspacePage(options);
  const view = createWorkspace(ctx);
  dom.body.appendChild(view.element);
  view.update(state);
  await settle();
  return {
    view, calls,
    card: view.element.querySelectorAll("section").find((s) => s.getAttribute("aria-labelledby") === "ws-delete") || null,
    permanentCard: view.element.querySelectorAll("section").find((s) => s.getAttribute("aria-labelledby") === "ws-delete-permanent") || null,
  };
}

const MESSAGE = "Everyone loses access and it disappears from your lists. Nothing is erased: you can bring it back from Deleted workspaces in My settings.";

describe("Delete workspace, on the Workspace page, for owners only", () => {
  test("an owner sees it near the bottom of the page, in the danger style; managers, members and viewers do not (they keep Leave workspace)", async () => {
    const { view, card } = await openWorkspace();
    const cards = view.element.querySelectorAll("section.card");
    // BT-014-04: the PERMANENT deletion card (a separate, unmistakably distinct action) is now the
    // very last card on the page; this recoverable one is immediately before it.
    assert.ok(cards[cards.length - 2] === card, "the second-to-last card on the page");
    assert.equal(card.querySelector("h2").textContent, "Soft Delete Workspace");
    const del = buttonNamed(card, "Soft delete workspace…");
    assert.ok(del.classList.contains("btn--danger"));
    assert.ok(card.classList.contains("card--danger"));
    for (const role of ["manager", "member", "viewer"]) {
      dom.teardown(); dom = installDom();
      const other = await openWorkspace({ role });
      assert.equal(other.card, null, role);
      assert.ok(buttonNamed(other.view.element, "Leave workspace"), `${role} keeps Leave workspace`);
    }
  });

  test("BT-014-04: the PERMANENT deletion card is unmistakably distinct from the recoverable one above — different heading, wording and an extra style class, owners only", async () => {
    const { view, card, permanentCard } = await openWorkspace();
    const cards = view.element.querySelectorAll("section.card");
    assert.ok(cards[cards.length - 1] === permanentCard, "the last card on the page");
    assert.notEqual(permanentCard, card, "a distinct card, not a re-labelled version of the recoverable one");
    assert.equal(permanentCard.querySelector("h2").textContent, "Permanently Delete This workspace- (Cannot be undone)");
    assert.notEqual(permanentCard.querySelector("h2").textContent, card.querySelector("h2").textContent);
    assert.ok(permanentCard.classList.contains("card--danger-permanent"), "an extra class on top of the ordinary danger styling");
    assert.ok(buttonNamed(permanentCard, "Permanently delete workspace…"));
    assert.notEqual(buttonNamed(permanentCard, "Permanently delete workspace…").textContent, "Soft delete workspace…");
    for (const role of ["manager", "member", "viewer"]) {
      dom.teardown(); dom = installDom();
      const other = await openWorkspace({ role });
      assert.equal(other.permanentCard, null, role);
    }
  });

  test("the dialog names the workspace, says what happens, has the reason filled in and needs the name typed; mistakes are said inside it", async () => {
    const { card, calls } = await openWorkspace();
    buttonNamed(card, "Soft delete workspace…").click();
    const dialog = dom.body.querySelector(".modal");
    assert.equal(dialog.querySelector("h2").textContent, "Soft delete Fictional household?");
    assert.ok(dialog.querySelectorAll("p").some((p) => p.textContent === MESSAGE));
    assert.equal(labelled(dialog, "Reason").value, "No longer needed");
    const confirm = labelled(dialog, "Type Fictional household to confirm");
    assert.equal(confirm.value, "");
    const go = buttonNamed(dialog, "Soft delete workspace");
    assert.ok(go.classList.contains("btn--danger"));
    for (const typed of ["", "fictional household", "Fictional"]) {
      confirm.value = typed;
      go.click();
      await settle();
      assert.equal(dialog.querySelector(".modal__error").textContent, "Type the workspace name, Fictional household, to confirm.");
      assert.equal(dialog.querySelector(".modal__error").hidden, false);
      assert.equal(confirm.getAttribute("aria-invalid"), "true");
      assert.ok(document.activeElement === confirm, "focus goes to the name field");
    }
    assert.deepEqual(calls.deleted, [], "nothing is sent until the name matches");
    labelled(dialog, "Reason").value = "  Moved to a new flat  ";
    confirm.value = "Fictional household";
    go.click();
    await settle();
    assert.deepEqual(calls.deleted, [["ws_1", "Moved to a new flat"]]);
    assert.equal(dom.body.querySelector(".modal"), null, "the dialog closes");
    assert.deepEqual(calls.navigated, ["dashboard"]);
  });

  test("a refusal from the server is shown inside the dialog, which stays open with what was typed", async () => {
    const refusal = Object.assign(new Error("Only an owner can archive a workspace."), { kind: "forbidden", status: 403 });
    const { card } = await openWorkspace({ refuse: refusal });
    buttonNamed(card, "Soft delete workspace…").click();
    const dialog = dom.body.querySelector(".modal");
    labelled(dialog, "Type Fictional household to confirm").value = "Fictional household";
    buttonNamed(dialog, "Soft delete workspace").click();
    await settle();
    assert.ok(dom.body.querySelector(".modal"), "still open");
    assert.equal(dialog.querySelector(".modal__error").textContent, "Only an owner can archive a workspace.");
    assert.equal(labelled(dialog, "Type Fictional household to confirm").value, "Fictional household");
  });
});

function settingsPage(workspaces, { refuse = null } = {}) {
  const restored = [];
  const sources = { themeMode: "default", themePalette: "default", displayCurrency: "default", dateFormat: "default", numberFormat: "default", defaultWorkspaceId: "default", balanceMasking: "default", categoryColors: "default", categoryIcons: "default" };
  const state = {
    selectedWorkspaceId: null, workspaces,
    auth: { user: { name: "Alice Fictional", siteAdmin: false } },
    preferences: { effective: { dateFormat: "iso", numberFormat: "1,234.56", displayCurrency: "", defaultWorkspaceId: "", balanceMasking: false, themePalette: "midnight" }, sources },
  };
  const theme = { getTheme: () => "midnight", setTheme() {}, subscribe: () => () => {}, getMode: () => "light", getResolvedMode: () => "light", setMode() {} };
  const store = { getState: () => state, actions: {
    savePreferences: async () => ({ ok: true }), init: async () => {},
    restoreWorkspace: async (id) => {
      restored.push(id);
      if (refuse) return { ok: false, error: refuse };
      state.workspaces = state.workspaces.map((w) => (w.id === id ? { ...w, status: "active", archivedAt: null } : w));
      return { ok: true };
    },
  } };
  const view = createSettings({ store, theme, api: { request: async () => ({ private: [] }) } });
  dom.body.appendChild(view.element);
  view.update(state);
  const card = () => view.element.querySelectorAll("section").find((s) => s.getAttribute("aria-labelledby") === "set-deleted");
  return { view, state, card, restored };
}

describe("Deleted workspaces, in My settings", () => {
  test("lists the deleted workspaces this person owns, with when; a member's deleted workspace never reaches them; none, no card", () => {
    const { view, card } = settingsPage([HOME, OLD, TRIP]);
    assert.equal(card().hidden, false);
    assert.equal(card().querySelector("h2").textContent, "Deleted workspaces");
    assert.deepEqual(card().querySelectorAll("li").map((li) => li.querySelector("strong").textContent), ["Fictional old flat"]);
    assert.match(card().textContent, /Deleted 2026-09-13/);
    assert.ok(buttonNamed(card(), "Bring back").getAttribute("aria-label") === "Bring back Fictional old flat");
    // The default-workspace choice offers only workspaces that are not deleted.
    assert.deepEqual(offeredOptions(pickerNamed(view.element, "Default workspace")), ["First available", "Fictional household", "Fictional trip"]);
    dom.teardown(); dom = installDom();
    assert.equal(settingsPage([HOME, TRIP]).card().hidden, true);
  });

  test("Bring back asks the store, says it is back and where to find it, and moves focus to that message", async () => {
    const { view, state, card, restored } = settingsPage([HOME, OLD]);
    buttonNamed(card(), "Bring back").click();
    await settle();
    view.update(state);
    assert.deepEqual(restored, ["ws_old"]);
    const status = card().querySelector("[role=status]");
    assert.equal(status.textContent, "Fictional old flat is back. Everyone who was in it has their access again; choose it in the workspace picker.");
    assert.ok(document.activeElement === status);
    assert.equal(card().querySelectorAll("li").length, 0);
    assert.match(card().textContent, /No deleted workspaces\./);
  });

  test("the limit is said in the card, and the workspace stays listed", async () => {
    const limit = Object.assign(new Error("You can have up to 20 active workspaces that you created. Delete one you no longer use, then bring this one back."), { kind: "conflict", status: 409, code: "workspace_limit" });
    const { card } = settingsPage([HOME, OLD], { refuse: limit });
    buttonNamed(card(), "Bring back").click();
    await settle();
    const alert = card().querySelector("[role=alert]");
    assert.deepEqual([alert.hidden, alert.textContent], [false, limit.message]);
    assert.equal(card().querySelectorAll("li").length, 1);
  });
});
