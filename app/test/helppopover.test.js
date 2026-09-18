// createHelpPopover (app/js/ui/components.js): an accessible popover for explanatory content that
// includes something INTERACTIVE — a real link or button — which a plain tooltip must never hold
// (review, 2026-09-18: "Interactive content belongs in an accessible popover, not a tooltip
// containing inaccessible links"). Opens on click; closes on Escape (returning focus to the
// trigger), on an outside press, or when focus leaves both the trigger and the panel.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { createHelpPopover } from "../js/ui/components.js";
import { openModal, escapeBelongsToControl } from "../js/ui/modal.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

function mount() {
  const clicked = [];
  const link = document.createElement("button");
  link.textContent = "Go to Workspace settings";
  link.addEventListener("click", () => clicked.push(true));
  const anchor = createHelpPopover({ label: "Where this comes from", content: [link] });
  dom.body.appendChild(anchor);
  const trigger = anchor.querySelector(".popover__trigger");
  return { anchor, trigger, link, clicked };
}

const panel = () => dom.body.querySelector(".popover__panel");
const pressAt = (target) => document.dispatchEvent(new DomEvent("mousedown", { bubbles: true, target }));

describe("BT-011-09 accessible help popover", () => {
  test("closed by default, with a real name and aria-expanded false", () => {
    const { trigger } = mount();
    assert.equal(panel(), null);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(trigger.getAttribute("aria-label"), "Where this comes from");
  });

  test("opens on click, holds the real interactive content, and aria-expanded becomes true", () => {
    const { trigger, link } = mount();
    trigger.click();
    assert.ok(panel(), "the panel is in the document");
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.ok(panel().contains(link), "the real button is inside the popover, not a tooltip");
  });

  test("a second click closes it (toggle)", () => {
    const { trigger } = mount();
    trigger.click();
    assert.ok(panel());
    trigger.click();
    assert.equal(panel(), null);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
  });

  test("Escape closes it and returns focus to the trigger", () => {
    const { trigger } = mount();
    trigger.click();
    assert.ok(panel());
    document.dispatchEvent(new DomEvent("keydown", { key: "Escape", target: panel() }));
    assert.equal(panel(), null);
    assert.equal(document.activeElement, trigger, "focus returns to the trigger, never lost to the page");
  });

  test("a press outside the trigger and the panel closes it", () => {
    const { trigger } = mount();
    const outside = document.createElement("button");
    dom.body.appendChild(outside);
    trigger.click();
    assert.ok(panel());
    pressAt(outside);
    assert.equal(panel(), null);
  });

  test("a press on the trigger itself, or inside the panel, does not close it", () => {
    const { trigger, link } = mount();
    trigger.click();
    pressAt(link);
    assert.ok(panel(), "still open — the press landed on the popover's own content");
  });

  test("the real button inside works normally", () => {
    const { trigger, link, clicked } = mount();
    trigger.click();
    link.click();
    assert.deepEqual(clicked, [true]);
  });

  test("focus leaving both the trigger and the panel closes it (tabbing away)", () => {
    const { trigger, link } = mount();
    trigger.click();
    const elsewhere = document.createElement("button");
    dom.body.appendChild(elsewhere);
    panel().dispatchEvent(new DomEvent("focusout", { relatedTarget: elsewhere, target: link }));
    assert.equal(panel(), null);
  });

  test("focus moving between the trigger and the panel's own content does not close it", () => {
    const { trigger, link } = mount();
    trigger.click();
    panel().dispatchEvent(new DomEvent("focusout", { relatedTarget: link, target: trigger }));
    assert.ok(panel(), "still open — focus only moved within the popover");
  });

  test("escapeBelongsToControl recognizes an open popover's panel and its own expanded trigger", () => {
    const { trigger, link } = mount();
    assert.equal(escapeBelongsToControl(trigger), false, "closed: Escape belongs to whatever is around it");
    trigger.click();
    assert.equal(escapeBelongsToControl(trigger), true, "open: the trigger itself reports aria-expanded=true");
    assert.equal(escapeBelongsToControl(link), true, "open: focus is inside the popover's own floating panel");
  });

  test("real-browser bug fix (2026-09-18): inside an open modal, Escape closes the popover first, never the whole dialog underneath it — and focus stays usable", () => {
    const dialog = openModal({ title: "A dialog", body: [], actions: [] });
    const link = document.createElement("button");
    link.textContent = "Go to Workspace settings";
    const anchor = createHelpPopover({ label: "Where this comes from", content: [link] });
    dialog.element.querySelector(".modal__body").appendChild(anchor);
    const trigger = anchor.querySelector(".popover__trigger");
    trigger.click();
    assert.ok(panel(), "popover open");
    link.focus(); // matches the real fix's own auto-focus of the first focusable popover control
    document.dispatchEvent(new DomEvent("keydown", { key: "Escape", bubbles: true, target: link }));
    assert.equal(panel(), null, "the popover closed");
    assert.ok(dom.body.querySelector(".modal"), "the dialog UNDERNEATH is still open — this is the exact bug: before the fix, this Escape closed the whole dialog instead");
    assert.equal(document.activeElement, trigger, "focus lands back on the popover's own (still-attached) trigger, never dropped");
  });
});
