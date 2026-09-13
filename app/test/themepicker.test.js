// BT-011-03 theme picker. The first block ports TaskTracker's contract (app/test/accountappearance
// .test.js and themepreference.test.js at T: main a1ec150): a listbox of every palette with a
// swatch set through the CSSOM, the toggle naming the current palette, selection matched by id.
// The second block covers BudgetTracker's documented keyboard and focus adaptations. Real
// screen-reader output and pointer behaviour need a real browser.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { createThemePicker } from "../js/ui/themepicker.js";
import { THEMES } from "../js/ui/theme.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const parts = (p) => ({
  toggle: p.element.querySelector(".themepick__toggle"),
  list: p.element.querySelector('[role="listbox"]'),
  options: p.element.querySelectorAll('[role="option"]'),
});
const key = (node, k) => { const e = Object.assign(new DomEvent("keydown", { bubbles: true, key: k }), { key: k }); node.dispatchEvent(e); return e; };

describe("BT-011-03 TaskTracker theme picker contract", () => {
  test("a listbox of every palette; picking one updates the toggle and calls onPick", () => {
    const picked = [];
    const p = createThemePicker({ value: "midnight", onPick: (id) => picked.push(id) });
    const { toggle, list, options } = parts(p);
    assert.equal(toggle.getAttribute("aria-haspopup"), "listbox");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    toggle.click();
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(list.hidden, false);
    assert.equal(options.length, THEMES.length);
    assert.equal(options.find((o) => o.dataset.theme === "midnight").getAttribute("aria-selected"), "true");
    options.find((o) => o.dataset.theme === "forest").click();
    assert.deepEqual(picked, ["forest"]);
    assert.match(toggle.textContent, /Forest/);
    assert.equal(toggle.getAttribute("aria-label"), "Theme: Forest");
    assert.equal(p.getValue(), "forest");
    assert.equal(options.find((o) => o.dataset.theme === "forest").getAttribute("aria-selected"), "true");
    assert.equal(options.find((o) => o.dataset.theme === "midnight").getAttribute("aria-selected"), "false");
  });

  test("swatch colours are CSS custom properties set through the CSSOM, hidden from assistive technology", () => {
    const p = createThemePicker({ value: "forest" });
    const swatch = p.element.querySelector(".menu__swatch");
    assert.equal(swatch.style.getPropertyValue("--menu-swatch").trim(), THEMES.find((t) => t.id === "forest").swatch);
    assert.equal(swatch.getAttribute("aria-hidden"), "true");
    assert.equal(swatch.hasAttribute("style"), false, "no style attribute (CSP)");
  });

  test("an unknown value falls back to the first palette", () => {
    assert.equal(createThemePicker({ value: "sunrise" }).getValue(), THEMES[0].id);
  });
});

describe("BT-011-03 BudgetTracker adaptations", () => {
  test("opening focuses the current palette; arrows, Home and End move; a pick returns focus to the toggle", () => {
    const p = createThemePicker({ value: "slate" });
    const { toggle, list, options } = parts(p);
    toggle.click();
    assert.equal(document.activeElement, options.find((o) => o.dataset.theme === "slate"));
    key(list, "ArrowDown");
    assert.equal(document.activeElement, options[options.findIndex((o) => o.dataset.theme === "slate") + 1]);
    key(list, "End");
    assert.equal(document.activeElement, options[options.length - 1]);
    key(list, "Home");
    assert.equal(document.activeElement, options[0]);
    options[2].click();
    assert.equal(document.activeElement, toggle);
    assert.equal(p.isOpen(), false);
  });

  test("Escape closes the list, returns focus and does not reach a surrounding menu", () => {
    const p = createThemePicker({ value: "midnight" });
    const menu = document.createElement("div");
    menu.appendChild(p.element);
    const reachedMenu = [];
    menu.addEventListener("keydown", (e) => reachedMenu.push(e.key));
    const { toggle, list } = parts(p);
    toggle.click();
    const e = key(list, "Escape");
    assert.equal(e.defaultPrevented, true);
    assert.deepEqual(reachedMenu, []);
    assert.equal(p.isOpen(), false);
    assert.equal(document.activeElement, toggle);
  });

  test("with an external label the accessible name still includes the current palette", () => {
    const p = createThemePicker({ value: "teal", labelledBy: "palette-label" });
    const { toggle } = parts(p);
    const [labelId, nameId] = toggle.getAttribute("aria-labelledby").split(" ");
    assert.equal(labelId, "palette-label");
    assert.equal(p.element.querySelector(`#${nameId}`).textContent, "Teal");
  });

  test("disabling (a site-locked setting) closes the list and disables every option", () => {
    const p = createThemePicker({ value: "midnight" });
    const { toggle, options } = parts(p);
    toggle.click();
    p.setDisabled(true);
    assert.equal(p.isOpen(), false);
    assert.equal(toggle.disabled, true);
    assert.ok(options.every((o) => o.disabled));
  });
});
