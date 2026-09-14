// BT-011-06 — the staging link in the account menu and in My settings. DOM state and wiring only:
// layout, colours, the palettes and the real new tab are checked in a real browser. All addresses
// are fictional (.test and .example are reserved names).
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { installDom, DomEvent } from "./domdouble.js";
import { createShell } from "../js/ui/shell.js";
import { createThemeController } from "../js/ui/theme.js";
import { createView as createSettings } from "../js/ui/views/settings.js";
import { stagingHref, stagingHost } from "../js/core/links.js";

const require = createRequire(import.meta.url);
const fields = require("../../api/_shared/fields.js");

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const STAGING = "https://staging.example.test";
const tick = () => new Promise((r) => setTimeout(r, 0));
// Element identity is asserted with booleans: handing a DOM-double node to assert makes a failing
// report serialise the whole cyclic document graph.
const same = (a, b, message = "not the expected element") => assert.ok(a === b, message);
const dialog = () => dom.body.querySelector(".modal");
const buttonIn = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);

function prefs(stagingUrl, source = stagingUrl ? "personal" : "default") {
  return { effective: { stagingUrl, themeMode: "system", themePalette: "midnight" }, sources: { stagingUrl: source, themeMode: "default", themePalette: "default" } };
}

function recordingStore(preferences, { result = { ok: true } } = {}) {
  const listeners = new Set();
  const saved = [];
  let state = {
    auth: { status: "ready", user: { name: "Alice Example", email: "alice@example.com" } },
    workspaces: [{ id: "ws_family", name: "Family budget", kind: "household", status: "active", role: "owner" }],
    selectedWorkspaceId: "ws_family", preferences, site: null, app: { version: "0.0.0-test", environment: "test" },
  };
  const commit = (patch) => { state = { ...state, ...patch }; for (const fn of listeners) fn(state); };
  const noop = async () => {};
  return {
    saved, commit, getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    actions: {
      async savePreferences(patch) {
        saved.push(patch);
        if (!result.ok) return result;
        commit({ preferences: prefs(patch.stagingUrl) });
        return result;
      },
      refreshTransactions: noop, refreshBills: noop, refreshForecast: noop, refreshGroup: noop, refreshPreferences: noop,
      selectWorkspace: noop, createWorkspace: async () => { throw new Error("not in this test"); },
    },
  };
}

function boot(preferences, options) {
  const store = recordingStore(preferences, options);
  const theme = createThemeController({ root: { setAttribute() {} }, storage: { getItem: () => null, setItem() {} }, media: { matches: false, addEventListener() {} } });
  const router = { current: () => ({ id: "dashboard", params: {} }), subscribe() {}, navigate() {} };
  const mountPoint = document.createElement("div");
  dom.body.appendChild(mountPoint);
  createShell({ mountPoint, store, router, theme, api: {} }).render();
  const header = mountPoint.querySelector(".app__header");
  const q = (s) => header.querySelector(s);
  return { store, header, trigger: q(".avatar"), panel: q(".menu__panel"), group: q(".menu__staging"), link: q(".menu__link"), edit: q(".menu__edit"), add: q(".menu__add") };
}

describe("BT-011-06 the address rule: the browser agrees with the server", () => {
  // [address, accepted] — the expected answers are written here, not taken from either side.
  const CASES = [
    [STAGING, true], [`${STAGING}/path?x=1`, true], [`  ${STAGING}  `, true], ["HTTPS://Staging.Example.Test", true],
    ["https://staging.example.test:8443/app", true], ["https://xn--bcher-kva.example/", true],
    ["javascript:alert(1)", false], ["data:text/html,hello", false], ["mailto:someone@example.com", false],
    ["http://staging.example.test", false], ["http://127.0.0.1:4380", false], ["http://localhost:4380", false],
    ["ftp://staging.example.test", false], ["https:staging.example.test", false], ["/staging", false], ["https://", false], ["https:///path", false],
    ["https://user:secret@staging.example.test", false], ["https://bank.example@staging.example.test/", false],
    ["https://staging.example.test\\@other.example", false], ["https://staging.example.test/\u202Eabc", false],
    ["https://staging.\u200Bexample.test", false], ["\uFEFFhttps://staging.example.test", false], ["https://staging.example.test/\u0007", false],
    ["https://staging.example.test/a b", false], ["https://stаging.example.test", false], ["https://bücher.example/", false],
    [`https://staging.example.test/${"a".repeat(272)}`, false], ["", false], [42, false], [null, false],
  ];
  const serverAccepts = (v) => { try { fields.webAddress(v, "Staging link"); return true; } catch (e) { assert.equal(e.code, "invalid_url"); return false; } };

  test("every case gets the same answer from both sides, and the expected one", () => {
    for (const [value, accepted] of CASES) {
      assert.equal(stagingHref(value) !== null, accepted, `browser: ${JSON.stringify(value)}`);
      assert.equal(serverAccepts(value), accepted, `server: ${JSON.stringify(value)}`);
    }
  });

  test("the host shown is the host the browser connects to", () => {
    assert.equal(stagingHost(`${STAGING}/x`), "staging.example.test");
    assert.equal(stagingHost("https://staging.example.test:8443/"), "staging.example.test:8443");
    assert.equal(stagingHost("not a url"), "");
  });
});

describe("BT-011-06 the staging link in the account menu", () => {
  test("with no address: the menu offers Add staging link… and shows no link", () => {
    const b = boot(prefs(null));
    assert.equal(b.link.hidden, true);
    assert.equal(b.link.hasAttribute("href"), false);
    assert.equal(b.edit.hidden, true);
    assert.equal(b.add.hidden, false);
    assert.equal(b.add.localName, "button");
    assert.equal(b.add.textContent, "Add staging link…");
    assert.ok(b.add.classList.contains("menu__item"), "styled like the menu's other items");
  });

  test("with an address: a menu item that opens the staging site in a new tab, and Edit beside it", () => {
    const b = boot(prefs(STAGING));
    assert.equal(b.link.hidden, false);
    assert.equal(b.link.localName, "a");
    assert.equal(b.link.getAttribute("href"), STAGING);
    assert.equal(b.link.getAttribute("target"), "_blank");
    assert.equal(b.link.getAttribute("rel"), "noopener noreferrer");
    assert.equal(b.link.getAttribute("aria-label"), "Open staging site in a new tab");
    assert.ok(b.link.classList.contains("menu__item"), "styled like My settings and Sign out");
    assert.equal(b.link.textContent, "Staging site");
    assert.ok(b.link.getAttribute("aria-label").toLowerCase().includes(b.link.textContent.toLowerCase()), "the visible text is part of the name (WCAG 2.5.3)");
    const cue = b.link.querySelector("svg");
    assert.equal(cue.getAttribute("data-icon"), "external");
    assert.equal(cue.getAttribute("aria-hidden"), "true", "the cue is decoration; the name says new tab");
    assert.equal(b.edit.hidden, false);
    assert.equal(b.edit.localName, "button");
    assert.equal(b.edit.textContent, "Edit");
    assert.equal(b.edit.getAttribute("aria-label"), "Edit staging link");
    assert.equal(b.add.hidden, true);
    assert.ok(b.panel.contains(b.link) && b.panel.contains(b.edit), "inside the account menu");
    const groups = b.panel.children;
    assert.ok(groups[2] === b.group, "its own group, after Appearance and before New workspace / My settings / Sign out");
    assert.ok(groups[3].querySelectorAll(".menu__item").some((n) => n.textContent === "My settings"));
  });

  test("built once and refreshed in place: a store commit keeps the same elements and focus", () => {
    const b = boot(prefs(STAGING));
    b.edit.focus();
    b.store.commit({ preferences: prefs("https://preview.example.test/app") });
    same(b.header.querySelector(".menu__link"), b.link, "the same link element");
    same(b.header.querySelector(".menu__edit"), b.edit, "the same Edit button");
    assert.equal(b.link.getAttribute("href"), "https://preview.example.test/app");
    same(document.activeElement, b.edit, "focus stayed on Edit");
    b.store.commit({ preferences: prefs(null) });
    same(b.header.querySelector(".menu__link"), b.link);
    assert.equal(b.link.hidden, true);
    assert.equal(b.add.hidden, false);
    assert.equal(b.header.querySelectorAll(".menu__link").length, 1);
  });

  test("Edit opens the editor with the address; Save stores it and focus returns to the account button", async () => {
    const b = boot(prefs(STAGING));
    // The menu is open (the double does not turn the panel's initial `hidden` attribute into the
    // property the shell toggles, so the open state is set directly; a real browser opens it by click).
    b.panel.hidden = false;
    b.trigger.setAttribute("aria-expanded", "true");
    b.edit.click();
    assert.equal(b.panel.hidden, true, "the menu closes");
    assert.equal(b.trigger.getAttribute("aria-expanded"), "false");
    const d = dialog();
    assert.ok(d, "the editor opened");
    assert.equal(d.getAttribute("role"), "dialog");
    assert.equal(d.querySelector("h2").textContent, "Staging link");
    const box = d.querySelector("input");
    assert.equal(box.getAttribute("type"), "url");
    assert.equal(box.value, STAGING);
    same(document.activeElement, box, "focus is in the address field");
    assert.equal(d.querySelector("label").getAttribute("for"), box.id);
    assert.equal(d.querySelector("label").textContent, "Staging site address");
    assert.ok(buttonIn(d, "Remove link"), "one's own address can be removed");
    box.value = "https://preview.example.test";
    buttonIn(d, "Save").click();
    await tick();
    assert.deepEqual(b.store.saved, [{ stagingUrl: "https://preview.example.test" }]);
    assert.equal(dialog(), null, "the editor closed");
    same(document.activeElement, b.trigger, "focus is back on the account button");
    assert.equal(b.link.getAttribute("href"), "https://preview.example.test");
  });

  test("Enter in the field saves, like Save", async () => {
    const b = boot(prefs(null));
    b.add.click();
    const box = dialog().querySelector("input");
    box.value = STAGING;
    box.dispatchEvent(new DomEvent("keydown", { bubbles: true, key: "Enter" }));
    await tick();
    assert.deepEqual(b.store.saved, [{ stagingUrl: STAGING }]);
    assert.equal(dialog(), null);
  });

  test("a refused address keeps the editor open with the server's message inside it", async () => {
    const message = "Staging link must be a web address starting with https://, without spaces, a user name, a password or hidden characters.";
    const b = boot(prefs(STAGING), { result: { ok: false, error: { message } } });
    b.edit.click();
    const d = dialog();
    const box = d.querySelector("input");
    box.value = "https://other.example.test";
    buttonIn(d, "Save").click();
    await tick();
    assert.ok(dialog(), "still open");
    const error = d.querySelector(".modal__error");
    assert.equal(error.textContent, message);
    assert.equal(error.hidden, false);
    assert.equal(box.getAttribute("aria-invalid"), "true");
    assert.equal(box.getAttribute("aria-errormessage"), error.id);
    same(document.activeElement, box, "focus goes back to the field to correct it");
    assert.equal(b.store.saved.length, 1);
    assert.equal(b.link.getAttribute("href"), STAGING, "the link is unchanged");
  });

  test("unsafe or empty addresses are explained in the editor and never sent", () => {
    const b = boot(prefs(null));
    b.add.click();
    const d = dialog();
    assert.equal(d.querySelector("h2").textContent, "Staging link");
    assert.equal(buttonIn(d, "Remove link"), undefined, "nothing of one's own to remove");
    const box = d.querySelector("input");
    assert.equal(box.value, "");
    for (const value of ["javascript:alert(1)", "http://staging.example.test", "https://user:secret@staging.example.test", "https://staging.example.test/\u202Eabc"]) {
      box.value = value;
      buttonIn(d, "Save").click();
      assert.match(d.querySelector(".modal__error").textContent, /starting with https:\/\//, value);
      assert.equal(box.getAttribute("aria-invalid"), "true");
    }
    box.value = "   ";
    buttonIn(d, "Save").click();
    assert.match(d.querySelector(".modal__error").textContent, /Enter the address of your staging site/);
    assert.deepEqual(b.store.saved, [], "nothing was sent");
  });

  test("Escape and Cancel close the editor without saving, and focus returns to the account button", () => {
    const b = boot(prefs(STAGING));
    b.edit.click();
    dialog().querySelector("input").value = "https://changed.example.test";
    document.dispatchEvent(new DomEvent("keydown", { key: "Escape" }));
    assert.equal(dialog(), null);
    same(document.activeElement, b.trigger);
    b.edit.click();
    buttonIn(dialog(), "Cancel").click();
    assert.equal(dialog(), null);
    assert.deepEqual(b.store.saved, []);
    assert.equal(b.link.getAttribute("href"), STAGING);
  });

  test("Remove clears one's own address; an inherited address offers no Remove", async () => {
    const b = boot(prefs(STAGING));
    b.edit.click();
    buttonIn(dialog(), "Remove link").click();
    await tick();
    assert.deepEqual(b.store.saved, [{ stagingUrl: null }]);
    assert.equal(dialog(), null);
    assert.equal(b.link.hidden, true);
    assert.equal(b.add.hidden, false);
    const inherited = boot(prefs(STAGING, "site"));
    inherited.edit.click();
    const d = dialogs().at(-1);
    assert.equal(buttonIn(d, "Remove link"), undefined);
    assert.match(d.querySelector(".field__help").textContent, /site's staging link is used until you set your own/);
  });

  test("a stored address that fails the browser's check never becomes a link", () => {
    for (const bad of ["javascript:alert(1)", "https://user:pw@staging.example.test", "http://staging.example.test", "https://staging.example.test/\u202E"]) {
      const b = boot(prefs(bad));
      assert.equal(b.link.hidden, true, bad);
      assert.equal(b.link.hasAttribute("href"), false, bad);
      assert.equal(b.add.hidden, false, bad);
    }
  });

  test("locked by the site: the link opens but cannot be edited; with no address the entry is hidden", () => {
    const b = boot(prefs(STAGING, "locked"));
    assert.equal(b.link.hidden, false);
    assert.equal(b.edit.hidden, true);
    assert.equal(b.add.hidden, true);
    const none = boot(prefs(null, "locked"));
    assert.equal(none.group.hidden, true);
  });
});

function dialogs() { return dom.body.querySelectorAll(".modal"); }

function settingsCtx({ stagingUrl = STAGING, source = stagingUrl ? "personal" : "default", siteAdmin = false, siteDefault = null } = {}) {
  const saved = [];
  const calls = [];
  const sources = { themeMode: "default", themePalette: "default", displayCurrency: "default", dateFormat: "default", numberFormat: "default", defaultWorkspaceId: "default", balanceMasking: "default", categoryColors: "default", categoryIcons: "default", stagingUrl: source };
  const state = {
    selectedWorkspaceId: null, workspaces: [],
    auth: { user: { name: "Alice Fictional", siteAdmin } },
    preferences: { effective: { dateFormat: "iso", numberFormat: "1,234.56", displayCurrency: "", defaultWorkspaceId: "", balanceMasking: false, themePalette: "midnight", stagingUrl }, sources },
  };
  const theme = { getTheme: () => "midnight", setTheme() {}, subscribe: () => () => {}, getMode: () => "light", getResolvedMode: () => "light", setMode() {} };
  const store = {
    getState: () => state,
    actions: {
      savePreferences: async (patch) => { saved.push(patch); return { ok: true }; },
      refreshPreferences: async () => { calls.push("refreshPreferences"); return { ok: true }; },
      init: async () => {},
    },
  };
  const api = {
    request: async (path, options) => { if (path === "site-settings") { calls.push(options); return { settings: {} }; } return { private: [] }; },
    siteSettings: async () => { calls.push("siteSettings"); return { settings: { defaults: siteDefault ? { stagingUrl: siteDefault } : {} }, admin: true }; },
  };
  return { ctx: { store, theme, api }, state, saved, calls };
}

function mountSettings(options) {
  const s = settingsCtx(options);
  const view = createSettings(s.ctx);
  dom.body.appendChild(view.element);
  view.update(s.state);
  const card = view.element.querySelector('section[aria-labelledby="set-staging"]');
  return { ...s, view, card };
}

describe("BT-011-06 the staging link in My settings", () => {
  test("the same link, its host and source, and the same editor as the account menu", async () => {
    const m = mountSettings();
    assert.ok(m.card, "a Staging link card");
    assert.equal(m.card.querySelector("h2").textContent, "Staging link");
    const link = m.card.querySelector(".staging__link");
    assert.equal(link.hidden, false);
    assert.equal(link.getAttribute("href"), STAGING);
    assert.equal(link.getAttribute("target"), "_blank");
    assert.equal(link.getAttribute("rel"), "noopener noreferrer");
    assert.equal(link.getAttribute("aria-label"), "Open staging site in a new tab");
    assert.equal(m.card.querySelector(".staging__host").textContent, "staging.example.test");
    assert.equal(m.card.querySelector(".badge").textContent, "Customized");
    const edit = buttonIn(m.card, "Edit staging link");
    edit.focus();
    edit.click();
    const d = dialog();
    assert.equal(d.querySelector("h2").textContent, "Staging link");
    const box = d.querySelector("input");
    assert.equal(box.value, STAGING);
    box.value = "https://preview.example.test";
    buttonIn(d, "Save").click();
    await tick();
    assert.deepEqual(m.saved, [{ stagingUrl: "https://preview.example.test" }]);
    assert.equal(dialog(), null);
    same(document.activeElement, edit, "focus returns to the button that opened it");
  });

  test("with no address it offers Add staging link…; Use inherited clears one's own", () => {
    const none = mountSettings({ stagingUrl: null });
    assert.equal(none.card.querySelector(".staging__link").hidden, true);
    assert.equal(none.card.querySelector(".staging__none").textContent, "No staging link yet.");
    assert.ok(buttonIn(none.card, "Add staging link…"));
    assert.equal(buttonIn(none.card, "Use inherited").hidden, true);
    assert.equal(none.card.querySelector(".badge").textContent, "Inherited");
    const own = mountSettings();
    const reset = buttonIn(own.card, "Use inherited");
    assert.equal(reset.hidden, false);
    assert.equal(reset.getAttribute("aria-label"), "Use the inherited staging link");
    reset.click();
    assert.deepEqual(own.saved, [{ stagingUrl: null }]);
  });

  test("locked by the site: shown with its badge, and no editing", () => {
    const m = mountSettings({ stagingUrl: STAGING, source: "locked" });
    assert.equal(m.card.querySelector(".badge").textContent, "Locked by site");
    assert.equal(buttonIn(m.card, "Edit staging link").hidden, true);
    assert.equal(buttonIn(m.card, "Use inherited").hidden, true);
  });

  test("site administrators set the site default with the same editor, through site settings", async () => {
    const m = mountSettings({ siteAdmin: true, siteDefault: STAGING, stagingUrl: "https://mine.example.test" });
    await tick();
    const site = m.card.querySelector(".staging__site");
    assert.equal(site.hidden, false);
    assert.ok(site.textContent.includes("staging.example.test"), "the site default's host is shown");
    buttonIn(site, "Edit site staging link").click();
    const d = dialog();
    assert.equal(d.querySelector("h2").textContent, "Site staging link");
    const box = d.querySelector("input");
    assert.equal(box.value, STAGING);
    box.value = "https://preview.example.test";
    buttonIn(d, "Save").click();
    await tick(); await tick(); await tick();
    assert.deepEqual(m.calls.filter((c) => typeof c === "object"), [{ method: "PUT", body: { defaults: { stagingUrl: "https://preview.example.test" } } }]);
    assert.ok(m.calls.includes("refreshPreferences"), "the effective preferences are read again");
    assert.deepEqual(m.saved, [], "the personal preference is untouched");
  });

  test("people who are not site administrators never see or load the site default", async () => {
    const m = mountSettings();
    await tick();
    assert.equal(m.card.querySelector(".staging__site").hidden, true);
    assert.ok(!m.calls.includes("siteSettings"));
  });
});
