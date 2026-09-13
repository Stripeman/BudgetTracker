// BT-011-04 category colours in the UI: a colour dot beside the name (never colour alone), set
// through the CSSOM (CSP), hidden from assistive technology; picker entries always include the
// colour currently in use; personal colours win over workspace colours.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { categoryLabel } from "../js/ui/components.js";
import { colourEntries, categoryIndex } from "../js/core/categories.js";
import { createThemePicker } from "../js/ui/themepicker.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const PALETTE = [{ id: "green", label: "Green", hex: "#16a34a" }, { id: "red", label: "Red", hex: "#dc2626" }];

describe("BT-011-04 category colours in the UI", () => {
  test("a category label shows the name with a decorative colour dot set through the CSSOM", () => {
    const label = categoryLabel("Groceries", "#16a34a");
    const dot = label.querySelector(".swatch-dot");
    assert.equal(label.textContent, "Groceries");
    assert.equal(dot.getAttribute("aria-hidden"), "true");
    assert.equal(dot.style.getPropertyValue("--swatch"), "#16a34a");
    assert.equal(dot.hasAttribute("style"), false);
  });

  test("picker entries keep a custom colour in use, and the picker reuses the theme-picker pattern with its own entries", () => {
    const entries = colourEntries(PALETTE, "#16a34a", "#123abc");
    assert.deepEqual(entries.map((e) => e.id), ["#16a34a", "#dc2626", "#123abc"]);
    const picker = createThemePicker({ value: "#123abc", entries, namePrefix: "Groceries colour" });
    assert.equal(picker.getValue(), "#123abc");
    assert.equal(picker.element.querySelector(".themepick__toggle").getAttribute("aria-label"), "Groceries colour: Custom");
    assert.equal(picker.element.querySelectorAll('[role="option"]').length, 3);
  });

  test("a personal colour wins over the workspace colour for the viewer only", () => {
    const state = {
      selectedWorkspaceId: "ws1",
      categories: { workspaceId: "ws1", status: "ready", data: { categories: [{ id: "cat_a", name: "Groceries", color: "#16a34a" }, { id: "cat_b", name: "Dining", color: "#ea580c" }], palette: PALETTE } },
      preferences: { effective: { categoryColors: { cat_a: "#6366f1" } } },
    };
    const index = categoryIndex(state);
    assert.equal(index.get("cat_a").shownColor, "#6366f1");
    assert.equal(index.get("cat_b").shownColor, "#ea580c");
  });
});
