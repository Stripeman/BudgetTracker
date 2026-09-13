// BT-004-04 — THE HEADER'S WORKSPACE PICKER IN THE SHELL, adapted from TaskTracker
// app/test/shellprojectpicker.test.js (T: main fb24a41). It proves the wiring the unit tests cannot:
// the header holds one command picker (and no separate "New workspace" button beside it), it is
// built once and survives store commits with focus intact, choosing goes through the store's
// selectWorkspace action, and "+ New workspace" opens the New workspace dialog with the search text.
// The store here is a small recording double: the real store's synchronous reset and generation
// guard are covered where they live; this file checks that the header still calls into them.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { createShell } from "../js/ui/shell.js";
import { createThemeController } from "../js/ui/theme.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const WORKSPACES = [
  { id: "ws_family", name: "Family budget", kind: "household", status: "active", role: "owner" },
  { id: "ws_flat", name: "Shared flat", kind: "group", status: "active", role: "manager" },
];

function recordingStore() {
  const listeners = new Set();
  const selected = [];
  let state = {
    auth: { status: "ready", user: { name: "Alice Example" } },
    workspaces: WORKSPACES,
    selectedWorkspaceId: "ws_family",
    preferences: null,
    site: null,
    app: { version: "0.0.0-test", environment: "test" },
  };
  const commit = (patch) => { state = { ...state, ...patch }; for (const fn of listeners) fn(state); };
  const noop = async () => {};
  return {
    selected,
    commit,
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    actions: {
      async selectWorkspace(id) { selected.push(id); commit({ selectedWorkspaceId: id }); },
      refreshTransactions: noop, refreshBills: noop, refreshForecast: noop, savePreferences: async () => ({ ok: true }),
      createWorkspace: async () => { throw new Error("not in this test"); },
    },
  };
}

function boot() {
  const store = recordingStore();
  const theme = createThemeController({ root: { setAttribute() {} }, storage: { getItem: () => null, setItem() {} }, media: { matches: false, addEventListener() {} } });
  const router = { current: () => ({ id: "dashboard", params: {} }), subscribe() {}, navigate() {} };
  const mountPoint = document.createElement("div");
  dom.body.appendChild(mountPoint);
  const shell = createShell({ mountPoint, store, router, theme, api: {} });
  shell.render();
  const header = mountPoint.querySelector(".app__header");
  return { store, header, mountPoint };
}

const triggerIn = (header) => header.querySelector(".picker--workspace").querySelector(".cmdpick__trigger");
const panel = () => dom.body.querySelector(".cmdpick__panel");
const press = (node, key) => node.dispatchEvent(new DomEvent("keydown", { bubbles: true, key }));
// Element identity is asserted with booleans: handing a DOM-double node to assert makes a failing
// report serialise the whole cyclic document graph, which hangs instead of failing.
const same = (a, b, message = "not the expected element") => assert.ok(a === b, message);
const none = (a, message = "expected no element") => assert.ok(a === null || a === undefined, message);

describe("BT-004-04 the header's workspace picker", () => {
  test("the header holds one command picker and no separate New workspace button", () => {
    const { header } = boot();
    assert.equal(header.querySelectorAll(".picker--workspace").length, 1);
    assert.ok(header.querySelector("#workspace-picker").classList.contains("cmdpick__native"), "the select is the hidden state");
    const outsideMenu = header.querySelectorAll("button").filter((b) => !b.closest(".menu__panel"));
    assert.equal(outsideMenu.filter((b) => /New workspace/.test(b.textContent)).length, 0, "the button added in 7b6d1c2 is gone");
    assert.ok(header.querySelectorAll(".menu__item").some((b) => b.textContent === "New workspace…"), "the account menu keeps New workspace…");
  });

  test("built once: a store commit keeps the same control and does not take focus from it", () => {
    const { header, store } = boot();
    const picker = header.querySelector(".picker--workspace");
    triggerIn(header).focus();
    store.commit({ app: { version: "0.0.0-test", environment: "test", commit: "abcdef0" } });
    same(header.querySelector(".picker--workspace"), picker, "the same picker element");
    same(document.activeElement, triggerIn(header));
  });

  test("choosing a workspace goes through store.actions.selectWorkspace, and the trigger follows the store", () => {
    const { header, store } = boot();
    triggerIn(header).click();
    press(panel(), "ArrowDown");
    press(panel(), "Enter");
    assert.deepEqual(store.selected, ["ws_flat"]);
    assert.equal(header.querySelector(".cmdpick__value").textContent, "Shared flat");
    same(document.activeElement, triggerIn(header), "focus ends on the picker, not lost to the page");
  });

  test("a workspace chosen elsewhere (the store) is reflected in the header", () => {
    const { header, store } = boot();
    store.commit({ selectedWorkspaceId: "ws_flat" });
    assert.equal(header.querySelector("#workspace-picker").value, "ws_flat");
    assert.equal(header.querySelector(".cmdpick__value").textContent, "Shared flat");
  });

  test("+ New workspace opens the New workspace dialog with what was typed as the name", () => {
    const { header } = boot();
    triggerIn(header).click();
    const box = panel().querySelector(".cmdpick__search");
    box.value = "Allotment";
    box.dispatchEvent(new DomEvent("input", { bubbles: true }));
    panel().querySelector(".cmdpick__create").click();
    const dialog = dom.body.querySelector(".modal");
    assert.ok(dialog, "the dialog opened");
    assert.equal(dialog.querySelector("h2").textContent, "New workspace");
    assert.equal(dialog.querySelector("input").value, "Allotment");
  });
});
