// BT-011-03 theme picker. The first block ports TaskTracker's contract (app/test/accountappearance
// .test.js and themepreference.test.js at T: main a1ec150): a listbox of every palette with a
// swatch set through the CSSOM, the toggle naming the current palette, selection matched by id.
// The second block covers BudgetTracker's documented keyboard and focus adaptations, including the
// 2026-09-18 overlay fix (Terry: screenshots of the Icon picker pushing every field below it down
// the page) — the list is a FLOATING OVERLAY, appended to the document only while open, never a
// normal-flow child of the picker's own returned `element` (app/js/ui/overlay.js, shared with
// commandpicker.js). Real screen-reader output and pointer/layout behaviour need a real browser.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { createThemePicker } from "../js/ui/themepicker.js";
import { THEMES } from "../js/ui/theme.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

// `toggle` is always a child of the picker's own returned `element` (it never moves). `list`/
// `options` only exist in the document while the list is OPEN, and — since 2026-09-18 — as a
// floating overlay appended to the document body (or the nearest dialog), never under `element`
// itself, so they are looked up from the whole document, not scoped to the picker's own element.
const toggleOf = (p) => p.element.querySelector(".themepick__toggle");
const openParts = (p) => {
  toggleOf(p).click();
  return { toggle: toggleOf(p), list: dom.body.querySelector('[role="listbox"]'), options: dom.body.querySelectorAll('[role="option"]') };
};
const key = (node, k) => { const e = Object.assign(new DomEvent("keydown", { bubbles: true, key: k }), { key: k }); node.dispatchEvent(e); return e; };

describe("BT-011-03 TaskTracker theme picker contract", () => {
  test("a listbox of every palette; picking one updates the toggle and calls onPick", () => {
    const picked = [];
    const p = createThemePicker({ value: "midnight", onPick: (id) => picked.push(id) });
    const toggle = toggleOf(p);
    assert.equal(toggle.getAttribute("aria-haspopup"), "listbox");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(dom.body.querySelector('[role="listbox"]'), null, "the list is not in the document until opened");
    const { list, options } = openParts(p);
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(list.hidden, false);
    assert.equal(options.length, THEMES.length);
    assert.equal(options.find((o) => o.dataset.theme === "midnight").getAttribute("aria-selected"), "true");
    options.find((o) => o.dataset.theme === "forest").click();
    assert.deepEqual(picked, ["forest"]);
    assert.match(toggle.textContent, /Forest/);
    assert.equal(toggle.getAttribute("aria-label"), "Theme: Forest");
    assert.equal(p.getValue(), "forest");
    // Closed after picking (TaskTracker): the list leaves the document again, not merely hidden.
    assert.equal(dom.body.querySelector('[role="listbox"]'), null, "removed from the document once closed");
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
    const { toggle, list, options } = openParts(p);
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
    const { toggle, list } = openParts(p);
    const e = key(list, "Escape");
    assert.equal(e.defaultPrevented, true);
    assert.deepEqual(reachedMenu, []);
    assert.equal(p.isOpen(), false);
    assert.equal(document.activeElement, toggle);
  });

  test("with an external label the accessible name still includes the current palette", () => {
    const p = createThemePicker({ value: "teal", labelledBy: "palette-label" });
    const toggle = toggleOf(p);
    const [labelId, nameId] = toggle.getAttribute("aria-labelledby").split(" ");
    assert.equal(labelId, "palette-label");
    assert.equal(p.element.querySelector(`#${nameId}`).textContent, "Teal");
  });

  test("disabling (a site-locked setting) closes the list and disables every option", () => {
    const p = createThemePicker({ value: "midnight" });
    const { options } = openParts(p);
    const toggle = toggleOf(p);
    p.setDisabled(true);
    assert.equal(p.isOpen(), false);
    assert.equal(toggle.disabled, true);
    assert.ok(options.every((o) => o.disabled));
    assert.equal(dom.body.querySelector('[role="listbox"]'), null, "removed from the document once disabled-closed");
  });

  // 2026-09-18 — Terry, verbatim: screenshots of the Icon picker in Add Bill/Add Budget/Add Account/
  // Add Merchant "creates a large gap and pushes subsequent fields down. This is unacceptable
  // throughout the application." The list must never be a normal-flow sibling of the toggle.
  describe("2026-09-18 — the list is a floating overlay, never in normal document flow", () => {
    test("the list is not a child of the picker's own element, even while open — it never occupies space beside the toggle", () => {
      const p = createThemePicker({ value: "midnight" });
      const { list } = openParts(p);
      assert.equal(p.element.contains(list), false, "the open list is NOT inside the field's own wrapper");
      assert.equal(p.element.children.length, 1, "the field's own element holds only its toggle, nothing else, whether open or closed");
    });

    test("closing removes the list from the document entirely, not merely hides it — opening or closing never leaves a hidden node taking up layout elsewhere", () => {
      const p = createThemePicker({ value: "midnight" });
      const { list } = openParts(p);
      assert.equal(list.parentNode !== null, true, "attached while open");
      toggleOf(p).click();
      assert.equal(p.isOpen(), false);
      assert.equal(list.parentNode, null, "detached once closed");
      assert.equal(dom.body.querySelector('[role="listbox"]'), null);
    });

    test("a field beside the picker (simulating a later field in the same form) never moves when the list opens or closes", () => {
      const form = document.createElement("div");
      const p = createThemePicker({ value: "midnight" });
      form.appendChild(p.element);
      const later = document.createElement("input");
      form.appendChild(later);
      dom.body.appendChild(form);
      const before = form.children.length;
      openParts(p);
      assert.equal(form.children.length, before, "opening added nothing to the form itself — the list went elsewhere");
      assert.equal(form.children[form.children.length - 1], later, "the later field is still exactly where it was, immediately after the picker");
      toggleOf(p).click();
      assert.equal(form.children.length, before);
      assert.equal(form.children[form.children.length - 1], later);
    });
  });
});
