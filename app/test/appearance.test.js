// BT-011-01 — the day/night Appearance control, ported with TaskTracker's test contract
// (app/test/accountappearance.test.js at T: main a1ec150) plus BudgetTracker's `locked` adaptation.
// This proves DOM state and wiring only; motion, contrast and real layout need a browser.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { createDayNightControl } from "../js/ui/daynight.js";
import { createThemeController, MODES, THEMES, DEFAULT_MODE } from "../js/ui/theme.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

// A recording double of the canonical controller: "the control exists" and "the control changes
// the mode" are different claims, and only the second matters.
function recordingTheme(initial = "system", deviceDark = true) {
  const calls = [];
  let mode = initial;
  return {
    calls,
    getMode: () => mode,
    getResolvedMode: () => (mode === "system" ? (deviceDark ? "dark" : "light") : mode),
    setMode: (next) => { calls.push(next); mode = next; return mode; },
  };
}

function mountControl(theme, options = {}) {
  const changes = [];
  const control = createDayNightControl({ theme, onChange: (m) => changes.push(m), ...options });
  dom.body.appendChild(control.element);
  const q = (s) => control.element.querySelector(s);
  return { control, changes, root: control.element, toggle: q(".daynight__switch"), device: q(".daynight__device"), note: q(".daynight__note") };
}

describe("BT-011-01 day/night appearance control", () => {
  test("all three states are reachable and named in words, not only drawn", () => {
    const c = mountControl(recordingTheme());
    assert.match(c.root.querySelector(".daynight__devicelabel").textContent, /Use device setting/);
    assert.deepEqual(c.root.querySelectorAll(".daynight__end").map((n) => n.textContent), ["Light", "Dark"]);
    assert.match(c.toggle.getAttribute("aria-label"), /^Appearance: (Light|Dark)$/);
    assert.equal(c.toggle.getAttribute("role"), "switch");
    assert.equal(c.toggle.localName, "button", "a real button, so Enter and Space work natively");
    assert.equal(c.root.querySelector(".daynight__devicelabel").getAttribute("for"), c.device.id);
  });

  test("clearing 'Use device setting' lands on what the device was giving, through the same controller", () => {
    const theme = recordingTheme("system", true);
    const c = mountControl(theme);
    c.device.checked = false;
    c.device.dispatchEvent(new DomEvent("change", { bubbles: true }));
    assert.deepEqual(theme.calls, ["dark"]);
    assert.deepEqual(c.changes, ["dark"], "the wrapper is told so it can persist to the account");
    c.toggle.click();
    assert.deepEqual(theme.calls, ["dark", "light"]);
    assert.equal(c.toggle.getAttribute("aria-label"), "Appearance: Light");
    assert.equal(c.toggle.getAttribute("aria-checked"), "false");
    assert.ok(!c.root.classList.contains("daynight--dark"));
  });

  test("while the device decides, the switch stays visible, refuses the press and says why", () => {
    const theme = recordingTheme("system", true);
    const c = mountControl(theme);
    assert.equal(c.device.checked, true);
    assert.equal(c.toggle.getAttribute("aria-disabled"), "true");
    c.toggle.click();
    assert.deepEqual(theme.calls, [], "pressing changed nothing");
    assert.match(c.note.textContent, /device is currently asking for dark/i);
    assert.equal(c.toggle.getAttribute("aria-describedby"), c.note.id);
    assert.ok(c.root.classList.contains("daynight--following"));
    assert.equal(c.toggle.getAttribute("aria-checked"), "true", "shows what the device resolves to");
  });

  test("ticking the box hands the decision back to the device", () => {
    const theme = recordingTheme("light");
    const c = mountControl(theme);
    assert.equal(c.note.textContent, "", "no note when the person is choosing");
    c.device.checked = true;
    c.device.dispatchEvent(new DomEvent("change", { bubbles: true }));
    assert.deepEqual(theme.calls, ["system"]);
  });

  test("the picture is decoration: every drawn mark is aria-hidden", () => {
    const c = mountControl(recordingTheme("dark"));
    for (const selector of [".daynight__sky", ".daynight__knob", ".daynight__sun", ".daynight__moon", ".daynight__end"]) {
      for (const node of c.root.querySelectorAll(selector)) assert.equal(node.getAttribute("aria-hidden"), "true", selector);
    }
  });

  test("BudgetTracker adaptation: a site-locked mode is shown, explained and cannot be changed", () => {
    const theme = recordingTheme("light");
    const c = mountControl(theme, { locked: true });
    assert.equal(c.device.disabled, true);
    assert.equal(c.toggle.getAttribute("aria-disabled"), "true");
    assert.match(c.note.textContent, /set by your site administrator/);
    c.toggle.click();
    c.device.checked = true;
    c.device.dispatchEvent(new DomEvent("change", { bubbles: true }));
    assert.deepEqual(theme.calls, [], "locked: nothing changes");
    assert.equal(c.device.checked, false, "the box is redrawn to the real state");
    c.control.setLocked(false);
    c.toggle.click();
    assert.deepEqual(theme.calls, ["dark"]);
  });
});

describe("BT-011-01 theme controller (one state model)", () => {
  function fakeRoot() {
    const attrs = {};
    return { attrs, setAttribute: (k, v) => { attrs[k] = v; } };
  }
  function fakeStorage(initial = {}) {
    const data = { ...initial };
    return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
  }

  test("modes are system/light/dark with system as default, and it writes data attributes", () => {
    assert.deepEqual([...MODES], ["system", "light", "dark"]);
    assert.equal(DEFAULT_MODE, "system");
    const root = fakeRoot();
    const media = { matches: true, addEventListener() {} };
    const theme = createThemeController({ root, storage: fakeStorage(), media });
    assert.equal(theme.getResolvedMode(), "dark");
    assert.equal(root.attrs["data-mode"], "dark");
    assert.equal(root.attrs["data-theme"], "midnight");
  });

  test("the local cache uses BudgetTracker keys and never TaskTracker's", () => {
    const storage = fakeStorage({ "tt.mode": "dark" });
    const theme = createThemeController({ root: fakeRoot(), storage });
    assert.equal(theme.getMode(), "system", "a TaskTracker key on the same machine is ignored");
    theme.setMode("light");
    theme.setTheme("forest");
    assert.equal(storage.data["bt.mode"], "light");
    assert.equal(storage.data["bt.theme"], "forest");
  });

  test("storage that throws never breaks boot; unknown values normalize", () => {
    const storage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    const theme = createThemeController({ root: fakeRoot(), storage, defaultMode: "nonsense" });
    assert.equal(theme.getMode(), "system");
    assert.equal(theme.setMode("purple"), "system");
    assert.equal(theme.setTheme("nope"), "midnight");
  });

  test("system mode keeps following the device; an explicit choice does not", () => {
    let handler;
    const media = { matches: false, addEventListener: (_, fn) => { handler = fn; } };
    const root = fakeRoot();
    const theme = createThemeController({ root, storage: fakeStorage(), media });
    media.matches = true; handler();
    assert.equal(root.attrs["data-mode"], "dark");
    theme.setMode("light");
    media.matches = false; handler(); media.matches = true; handler();
    assert.equal(root.attrs["data-mode"], "light");
  });

  test("the palette list matches the palettes the server accepts", async () => {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const site = require("../../api/_shared/site.js");
    assert.deepEqual(THEMES.map((t) => t.id), site.PALETTES);
  });
});
