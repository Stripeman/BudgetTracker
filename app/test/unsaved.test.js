// Unsaved changes are never lost silently (UX/accessibility review of eefd115, finding 3): the registry,
// the browser's warning when the tab closes or reloads, and the router's question before leaving the page
// within the app. Fictional data only.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { trackUnsaved, unsavedNames, clearUnsaved, installUnloadWarning } from "../js/core/unsaved.js";
import { createRouter } from "../js/core/router.js";
import { installDom } from "./domdouble.js";
import { createShell } from "../js/ui/shell.js";
import { createThemeController } from "../js/ui/theme.js";

afterEach(() => clearUnsaved());

// A window double: its hash, and the hashchange/beforeunload listeners, fired by hand as a browser would.
function fakeWindow(hash = "#/workspace") {
  const handlers = {};
  const win = {
    location: { hash },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    fire: (type, event = {}) => handlers[type] && handlers[type](event),
    go(next) { win.location.hash = next; win.fire("hashchange"); },
  };
  return win;
}

describe("the unsaved-changes registry", () => {
  test("a card is listed while it has unsaved changes, by its name", () => {
    trackUnsaved("workspace-settings", "Workspace settings", true);
    trackUnsaved("group-settings", "Shared expenses settings", true);
    assert.deepEqual(unsavedNames(), ["Workspace settings", "Shared expenses settings"]);
    trackUnsaved("workspace-settings", "Workspace settings", false);
    assert.deepEqual(unsavedNames(), ["Shared expenses settings"]);
  });

  test("closing or reloading the tab with unsaved changes makes the browser ask; without them it does not", () => {
    const win = fakeWindow();
    installUnloadWarning(win);
    const quiet = { prevented: false, preventDefault() { this.prevented = true; } };
    win.fire("beforeunload", quiet);
    assert.deepEqual([quiet.prevented, quiet.returnValue], [false, undefined]);
    trackUnsaved("workspace-settings", "Workspace settings", true);
    const asked = { prevented: false, preventDefault() { this.prevented = true; } };
    win.fire("beforeunload", asked);
    assert.deepEqual([asked.prevented, asked.returnValue], [true, ""]);
  });
});

describe("the router asks before leaving the page within the app", () => {
  test("a guard that says no keeps the page and its address; nothing is told of a change", () => {
    const win = fakeWindow("#/workspace");
    const router = createRouter(win);
    const seen = [];
    router.subscribe((r) => seen.push(r.id));
    router.start();
    seen.length = 0;
    const asked = [];
    router.setGuard((hash) => { asked.push(hash); return false; });
    win.go("#/dashboard");
    assert.deepEqual(asked, ["#/dashboard"]);
    assert.equal(win.location.hash, "#/workspace", "the address goes back");
    win.fire("hashchange"); // the browser reports the change back to the page's own address
    assert.deepEqual(seen, [], "the page is not left");
    assert.equal(router.current().id, "workspace");
  });

  test("a guard that says yes lets the change through; go() leaves once the person has chosen to", () => {
    const win = fakeWindow("#/workspace");
    const router = createRouter(win);
    const seen = [];
    router.subscribe((r) => seen.push(r.id));
    router.start();
    seen.length = 0;
    let allow = false;
    router.setGuard(() => allow);
    win.go("#/bills");
    assert.equal(router.current().id, "workspace");
    allow = true;
    router.go("#/bills");
    win.fire("hashchange");
    assert.deepEqual(seen, ["bills"]);
    assert.equal(router.current().id, "bills");
  });
});

describe("the shell's question", () => {
  test("with unsaved changes, leaving asks “Leave without saving?” naming them; leaving clears them and goes on; without them nothing is asked", async () => {
    const dom = installDom();
    try {
      let guard = null;
      const went = [];
      const router = { current: () => ({ id: "workspace", params: {} }), subscribe() {}, navigate() {}, setGuard: (fn) => { guard = fn; }, go: (hash) => went.push(hash) };
      const state = { auth: { status: "ready", user: { name: "Alice Fictional" } }, workspaces: [], selectedWorkspaceId: null, preferences: null, site: null, app: { version: "0.0.0-test", environment: "test" } };
      const store = { getState: () => state, subscribe() {}, actions: { savePreferences: async () => ({ ok: true }) } };
      const theme = createThemeController({ root: { setAttribute() {} }, storage: { getItem: () => null, setItem() {} }, media: { matches: false, addEventListener() {} } });
      createShell({ mountPoint: document.createElement("div"), store, router, theme, api: {} });
      assert.equal(guard("#/dashboard"), true, "nothing unsaved: go");
      trackUnsaved("workspace-settings", "Workspace settings", true);
      assert.equal(guard("#/dashboard"), false, "unsaved: stay until the person chooses");
      const modal = dom.body.querySelector(".modal");
      assert.match(modal.textContent, /Leave without saving\?/);
      assert.match(modal.textContent, /You have unsaved changes in Workspace settings\. If you leave this page now, they are lost\./);
      modal.querySelectorAll("button").find((b) => b.textContent === "Leave without saving").click();
      // The dialog closes after its confirm handler has run (confirmModal awaits it).
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(went, ["#/dashboard"]);
      assert.equal(dom.body.querySelector(".modal"), null, "the question is gone");
      assert.deepEqual(unsavedNames(), []);
    } finally { dom.teardown(); }
  });
});
