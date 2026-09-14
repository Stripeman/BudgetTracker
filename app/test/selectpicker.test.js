// BT-004-05 — EVERY DROPDOWN IS THE COMMAND PICKER (Terry, 2026-09-14: "use the same component. and
// any drop down that possible to use, can use that too"; "i want all my apps to have the same look and
// feel"). The adapter (app/js/ui/selectpicker.js) puts TaskTracker's command picker over a view's
// native <select> and keeps it in step with everything the views already do to that select: set its
// value, fill it with new options, disable or hide it, describe it, mark it invalid and focus it. The
// select stays the one answer to "what is chosen". Also covered here: the field label names the
// trigger, the change semantics views rely on (input then change, nothing on re-choosing, nothing on
// Escape), and the behaviour inside a modal dialog (Escape and Tab belong to the open panel first;
// closing the dialog closes the panel). Layout and real screen-reader output need a real browser.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { installDom, DomEvent } from "./domdouble.js";
import { enhanceSelect, pickerOf, controlElement } from "../js/ui/selectpicker.js";
import { field, pickerSelect, commitOnConfirm } from "../js/ui/components.js";
import { openModal } from "../js/ui/modal.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const PERIODS = [{ value: "monthly", label: "Monthly" }, { value: "weekly", label: "Weekly" }, { value: "yearly", label: "Yearly" }];

const triggerOf = (select) => pickerOf(select).trigger;
const valueText = (select) => pickerOf(select).element.querySelector(".cmdpick__value").textContent;
const panel = () => dom.body.querySelector(".cmdpick__panel");
const rows = () => dom.body.querySelectorAll(".cmdpick__opt");
const labelOf = (row) => row.querySelector(".cmdpick__optlabel").textContent;
const press = (node, key, extra = {}) => { const e = Object.assign(new DomEvent("keydown", { bubbles: true, key }), extra); node.dispatchEvent(e); return e; };
const option = (value, text) => { const o = document.createElement("option"); o.setAttribute("value", value); o.textContent = text; return o; };
// Element identity is asserted with booleans: handing a DOM-double node to assert makes a failing
// report serialise the whole cyclic document graph, which hangs instead of failing.
const same = (a, b, message = "not the expected element") => assert.ok(a === b, message);
const none = (a, message = "expected no element") => assert.ok(a === null || a === undefined, message);

function mounted(options = PERIODS, value = "monthly", attrs = {}, picker = {}, label = "Period", fieldOptions = {}) {
  const select = pickerSelect(options, value, attrs, picker);
  const node = field(label, select, fieldOptions);
  dom.body.appendChild(node);
  return { select, node };
}

describe("BT-004-05 the adapter keeps the native select as the value", () => {
  test("pickerSelect returns the real select, enhanced: hidden behind a trigger, still the state", () => {
    const { select, node } = mounted();
    assert.equal(select.tagName, "SELECT");
    assert.ok(pickerOf(select), "the select has a picker");
    assert.ok(select.classList.contains("cmdpick__native"));
    assert.ok(node.contains(select), "still in the form");
    assert.ok(node.contains(triggerOf(select)), "the trigger is in the field");
    assert.equal(select.value, "monthly");
    assert.equal(valueText(select), "Monthly");
  });

  test("enhancing twice returns the same picker; a select that is not enhanced has none", () => {
    const select = pickerSelect(PERIODS, "weekly");
    same(enhanceSelect(select), pickerOf(select), "one picker per select");
    const plain = document.createElement("select");
    none(pickerOf(plain));
    same(controlElement(plain), plain, "a plain select is placed as it is");
    same(controlElement(select), pickerOf(select).element, "an enhanced one is placed as its picker");
    assert.throws(() => enhanceSelect(document.createElement("input")), /select/);
  });
});

describe("BT-004-05 programmatic changes keep the trigger in step", () => {
  test("setting .value repaints the trigger and fires nothing (as a native select)", () => {
    const { select } = mounted();
    const heard = [];
    select.addEventListener("change", () => heard.push("change"));
    select.addEventListener("input", () => heard.push("input"));
    select.value = "yearly";
    assert.equal(valueText(select), "Yearly");
    assert.deepEqual(heard, []);
  });

  test("replacing the options repaints the trigger and the open list", () => {
    const { select } = mounted([], "");
    triggerOf(select).click();
    assert.equal(dom.body.querySelector(".cmdpick__none").textContent, "Nothing to choose from.");
    select.replaceChildren(option("acc_1", "Joint (EUR)"), option("acc_2", "Savings (EUR)"));
    assert.deepEqual(rows().map(labelOf), ["Joint (EUR)", "Savings (EUR)"], "the open list was repainted by the new options alone");
    select.value = "acc_2";
    assert.equal(valueText(select), "Savings (EUR)");
    select.appendChild(option("acc_3", "Travel cash (USD)"));
    assert.deepEqual(rows().map(labelOf), ["Joint (EUR)", "Savings (EUR)", "Travel cash (USD)"]);
  });

  test("disabling by property or attribute disables the trigger and closes the panel; enabling restores it", () => {
    const { select } = mounted();
    triggerOf(select).click();
    assert.ok(panel());
    select.disabled = true;
    assert.equal(triggerOf(select).disabled, true);
    none(panel(), "a disabled control cannot stay open");
    select.disabled = false;
    assert.equal(triggerOf(select).disabled, false);
    select.setAttribute("disabled", "");
    assert.equal(triggerOf(select).disabled, true, "the attribute counts too (the reversal lock uses it)");
    press(triggerOf(select), "Enter");
    none(panel(), "and it will not open");
    select.removeAttribute("disabled");
    assert.equal(triggerOf(select).disabled, false);
  });

  test("a select built disabled starts with a disabled trigger", () => {
    const { select } = mounted(PERIODS, "monthly", { disabled: true });
    assert.equal(triggerOf(select).disabled, true);
  });

  test("hiding the select hides its whole control", () => {
    const { select } = mounted();
    select.hidden = true;
    assert.equal(pickerOf(select).element.hidden, true);
    select.hidden = false;
    assert.equal(pickerOf(select).element.hidden, false);
  });

  test("descriptions, invalid marks and error links set on the select are carried by the trigger", () => {
    const { select } = mounted();
    const trigger = triggerOf(select);
    select.setAttribute("aria-describedby", "hint-a hint-b");
    select.setAttribute("aria-invalid", "true");
    select.setAttribute("aria-errormessage", "modal-error-1");
    assert.equal(trigger.getAttribute("aria-describedby"), "hint-a hint-b");
    assert.equal(trigger.getAttribute("aria-invalid"), "true");
    assert.equal(trigger.getAttribute("aria-errormessage"), "modal-error-1");
    select.setAttribute("aria-describedby", "hint-b");
    select.removeAttribute("aria-invalid");
    assert.equal(trigger.getAttribute("aria-describedby"), "hint-b", "a hint that goes away leaves the description");
    assert.equal(trigger.hasAttribute("aria-invalid"), false);
  });

  test("focusing the select focuses the trigger, which is what people use", () => {
    const { select } = mounted();
    select.focus();
    same(document.activeElement, triggerOf(select));
  });

  test("nothing gets a style attribute (CSP)", () => {
    const { select } = mounted();
    select.value = "weekly";
    select.disabled = true;
    assert.equal(pickerOf(select).element.hasAttribute("style"), false);
    assert.equal(triggerOf(select).hasAttribute("style"), false);
  });
});

describe("BT-004-05 the field label names the trigger", () => {
  test("label[for] points at the trigger and the spoken name uses the field's words", () => {
    const { select, node } = mounted(PERIODS, "weekly", {}, {}, "Budget period");
    const label = node.querySelector("label");
    assert.equal(label.getAttribute("for"), triggerOf(select).id);
    assert.equal(triggerOf(select).getAttribute("aria-label"), "Budget period: Weekly. Search and choose.");
  });

  test("the field's help text describes the trigger", () => {
    const { select, node } = mounted(PERIODS, "monthly", {}, {}, "Period", { help: "How often the budget starts again." });
    const help = node.querySelector(".field__help");
    assert.ok(help.id);
    assert.equal(triggerOf(select).getAttribute("aria-describedby"), help.id);
  });

  test("the panel, its list and its search box are named after the field", () => {
    const { select } = mounted(PERIODS, "monthly", {}, {}, "Currency");
    triggerOf(select).click();
    assert.equal(panel().getAttribute("aria-label"), "Currency");
    assert.equal(panel().querySelector(".cmdpick__list").getAttribute("aria-label"), "Currency");
    assert.equal(panel().querySelector(".cmdpick__search").getAttribute("aria-label"), "Search currency");
    assert.equal(panel().querySelector(".cmdpick__search").getAttribute("placeholder"), "Search currency…");
  });

  test("a select placed without a field is named by its own aria-label", () => {
    const select = pickerSelect(PERIODS, "monthly", { "aria-label": "Role for Bob Fictional" }, { search: false });
    dom.body.appendChild(controlElement(select));
    assert.equal(triggerOf(select).getAttribute("aria-label"), "Role for Bob Fictional: Monthly. Choose.", "a list without a search box is not called searchable");
  });
});

describe("BT-004-05 change semantics the views rely on", () => {
  test("choosing fires input then change on the select, once each, as a native select does", () => {
    const { select } = mounted();
    const heard = [];
    select.addEventListener("input", () => heard.push("input"));
    select.addEventListener("change", () => heard.push(`change:${select.value}`));
    triggerOf(select).click();
    press(panel(), "ArrowDown");
    press(panel(), "Enter");
    assert.deepEqual(heard, ["input", "change:weekly"]);
    same(document.activeElement, triggerOf(select), "focus is back on the trigger");
  });

  test("choosing what is already chosen closes the panel and fires nothing", () => {
    const { select } = mounted();
    const heard = [];
    select.addEventListener("change", () => heard.push("change"));
    select.addEventListener("input", () => heard.push("input"));
    triggerOf(select).click();
    press(panel(), "Enter");
    none(panel());
    assert.deepEqual(heard, [], "a native select does not report re-choosing its value");
  });

  test("commitOnConfirm still commits once on a choice and never on browsing or Escape (A11Y-002)", () => {
    const { select } = mounted([{ value: "viewer", label: "Viewer" }, { value: "member", label: "Member" }, { value: "manager", label: "Manager" }], "member", {}, { search: false }, "Role");
    const commits = [];
    const committer = commitOnConfirm(select, (v) => commits.push(v));
    triggerOf(select).click();
    press(panel(), "ArrowDown");
    press(panel(), "Escape");
    assert.deepEqual(commits, [], "browsing and Escape commit nothing");
    assert.equal(select.value, "member");
    triggerOf(select).click();
    press(panel(), "ArrowDown");
    press(panel(), "Enter");
    assert.deepEqual(commits, ["manager"]);
    committer.reset("viewer");
    assert.equal(valueText(select), "Viewer", "reset() repaints the trigger");
    assert.deepEqual(commits, ["manager"], "and commits nothing");
  });
});

describe("BT-004-05 inside a modal dialog", () => {
  function inModal(picker = {}) {
    const select = pickerSelect(PERIODS, "monthly", {}, picker);
    const modal = openModal({ title: "Add budget", body: [field("Period", select)] });
    return { select, modal };
  }
  const dialogOpen = () => !!dom.body.querySelector(".modal");
  // The modal listens on the document in the capture phase, so it hears a key before the panel does:
  // the key is offered to the document first, then to the element, as in a browser.
  const keyAt = (node, key, extra = {}) => {
    document.dispatchEvent(Object.assign(new DomEvent("keydown", { key, target: node }), extra));
    return press(node, key, extra);
  };

  test("Escape in a list without a search box closes the list, not the dialog; the next Escape closes the dialog", () => {
    const { select } = inModal({ search: false });
    triggerOf(select).click();
    const list = panel().querySelector(".cmdpick__list");
    same(document.activeElement, list, "the list holds the keyboard");
    keyAt(list, "Escape");
    assert.ok(dialogOpen(), "the dialog and what was typed in it stay");
    none(panel(), "the list closed");
    same(document.activeElement, triggerOf(select));
    keyAt(triggerOf(select), "Escape");
    assert.equal(dialogOpen(), false, "the next Escape closes the dialog");
  });

  test("Escape in the search box closes only the panel too", () => {
    const { select } = inModal();
    triggerOf(select).click();
    keyAt(panel().querySelector(".cmdpick__search"), "Escape");
    assert.ok(dialogOpen());
    none(panel());
  });

  test("Tab from the panel's last stop closes it and continues from the trigger; Shift+Tab from its first does too", () => {
    const { select } = inModal();
    triggerOf(select).click();
    const e = press(panel().querySelector(".cmdpick__search"), "Tab");
    none(panel(), "Tab left the panel");
    same(document.activeElement, triggerOf(select), "from the trigger, the browser's Tab moves on to the next field");
    assert.equal(e.defaultPrevented, false, "the browser still moves focus");
    triggerOf(select).click();
    const back = press(panel().querySelector(".cmdpick__search"), "Tab", { shiftKey: true });
    none(panel());
    same(document.activeElement, triggerOf(select));
    assert.equal(back.defaultPrevented, false);
  });

  test("Tab from the search box moves on to a pinned create action inside the panel", () => {
    const select = pickerSelect(PERIODS, "monthly", {}, { create: { label: "New period", onPick() {} } });
    dom.body.appendChild(field("Period", select));
    triggerOf(select).click();
    press(panel().querySelector(".cmdpick__search"), "Tab");
    assert.ok(panel(), "still open: the create action is the next stop");
    press(panel().querySelector(".cmdpick__create"), "Tab");
    none(panel(), "Tab from the last stop leaves");
  });

  // One event, offered to the document's capture listeners (the modal) and then to the element, as in
  // a browser — so what the modal did to it (preventDefault) is visible to the assertions.
  const keyThrough = (node, key, extra = {}) => {
    const e = Object.assign(new DomEvent("keydown", { bubbles: true, key, target: node }), extra);
    document.dispatchEvent(e);
    if (!e.propagationStopped) node.dispatchEvent(e);
    return e;
  };

  test("the open panel is inside the dialog, so aria-modal never hides its options (a11y review finding 4)", () => {
    const { select } = inModal();
    const dialog = dom.body.querySelector(".modal");
    triggerOf(select).click();
    assert.ok(panel(), "open");
    assert.ok(dialog.contains(panel()), "the panel is in the aria-modal dialog's subtree");
    assert.equal(panel().getAttribute("role"), "dialog");
    // Still dismissed by a press outside it, even though it now lives inside the dialog.
    document.dispatchEvent(new DomEvent("mousedown", { bubbles: true, target: dialog.querySelector("h2") }));
    none(panel(), "a press on the dialog's own title closes the panel");
    assert.ok(dialogOpen(), "and not the dialog");
  });

  test("outside a dialog the panel still floats on the body (TaskTracker's placement)", () => {
    const { select } = mounted();
    triggerOf(select).click();
    same(panel().parentNode, dom.body);
  });

  test("the dialog's Tab trap leaves Tab inside an open panel to the panel, even when the picker is the dialog's last control", () => {
    const select = pickerSelect(PERIODS, "monthly");
    openModal({ title: "Choose a period", body: [field("Period", select)] });
    triggerOf(select).click();
    const e = keyThrough(panel().querySelector(".cmdpick__search"), "Tab");
    none(panel(), "Tab left the panel");
    same(document.activeElement, triggerOf(select), "focus is back on the trigger, where the browser's Tab continues");
    assert.equal(e.defaultPrevented, false, "the dialog did not wrap focus to its first control");
  });

  test("closing the dialog closes a panel opened from it", () => {
    const { select, modal } = inModal();
    triggerOf(select).click();
    assert.ok(panel());
    modal.close();
    none(panel(), "no panel is left floating over the page");
  });

  test("a control that leaves the page takes its open panel with it at the next press", () => {
    const { select, node } = mounted();
    triggerOf(select).click();
    dom.body.removeChild(node);
    document.dispatchEvent(new DomEvent("mousedown", { bubbles: true, target: dom.body }));
    none(panel());
  });
});

describe("BT-004-05 focus after navigation skips the hidden select (UX review U7)", () => {
  test("focusFirst lands on the heading even when a dropdown comes first in the view", async () => {
    const { focusFirst } = await import("../js/ui/dom.js");
    const view = document.createElement("div");
    const select = pickerSelect(PERIODS, "monthly");
    view.appendChild(field("Show", select));
    const heading = document.createElement("h1");
    heading.textContent = "Merchants";
    view.appendChild(heading);
    dom.body.appendChild(view);
    focusFirst(view);
    same(document.activeElement, heading, "not the hidden select (tabindex -1), and not its trigger");
  });

  test("focusFirst skips anything inside an aria-hidden subtree", async () => {
    const { focusFirst } = await import("../js/ui/dom.js");
    const view = document.createElement("div");
    const decoy = document.createElement("div");
    decoy.setAttribute("aria-hidden", "true");
    const hiddenTarget = document.createElement("span");
    hiddenTarget.setAttribute("tabindex", "-1");
    decoy.appendChild(hiddenTarget);
    view.appendChild(decoy);
    const heading = document.createElement("h2");
    view.appendChild(heading);
    dom.body.appendChild(view);
    focusFirst(view);
    same(document.activeElement, heading);
  });
});

describe("BT-004-05 nothing is cut off (real layout is checked in a browser)", () => {
  test("the panel is at least as wide as its trigger, through a custom property", () => {
    const create = document.createElement;
    document.createElement = (tag) => {
      const node = create(tag);
      node.getBoundingClientRect = function () {
        return this.classList.contains("cmdpick__panel")
          ? { top: 0, left: 0, width: 240, height: 160, bottom: 160, right: 240 }
          : { top: 10, left: 20, width: 310, height: 36, bottom: 46, right: 330 };
      };
      return node;
    };
    document.defaultView = { innerWidth: 1280, innerHeight: 900 };
    const { select } = mounted();
    triggerOf(select).click();
    assert.equal(panel().style.getPropertyValue("--pop-min-width"), "310px");
    assert.equal(panel().hasAttribute("style"), false);
  });

  test("the stylesheet honours that width and lets long option names wrap instead of hiding them", () => {
    const css = fs.readFileSync(fileURLToPath(new URL("../styles/components.css", import.meta.url)), "utf8");
    const rule = (name) => (new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css) || [])[1] || "";
    assert.match(rule("cmdpick__panel"), /min-width:[^;]*var\(--pop-min-width/);
    assert.doesNotMatch(rule("cmdpick__optlabel"), /nowrap/);
  });
});
