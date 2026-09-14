// BT-004-04 — THE POPUP DISMISSAL CONTRACT, adapted from TaskTracker app/test/popupdismiss.test.js
// (T: main fb24a41). TaskTracker runs its five promises against six controls; BudgetTracker's only
// member of the shared registry so far is the command picker, so the family here is the command
// picker (twice, for "one at a time") plus a hand-registered host for nesting. A pointer press is
// driven at the document, as the registry listens there. Visual placement is not tested here.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { createCommandPicker } from "../js/ui/commandpicker.js";
import { registerPopup, _popupCount } from "../js/ui/popup.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

function mountPicker(host = dom.body) {
  const select = document.createElement("select");
  for (const v of ["monthly", "weekly", "yearly"]) {
    const option = document.createElement("option");
    option.setAttribute("value", v);
    option.textContent = v;
    select.appendChild(option);
  }
  select.value = "monthly";
  const picker = createCommandPicker({ select, label: "Period" });
  host.appendChild(picker.element);
  return { picker, select };
}

const triggerOf = (picker) => picker.element.querySelector(".cmdpick__trigger");
const isOpen = (picker) => triggerOf(picker).getAttribute("aria-expanded") === "true";
const pressAt = (target) => document.dispatchEvent(new DomEvent("mousedown", { bubbles: true, target }));
// Element identity is asserted with booleans: handing a DOM-double node to assert makes a failing
// report serialise the whole cyclic document graph, which hangs instead of failing.
const same = (a, b, message = "not the expected element") => assert.ok(a === b, message);
const none = (a, message = "expected no element") => assert.ok(a === null || a === undefined, message);

describe("BT-004-04 popup dismissal", () => {
  test("1. a press outside closes it, without moving focus to the trigger", () => {
    const { picker } = mountPicker();
    const outside = document.createElement("p");
    dom.body.appendChild(outside);
    triggerOf(picker).click();
    assert.ok(isOpen(picker));
    pressAt(outside);
    assert.equal(isOpen(picker), false);
    none(dom.body.querySelector(".cmdpick__panel"), "the panel left the page");
    assert.ok(document.activeElement !== triggerOf(picker), "the press already went where the person chose");
  });

  test("2. a press inside the panel, or on its own trigger, does not close it", () => {
    const { picker } = mountPicker();
    triggerOf(picker).click();
    pressAt(dom.body.querySelector(".cmdpick__searchrow"));
    assert.ok(isOpen(picker), "inside the panel");
    pressAt(triggerOf(picker));
    assert.ok(isOpen(picker), "on the trigger");
  });

  test("3. opening one closes whichever was already open", () => {
    const a = mountPicker();
    const b = mountPicker();
    triggerOf(a.picker).click();
    triggerOf(b.picker).click();
    assert.equal(isOpen(a.picker), false);
    assert.ok(isOpen(b.picker));
    assert.equal(dom.body.querySelectorAll(".cmdpick__panel").length, 1);
  });

  test("5. dismissing changes nothing: no value is written and no change fires", () => {
    const { picker, select } = mountPicker();
    let heard = 0;
    select.addEventListener("change", () => { heard += 1; });
    triggerOf(picker).click();
    const box = dom.body.querySelector(".cmdpick__search");
    box.dispatchEvent(new DomEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    pressAt(dom.body);
    assert.equal(select.value, "monthly");
    assert.equal(heard, 0);
  });

  test("popups nest: a host that contains the picker is not closed when it opens or is used", () => {
    const hostEl = document.createElement("div");
    dom.body.appendChild(hostEl);
    let hostOpen = true;
    const host = registerPopup({ contains: (n) => hostEl.contains(n), close: () => { hostOpen = false; }, isOpen: () => hostOpen, ownerDocument: () => document, anchor: () => hostEl });
    host.opened();
    const { picker } = mountPicker(hostEl);
    triggerOf(picker).click();
    assert.ok(hostOpen, "opening the inner picker did not close its host");
    pressAt(dom.body.querySelector(".cmdpick__opt"));
    assert.ok(hostOpen, "a press in the inner panel (on the body, outside the host) keeps the host");
    pressAt(dom.body);
    assert.equal(hostOpen, false, "a press outside both closes both");
    assert.equal(isOpen(picker), false);
    host.destroy();
  });

  test("destroy() unregisters, and the registry refuses an incomplete popup", () => {
    const { picker } = mountPicker();
    const before = _popupCount();
    picker.destroy();
    assert.equal(_popupCount(), before - 1);
    assert.throws(() => registerPopup({ contains: () => false }), /contains\(\), close\(\) and isOpen\(\)/);
  });
});
