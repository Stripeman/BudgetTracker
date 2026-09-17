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

const STAGING = "https://staging.example.test/";
const tick = () => new Promise((r) => setTimeout(r, 0));
// Element identity is asserted with booleans: handing a DOM-double node to assert makes a failing
// report serialise the whole cyclic document graph.
const same = (a, b, message = "not the expected element") => assert.ok(a === b, message);
const dialog = () => dom.body.querySelector(".modal");
const buttonIn = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);

function prefs(stagingUrl, source = stagingUrl ? "personal" : "default") {
  return { effective: { stagingUrl, themeMode: "system", themePalette: "midnight" }, sources: { stagingUrl: source, themeMode: "default", themePalette: "default" } };
}

function recordingStore(preferences, { result = { ok: true }, environment = "test" } = {}) {
  const listeners = new Set();
  const saved = [];
  let state = {
    auth: { status: "ready", user: { name: "Alice Example", email: "alice@example.com" } },
    workspaces: [{ id: "ws_family", name: "Family budget", kind: "household", status: "active", role: "owner" }],
    selectedWorkspaceId: "ws_family", preferences, site: null, app: { version: "0.0.0-test", environment },
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
      refreshWeekActivity: noop, refreshMonthActivity: noop,
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
  return { store, header, trigger: q(".avatar"), panel: q(".menu__panel"), group: q(".menu__staging"), link: q(".menu__link"), edit: q(".menu__edit"), add: q(".menu__add"), locked: q(".menu__locked") };
}

describe("BT-011-06 the address rule: the browser agrees with the server", () => {
  const ch = (c) => String.fromCodePoint(c);
  const S = "https://staging.example.test/";
  // [address, accepted when not local, accepted when running locally, the stored and linked form].
  // The expected answers are written here, not taken from either side.
  const CASES = [
    [S, true, true, S], ["https://staging.example.test", true, true, S], [`  ${S}path?x=1  `, true, true, `${S}path?x=1`],
    ["HTTPS://Staging.Example.Test", true, true, S], ["https://staging.example.test:8443/app", true, true, "https://staging.example.test:8443/app"],
    ["https://xn--bcher-kva.example/", true, true, "https://xn--bcher-kva.example/"], ["https://192.0.2.10/", true, true, "https://192.0.2.10/"],
    ["https://[2001:db8::1]:8443/", true, true, "https://[2001:db8::1]:8443/"], ["https://127.0.0.1:4380/", true, true, "https://127.0.0.1:4380/"],
    ["http://127.0.0.1:4380/", false, true, "http://127.0.0.1:4380/"], ["http://localhost:4380/", false, true, "http://localhost:4380/"],
    ["http://[::1]:4380/", false, true, "http://[::1]:4380/"], ["HTTP://LOCALHOST:4380", false, true, "http://localhost:4380/"],
    ["http://example.com", false, false], ["http://127.0.0.1.evil.test", false, false], ["http://localhost.evil.test", false, false],
    ["http://127.0.0.2/", false, false], ["http://staging.example.test", false, false],
    ["https://@evil.example", false, false], ["https://:@evil.example", false, false], ["https://%65vil.example", false, false],
    ["https://staging.example.test:0/", false, false], ["https://staging.example.test:/", false, false], ["https://.", false, false],
    ["https://0x7f.1", false, false], ["https://127.1", false, false], ["https://0177.0.0.1", false, false], ["https://256.1.1.1", false, false],
    ["https://staging..example.test", false, false], ["https://staging.example.test.", false, false], ["https://-staging.example.test", false, false],
    ["javascript:alert(1)", false, false], ["data:text/html,hello", false, false], ["mailto:someone@example.com", false, false],
    ["ftp://staging.example.test", false, false], ["https:staging.example.test", false, false], ["/staging", false, false],
    ["https://", false, false], ["https:///path", false, false],
    ["https://user:secret@staging.example.test", false, false], ["https://bank.example@staging.example.test/", false, false],
    ["https://staging.example.test\\@other.example", false, false], [`https://staging.example.test/${ch(0x202e)}abc`, false, false],
    [`https://staging.${ch(0x200b)}example.test`, false, false], [`${ch(0xfeff)}https://staging.example.test`, false, false],
    [`https://staging.example.test/${ch(7)}`, false, false], ["https://staging.example.test/a b", false, false],
    [`https://st${ch(0x430)}ging.example.test`, false, false], [`https://b${ch(0xfc)}cher.example/`, false, false],
    [`https://staging.example.test/${"a".repeat(272)}`, false, false], ["", false, false], [42, false, false], [null, false, false],
  ];
  const server = (value, localHttp) => {
    try { return fields.webAddress(value, "Staging link", { localHttp }); } catch (e) { assert.equal(e.code, "invalid_url"); return null; }
  };

  test("every case gets the same answer and the same stored form from both sides, locally and elsewhere", () => {
    for (const [value, elsewhere, locally, stored] of CASES) {
      for (const [local, accepted] of [[false, elsewhere], [true, locally]]) {
        const where = `${local ? "local" : "not local"}: ${JSON.stringify(value)}`;
        const inBrowser = stagingHref(value, { local });
        const onServer = server(value, local);
        assert.equal(inBrowser !== null, accepted, `browser, ${where}`);
        assert.equal(onServer !== null, accepted, `server, ${where}`);
        if (accepted) {
          assert.equal(inBrowser, stored, `browser form, ${where}`);
          assert.equal(onServer, stored, `server form, ${where}`);
        }
      }
    }
  });

  test("the host shown is the normalised host the browser connects to", () => {
    assert.equal(stagingHost(`${S}x`), "staging.example.test");
    assert.equal(stagingHost("https://Staging.Example.Test:8443/"), "staging.example.test:8443");
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
    box.value = "https://preview.example.test/";
    buttonIn(d, "Save").click();
    await tick();
    assert.deepEqual(b.store.saved, [{ stagingUrl: "https://preview.example.test/" }]);
    assert.equal(dialog(), null, "the editor closed");
    same(document.activeElement, b.trigger, "focus is back on the account button");
    assert.equal(b.link.getAttribute("href"), "https://preview.example.test/");
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

  test("locked with an address: the link opens, and the menu says the site sets it instead of offering Edit (review 2)", () => {
    const b = boot(prefs(STAGING, "locked"));
    assert.equal(b.link.hidden, false);
    assert.equal(b.edit.hidden, true);
    assert.equal(b.add.hidden, true);
    assert.equal(b.locked.hidden, false);
    assert.equal(b.locked.textContent, "Set by the site");
  });

  test("locked with no address: the menu says so instead of offering an Add that would always fail (review 2)", () => {
    const b = boot(prefs(null, "locked"));
    assert.equal(b.group.hidden, false);
    assert.equal(b.link.hidden, true);
    assert.equal(b.add.hidden, true);
    assert.equal(b.edit.hidden, true);
    assert.equal(b.locked.hidden, false);
    assert.equal(b.locked.textContent, "Staging link: set by the site (none)");
    const open = boot(prefs(STAGING));
    assert.equal(open.locked.hidden, true, "no note when the person may edit");
  });

  test("running locally, a loopback http address is accepted and linked; elsewhere it is refused before sending (Terry, 2026-09-14)", async () => {
    const local = boot(prefs(null), { environment: "local" });
    local.add.click();
    let d = dialog();
    let box = d.querySelector("input");
    for (const refused of ["http://example.com", "http://127.0.0.1.evil.test"]) {
      box.value = refused;
      buttonIn(d, "Save").click();
      assert.match(d.querySelector(".modal__error").textContent, /https:\/\//, refused);
    }
    assert.deepEqual(local.store.saved, [], "nothing refused was sent");
    box.value = "http://127.0.0.1:4380";
    buttonIn(d, "Save").click();
    await tick();
    assert.deepEqual(local.store.saved, [{ stagingUrl: "http://127.0.0.1:4380/" }], "the normalised address is sent");
    assert.equal(local.link.getAttribute("href"), "http://127.0.0.1:4380/");
    const preview = boot(prefs(null), { environment: "preview" });
    preview.add.click();
    d = dialogs().at(-1);
    box = d.querySelector("input");
    box.value = "http://127.0.0.1:4380/";
    buttonIn(d, "Save").click();
    assert.match(d.querySelector(".modal__error").textContent, /https:\/\//);
    assert.deepEqual(preview.store.saved, []);
  });

  test("a stored loopback http address is a link only when running locally", () => {
    assert.equal(boot(prefs("http://localhost:4380/"), { environment: "local" }).link.getAttribute("href"), "http://localhost:4380/");
    const elsewhere = boot(prefs("http://localhost:4380/"), { environment: "production" });
    assert.equal(elsewhere.link.hidden, true);
    assert.equal(elsewhere.link.hasAttribute("href"), false);
    assert.equal(elsewhere.add.hidden, false);
  });

  test("the link uses the normalised address, and its tooltip shows the normalised host (review 5)", () => {
    const b = boot(prefs("https://Staging.Example.Test:8443/app"));
    assert.equal(b.link.getAttribute("href"), "https://staging.example.test:8443/app");
    assert.equal(b.link.getAttribute("title"), "staging.example.test:8443");
  });
});

function dialogs() { return dom.body.querySelectorAll(".modal"); }

function settingsCtx({ stagingUrl = STAGING, source = stagingUrl ? "personal" : "default", siteAdmin = false, siteDefault = null, siteLocked = [], stored = {} } = {}) {
  const saved = [];
  const calls = [];
  const sources = { themeMode: "default", themePalette: "default", displayCurrency: "default", dateFormat: "default", numberFormat: "default", defaultWorkspaceId: "default", balanceMasking: "default", categoryColors: "default", categoryIcons: "default", stagingUrl: source };
  const state = {
    selectedWorkspaceId: null, workspaces: [],
    auth: { user: { name: "Alice Fictional", siteAdmin } },
    preferences: { stored, effective: { dateFormat: "iso", numberFormat: "1,234.56", displayCurrency: "", defaultWorkspaceId: "", balanceMasking: false, themePalette: "midnight", stagingUrl }, sources },
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
    siteSettings: async () => { calls.push("siteSettings"); return { settings: { defaults: siteDefault ? { stagingUrl: siteDefault } : {}, locked: siteLocked }, admin: true }; },
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
    box.value = "https://preview.example.test/";
    buttonIn(d, "Save").click();
    await tick();
    assert.deepEqual(m.saved, [{ stagingUrl: "https://preview.example.test/" }]);
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
    box.value = "https://preview.example.test/";
    buttonIn(d, "Save").click();
    await tick(); await tick(); await tick();
    assert.deepEqual(m.calls.filter((c) => typeof c === "object"), [{ method: "PUT", body: { defaults: { stagingUrl: "https://preview.example.test/" } } }]);
    assert.ok(m.calls.includes("refreshPreferences"), "the effective preferences are read again");
    assert.deepEqual(m.saved, [], "the personal preference is untouched");
  });

  test("people who are not site administrators never see or load the site default", async () => {
    const m = mountSettings();
    await tick();
    assert.equal(m.card.querySelector(".staging__site").hidden, true);
    assert.ok(!m.calls.includes("siteSettings"));
  });

  test("locked with no address: 'Set by the site: none', and one's own saved address can still be cleared (review 2)", () => {
    const m = mountSettings({ stagingUrl: null, source: "locked", stored: { stagingUrl: "https://mine.example.test/" } });
    assert.equal(m.card.querySelector(".staging__none").textContent, "Set by the site: none");
    assert.equal(m.card.querySelector(".badge").textContent, "Locked by site");
    const clear = buttonIn(m.card, "Clear my saved address");
    assert.equal(clear.hidden, false);
    clear.click();
    assert.deepEqual(m.saved, [{ stagingUrl: null }]);
    const nothingStored = mountSettings({ stagingUrl: null, source: "locked" });
    assert.equal(buttonIn(nothingStored.card, "Clear my saved address").hidden, true);
  });

  test("site administrators lock the staging link here, with a warning when no site link is set (review 2)", async () => {
    const m = mountSettings({ siteAdmin: true, siteDefault: null, siteLocked: ["themeMode"] });
    await tick();
    const site = m.card.querySelector(".staging__site");
    const box = site.querySelector('input[type="checkbox"]');
    assert.equal(box.checked, false);
    assert.equal(site.querySelector("label").textContent.includes("Lock: everyone uses the site's staging link"), true);
    const warning = site.querySelector(".staging__warning");
    assert.equal(warning.hidden, false);
    assert.match(warning.textContent, /No site staging link is set/);
    box.click();
    await tick(); await tick();
    assert.deepEqual(m.calls.filter((c) => typeof c === "object"), [{ method: "PUT", body: { locked: ["themeMode", "stagingUrl"] } }]);
    assert.ok(m.calls.includes("refreshPreferences"));
    const locked = mountSettings({ siteAdmin: true, siteDefault: STAGING, siteLocked: ["stagingUrl", "themeMode"] });
    await tick();
    const lockedSite = locked.card.querySelector(".staging__site");
    const lockedBox = lockedSite.querySelector('input[type="checkbox"]');
    assert.equal(lockedBox.checked, true);
    assert.equal(lockedSite.querySelector(".staging__warning").hidden, true, "no warning when a site link is set");
    lockedBox.click();
    await tick(); await tick();
    assert.deepEqual(locked.calls.filter((c) => typeof c === "object"), [{ method: "PUT", body: { locked: ["themeMode"] } }]);
  });
});
