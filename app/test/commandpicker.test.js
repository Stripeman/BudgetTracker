// BT-004-04 — THE COMMAND PALETTE PICKER, ported from TaskTracker app/test/commandpicker.test.js
// (T: main fb24a41) onto BudgetTracker's DOM double. The behavioural contract is TaskTracker's: the
// value that is submitted, the keyboard, the accessible name, and the fact that the native select is
// still the one answer to "what is chosen". The last blocks cover BudgetTracker's documented
// adaptations (A1 hidden select out of the tab order, A2 combobox with a real active-descendant id,
// A3 a pinned create button that works from the keyboard). Layout, placement and real screen-reader
// output need a real browser; nothing here claims them.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { installDom, DomEvent } from "./domdouble.js";
import { createCommandPicker } from "../js/ui/commandpicker.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const OPTIONS = [
  { value: "food", label: "Food" },
  { value: "rent", label: "Rent and housing" },
  { value: "travel", label: "Travel" },
];

function selectOf(options, value) {
  const select = document.createElement("select");
  for (const o of options) {
    const option = document.createElement("option");
    option.setAttribute("value", o.value);
    option.textContent = o.label;
    if (o.disabled) option.setAttribute("disabled", "");
    select.appendChild(option);
  }
  select.value = value;
  return select;
}

function mount({ value = "food", options = OPTIONS, ...rest } = {}) {
  const select = selectOf(options, value);
  const picker = createCommandPicker({ select, label: "Category", ...rest });
  dom.body.appendChild(picker.element);
  return { picker, select };
}

const trigger = (picker) => picker.element.querySelector(".cmdpick__trigger");
const panel = () => dom.body.querySelector(".cmdpick__panel");
const rows = () => dom.body.querySelectorAll(".cmdpick__opt");
const labelOf = (row) => row.querySelector(".cmdpick__optlabel").textContent;
const open = (picker) => trigger(picker).click();
const press = (node, key) => { const e = new DomEvent("keydown", { bubbles: true, key }); node.dispatchEvent(e); return e; };
const type = (box, value) => { box.value = value; box.dispatchEvent(new DomEvent("input", { bubbles: true })); };
const mousedown = (node) => node.dispatchEvent(new DomEvent("mousedown", { bubbles: true }));
// Element identity is asserted with booleans: handing a DOM-double node to assert makes a failing
// report serialise the whole cyclic document graph, which hangs instead of failing.
const same = (a, b, message = "not the expected element") => assert.ok(a === b, message);
const none = (a, message = "expected no element") => assert.ok(a === null || a === undefined, message);

describe("BT-004-04 THE SELECT IS STILL THE VALUE (TaskTracker contract)", () => {
  test("the native select stays in the control, hidden from sight, the tab order and the accessibility tree (A1)", () => {
    const { picker, select } = mount();
    assert.ok(picker.element.contains(select), "it was not removed, only presented differently");
    assert.ok(select.classList.contains("cmdpick__native"));
    assert.equal(select.getAttribute("tabindex"), "-1", "no invisible tab stop");
    assert.equal(select.getAttribute("aria-hidden"), "true", "no second, unlabelled copy for a screen reader");
  });

  test("read() is the select's value, so the two can never disagree", () => {
    const { picker, select } = mount({ value: "rent" });
    assert.equal(picker.read(), "rent");
    select.value = "travel";
    assert.equal(picker.read(), "travel", "a value set from outside is honoured, not fought");
  });

  test("CHOOSING WRITES THE SELECT AND FIRES ITS CHANGE EVENT once", () => {
    const { picker, select } = mount();
    let heard = 0;
    select.addEventListener("change", () => { heard += 1; });
    open(picker);
    press(panel(), "End");
    press(panel(), "Enter");
    assert.equal(select.value, "travel");
    assert.equal(heard, 1, "anything listening to the select hears the change, once");
    assert.equal(picker.read(), "travel");
    none(panel(), "and the palette closed");
  });

  test("a value set from outside repaints the trigger", () => {
    const { picker, select } = mount();
    select.value = "rent";
    select.dispatchEvent(new DomEvent("change", { bubbles: true }));
    assert.equal(picker.element.querySelector(".cmdpick__value").textContent, "Rent and housing");
  });
});

describe("BT-004-04 THE PALETTE", () => {
  test("closed, it shows the chosen label and nothing is on the page", () => {
    const { picker } = mount({ value: "rent" });
    assert.equal(picker.element.querySelector(".cmdpick__value").textContent, "Rent and housing");
    none(panel());
  });

  test("it opens over the page, attached to the body rather than nested in the field", () => {
    const { picker } = mount();
    open(picker);
    assert.ok(panel());
    same(panel().parentNode, dom.body, "attached to the body");
    none(picker.element.querySelector(".cmdpick__panel"), "not nested in the field");
  });

  test("SEARCH FILTERS by name, case-insensitively, and an empty result says so", () => {
    const { picker } = mount();
    open(picker);
    assert.equal(rows().length, 3);
    type(panel().querySelector(".cmdpick__search"), "HOUS");
    assert.deepEqual(rows().map(labelOf), ["Rent and housing"]);
    type(panel().querySelector(".cmdpick__search"), "zzz");
    assert.equal(rows().length, 0);
    assert.match(dom.body.querySelector(".cmdpick__none").textContent, /Nothing matches/);
    type(panel().querySelector(".cmdpick__search"), "");
    assert.equal(rows().length, 3, "clearing it restores the whole list");
  });

  test("each open starts with an empty search box", () => {
    const { picker } = mount();
    open(picker);
    type(panel().querySelector(".cmdpick__search"), "tra");
    press(panel(), "Escape");
    open(picker);
    assert.equal(panel().querySelector(".cmdpick__search").value, "");
    assert.equal(rows().length, 3);
  });

  test("the chosen option is marked, not merely coloured", () => {
    const { picker } = mount({ value: "travel" });
    open(picker);
    const on = rows().filter((r) => r.getAttribute("aria-selected") === "true");
    assert.equal(on.length, 1);
    assert.equal(labelOf(on[0]), "Travel");
    assert.ok(on[0].querySelector(".cmdpick__tick"), "with a tick as well as weight");
  });
});

describe("BT-004-04 KEYBOARD", () => {
  test("the trigger opens on ArrowDown, Enter and Space", () => {
    for (const key of ["ArrowDown", "Enter", " "]) {
      const { picker } = mount();
      press(trigger(picker), key);
      assert.ok(panel(), `${JSON.stringify(key)} opens it`);
      picker.destroy();
      none(panel());
    }
  });

  test("ARROWS MOVE AND ENTER CHOOSES; moving alone commits nothing", () => {
    const { picker, select } = mount({ value: "food" });
    let heard = 0;
    select.addEventListener("change", () => { heard += 1; });
    open(picker);
    press(panel(), "ArrowDown");
    assert.equal(select.value, "food", "an arrow only moves");
    assert.equal(heard, 0);
    press(panel(), "Enter");
    assert.equal(select.value, "rent", "moved one and took it");
  });

  test("Home and End reach both ends", () => {
    const { picker, select } = mount({ value: "rent" });
    open(picker);
    press(panel(), "Home");
    press(panel(), "Enter");
    assert.equal(select.value, "food");
    open(picker);
    press(panel(), "End");
    press(panel(), "Enter");
    assert.equal(select.value, "travel");
  });

  test("ESCAPE CLOSES THE PALETTE, NOT WHAT IS AROUND IT, and focus returns to the trigger", () => {
    const { picker, select } = mount();
    let escaped = 0;
    dom.body.addEventListener("keydown", (e) => { if (e.key === "Escape") escaped += 1; });
    open(picker);
    press(panel(), "ArrowDown");
    const e = press(panel(), "Escape");
    none(panel(), "the palette closed");
    assert.equal(e.defaultPrevented, true);
    assert.equal(escaped, 0, "the event did not reach anything above it");
    same(document.activeElement, trigger(picker));
    assert.equal(select.value, "food", "and nothing was chosen");
  });

  test("a pointer press on a row chooses it", () => {
    const { picker, select } = mount();
    open(picker);
    mousedown(rows().find((r) => labelOf(r) === "Travel"));
    assert.equal(select.value, "travel");
    none(panel());
  });
});

describe("BT-004-04 ACCESSIBILITY", () => {
  test("the trigger is a select-only combobox: named by the field, its value spoken, how to use it described, open or not (a11y review finding 6)", () => {
    const { picker } = mount({ value: "rent" });
    const t = trigger(picker);
    assert.equal(t.tagName, "BUTTON");
    assert.equal(t.getAttribute("role"), "combobox");
    assert.equal(t.getAttribute("aria-label"), "Category", "the name is the field alone, no value and no instructions");
    assert.equal(picker.element.querySelector(".cmdpick__spoken").textContent, "Rent and housing", "the value, in the trigger's text");
    assert.equal(picker.element.querySelector(".cmdpick__value").getAttribute("aria-hidden"), "true", "the visible copy is not read twice");
    const how = picker.element.querySelector(`#${t.id}-how`);
    assert.equal(how.textContent, "Search and choose.");
    assert.ok(how.hasAttribute("hidden"), "read as a description only, never in browse mode");
    assert.equal(t.getAttribute("aria-describedby"), `${t.id}-how`);
    assert.equal(t.getAttribute("aria-haspopup"), "dialog");
    assert.equal(t.getAttribute("aria-expanded"), "false");
    open(picker);
    assert.equal(t.getAttribute("aria-expanded"), "true");
    assert.equal(t.getAttribute("aria-controls"), panel().id, "it names the panel it opened");
  });

  test("with a visible <label for> naming it, the trigger carries no aria-label of its own (the label is its name)", () => {
    const labelled = mount({ labelVisible: true });
    assert.equal(trigger(labelled.picker).hasAttribute("aria-label"), false);
    const fielded = mount();
    fielded.picker.setLabel("Spending category"); // what components.js field() does, beside its <label for>
    assert.equal(trigger(fielded.picker).hasAttribute("aria-label"), false);
    const unlabelled = mount();
    unlabelled.picker.setLabel("Role for Bob Fictional", { visible: false });
    assert.equal(trigger(unlabelled.picker).getAttribute("aria-label"), "Role for Bob Fictional");
  });

  test("a list without a search box is described as Choose.", () => {
    const { picker } = mount({ search: false });
    const t = trigger(picker);
    assert.equal(picker.element.querySelector(`#${t.id}-how`).textContent, "Choose.");
  });

  test("the spoken value is the full description when there is one, and the badge is not read on its own", () => {
    const { picker } = mount({
      value: "rent",
      describeOf: (v) => (v === "rent" ? "Rent and housing — shared" : null),
      badgeOf: () => { const b = document.createElement("span"); b.setAttribute("role", "img"); b.setAttribute("aria-label", "Shared"); return b; },
    });
    assert.equal(picker.element.querySelector(".cmdpick__spoken").textContent, "Rent and housing — shared");
    assert.equal(picker.element.querySelector(".cmdpick__badge").getAttribute("aria-hidden"), "true");
    picker.element.querySelector("select").value = "food";
    picker.refresh();
    assert.equal(picker.element.querySelector(".cmdpick__spoken").textContent, "Food", "no description: the label");
  });

  test("required, invalid and the error text reach the trigger from the select; the error is described only while invalid", () => {
    const { picker, select } = mount();
    const t = trigger(picker);
    select.required = true;
    select.setAttribute("aria-describedby", "help-1");
    select.setAttribute("aria-invalid", "true");
    select.setAttribute("aria-errormessage", "err-1");
    picker.refresh();
    assert.equal(t.getAttribute("aria-required"), "true");
    assert.equal(t.getAttribute("aria-invalid"), "true");
    assert.equal(t.getAttribute("aria-errormessage"), "err-1");
    assert.equal(t.getAttribute("aria-describedby"), `help-1 err-1 ${t.id}-how`, "help, then the error, then how to use it");
    select.removeAttribute("aria-invalid");
    select.required = false;
    picker.refresh();
    assert.equal(t.hasAttribute("aria-invalid"), false);
    assert.equal(t.hasAttribute("aria-required"), false);
    assert.equal(t.getAttribute("aria-describedby"), `help-1 ${t.id}-how`, "the error text goes with the invalid mark");
  });

  test("the list is a listbox of options, and the search box is its combobox (A2)", () => {
    const { picker } = mount();
    open(picker);
    const list = dom.body.querySelector(".cmdpick__list");
    const box = panel().querySelector(".cmdpick__search");
    assert.equal(list.getAttribute("role"), "listbox");
    for (const row of rows()) assert.equal(row.getAttribute("role"), "option");
    assert.equal(box.getAttribute("role"), "combobox");
    assert.equal(box.getAttribute("aria-controls"), list.id);
    assert.equal(box.getAttribute("aria-expanded"), "true");
    assert.match(box.getAttribute("aria-label"), /category/i);
    same(document.activeElement, box, "the palette opens onto its search box");
  });

  test("aria-activedescendant names the active row's id, on the focused box, and follows the keyboard (A2)", () => {
    const { picker } = mount({ value: "food" });
    open(picker);
    const box = panel().querySelector(".cmdpick__search");
    const idOf = () => box.getAttribute("aria-activedescendant");
    const byId = (id) => rows().find((r) => r.id === id);
    assert.ok(byId(idOf()), "an element id, not an option value");
    assert.equal(labelOf(byId(idOf())), "Food");
    press(panel(), "ArrowDown");
    assert.equal(labelOf(byId(idOf())), "Rent and housing");
    assert.ok(byId(idOf()).classList.contains("cmdpick__opt--active"));
  });

  test("disabling it disables the select as well as the trigger, and it will not open", () => {
    const { picker, select } = mount();
    picker.setDisabled(true);
    assert.equal(select.disabled, true);
    assert.equal(trigger(picker).disabled, true);
    press(trigger(picker), "Enter");
    none(panel());
  });
});

describe("BT-004-04 COLOUR, ONLY WHERE THERE IS ONE", () => {
  const colours = { food: "#2563eb", rent: "#16a34a" };

  test("a swatch appears when the chosen thing has a colour, through a custom property", () => {
    const { picker } = mount({ colorOf: (v) => colours[v] || null });
    assert.ok(picker.element.classList.contains("cmdpick--swatched"));
    assert.equal(picker.element.style.getPropertyValue("--swatch"), "#2563eb");
    assert.equal(picker.element.hasAttribute("style"), false, "no style attribute (CSP)");
    open(picker);
    assert.ok(rows()[0].querySelector(".cmdpick__dot"));
    assert.equal(rows()[0].style.getPropertyValue("--swatch"), "#2563eb");
    none(rows()[2].querySelector(".cmdpick__dot"), "no invented colour");
    assert.deepEqual(rows().map(labelOf), ["Food", "Rent and housing", "Travel"], "the name is always beside it");
  });

  test("choosing something without a colour removes the swatch", () => {
    const { picker } = mount({ colorOf: (v) => colours[v] || null });
    open(picker);
    press(panel(), "End");
    press(panel(), "Enter");
    assert.ok(!picker.element.classList.contains("cmdpick--swatched"));
    assert.equal(picker.element.style.getPropertyValue("--swatch"), "");
  });
});

describe("BT-004-04 THE CLASSES IT EMITS ACTUALLY EXIST (TaskTracker shipped them unstyled once)", () => {
  const css = fs.readFileSync(fileURLToPath(new URL("../styles/components.css", import.meta.url)), "utf8");
  const defined = new Set((css.match(/\.[A-Za-z][A-Za-z0-9_-]*/g) || []).map((s) => s.slice(1)));

  test("every cmdpick class the component renders is defined in the stylesheet", () => {
    const { picker } = mount({ colorOf: () => "#2563eb", create: { label: "New category", onPick() {} }, options: [...OPTIONS, { value: "gone", label: "Gone", disabled: true }] });
    open(picker);
    const emitted = new Set(["cmdpick__native"]);
    const collect = (node) => {
      for (const name of (node.getAttribute("class") || "").split(/\s+/)) if (name.startsWith("cmdpick")) emitted.add(name);
      for (const child of node.children) collect(child);
    };
    collect(picker.element);
    collect(panel());
    type(panel().querySelector(".cmdpick__search"), "zzzz");
    collect(panel());
    picker.destroy();
    const plain = mount({ search: false });
    open(plain.picker);
    collect(panel());
    assert.ok(emitted.size >= 20, `expected the component's classes, got ${emitted.size}`);
    const missing = [...emitted].filter((name) => !defined.has(name));
    assert.deepEqual(missing, [], `rendered but styled nowhere: ${missing.join(", ")}`);
  });

  test("THE NATIVE SELECT IS HIDDEN BY CLIPPING, NOT display:none — it is still the value holder", () => {
    const rule = /\.cmdpick__native\s*\{([^}]*)\}/.exec(css);
    assert.ok(rule);
    assert.ok(!/display\s*:\s*none/.test(rule[1]));
    assert.match(rule[1], /clip-path/);
  });

  test("the panel is placed through custom properties, never a style attribute", () => {
    const rule = /\.cmdpick__panel\s*\{([^}]*)\}/.exec(css);
    assert.match(rule[1], /var\(--pop-top/);
    assert.match(rule[1], /var\(--pop-left/);
  });
});

describe("BT-004-04 AN OPTION THAT CANNOT BE CHOSEN IS SHOWN, NOT HIDDEN", () => {
  const WITH_OFF = [
    { value: "food", label: "Food" },
    { value: "old", label: "Old category — archived, not for new entries", disabled: true },
    { value: "travel", label: "Travel" },
  ];

  test("it appears with its reason and is marked unchoosable to assistive technology", () => {
    const { picker } = mount({ options: WITH_OFF });
    open(picker);
    assert.equal(rows().length, 3);
    const off = rows().find((r) => r.classList.contains("cmdpick__opt--off"));
    assert.match(labelOf(off), /archived/);
    assert.equal(off.getAttribute("aria-disabled"), "true");
    assert.equal(off.hasAttribute("disabled"), false, "aria-disabled, not the disabled attribute");
  });

  test("pressing it changes nothing", () => {
    const { picker, select } = mount({ options: WITH_OFF });
    open(picker);
    mousedown(rows().find((r) => r.classList.contains("cmdpick__opt--off")));
    assert.equal(select.value, "food");
  });

  test("the keyboard steps over it, and End lands on the last choosable option", () => {
    const { picker, select } = mount({ options: WITH_OFF });
    open(picker);
    press(panel(), "ArrowDown");
    press(panel(), "Enter");
    assert.equal(select.value, "travel", "skipped the unavailable row");
    const last = mount({ options: [...WITH_OFF, { value: "zzz", label: "Closed", disabled: true }] });
    open(last.picker);
    press(dom.body.querySelectorAll(".cmdpick__panel").at(-1), "End");
    press(dom.body.querySelectorAll(".cmdpick__panel").at(-1), "Enter");
    assert.equal(last.select.value, "travel");
  });
});

describe("BT-004-04 A SHORT VOCABULARY GETS NO SEARCH BOX", () => {
  test("no box; the list takes the keyboard; a letter moves, Enter chooses", () => {
    const { picker, select } = mount({ search: false });
    open(picker);
    const list = panel().querySelector(".cmdpick__list");
    none(panel().querySelector(".cmdpick__search"), "no search box");
    assert.ok(panel().classList.contains("cmdpick__panel--nosearch"));
    same(document.activeElement, list);
    assert.equal(list.getAttribute("tabindex"), "-1");
    press(panel(), "t");
    assert.equal(select.value, "food", "type-ahead moves, it does not choose");
    assert.equal(labelOf(rows().find((r) => r.id === list.getAttribute("aria-activedescendant"))), "Travel");
    press(panel(), "Enter");
    assert.equal(select.value, "travel");
  });

  test("a long list gets its search box back regardless", () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ value: `v${i}`, label: `Option ${i}` }));
    const { picker } = mount({ options: many, value: "v0", search: false });
    open(picker);
    assert.ok(panel().querySelector(".cmdpick__search"));
  });
});

describe("BT-004-04 THE PINNED CREATE ACTION (adaptation A3)", () => {
  test("it sits under the results, outside the listbox, and its name is the plain label", () => {
    const { picker } = mount({ create: { label: "New category", onPick() {} } });
    open(picker);
    const button = panel().querySelector(".cmdpick__create");
    const list = panel().querySelector(".cmdpick__list");
    same(button.parentNode, panel(), "pinned in the panel, not scrolled away in the list");
    assert.ok(list.children.every((c) => c.getAttribute("role") === "option"), "the listbox holds only options");
    assert.equal(button.tagName, "BUTTON");
    assert.equal(button.querySelector(".cmdpick__plus").getAttribute("aria-hidden"), "true");
    assert.equal(button.querySelector(".cmdpick__createlabel").textContent, "New category");
  });

  test("activating it (click, which Enter and Space produce on a button) closes the palette, returns focus to the trigger first, and passes the search text", () => {
    const picks = [];
    const { picker } = mount({ create: { label: "New category", onPick: (term) => picks.push({ term, focus: document.activeElement }) } });
    open(picker);
    type(panel().querySelector(".cmdpick__search"), "Pets");
    assert.equal(panel().querySelector(".cmdpick__createlabel").textContent, "New category “Pets”");
    panel().querySelector(".cmdpick__create").click();
    assert.equal(picks.length, 1);
    assert.equal(picks[0].term, "Pets");
    same(picks[0].focus, trigger(picker), "focus was already back on the trigger");
    none(panel());
  });

  test("Enter on the create button does not choose the highlighted row (TaskTracker defect)", () => {
    const picks = [];
    const { picker, select } = mount({ create: { label: "New category", onPick: () => picks.push(1) } });
    open(picker);
    press(panel(), "ArrowDown");
    const button = panel().querySelector(".cmdpick__create");
    button.focus();
    press(button, "Enter");
    assert.equal(select.value, "food", "the row under the highlight was not chosen");
    assert.ok(panel(), "the palette is still open; the button's own click does the work");
    press(button, "ArrowUp");
    same(document.activeElement, panel().querySelector(".cmdpick__search"), "ArrowUp goes back to the search box");
  });
});

describe("BT-004-04 PLACEMENT (through custom properties; real layout is checked in a browser)", () => {
  // The double has no layout, so every element is given a fixed rectangle: the panel's natural size,
  // its list (the panel less its search row and hints, `chrome`), one option row, and the trigger's
  // position. Only the arithmetic and the CSS variables are asserted.
  function withGeometry({ panelHeight, viewportHeight, anchorTop = 10, chrome = 86, rowHeight = 36, viewportWidth = 390 }) {
    const create = document.createElement;
    const box = (width, height) => ({ top: 0, left: 0, width, height, bottom: height, right: width });
    document.createElement = (tag) => {
      const node = create(tag);
      node.getBoundingClientRect = function () {
        if (this.classList.contains("cmdpick__panel")) return box(352, panelHeight);
        if (this.classList.contains("cmdpick__list")) return box(352, panelHeight - chrome);
        if (this.classList.contains("cmdpick__opt")) return box(340, rowHeight);
        return { top: anchorTop, left: 40, width: 200, height: 36, bottom: anchorTop + 36, right: 240 };
      };
      return node;
    };
    document.defaultView = { innerWidth: viewportWidth, innerHeight: viewportHeight };
  }

  test("AT 400 % ZOOM (320 × 256) the panel spans the viewport and keeps at least 2.5 rows readable (a11y review finding 1)", () => {
    // Trigger 110–146; below = 256 - 146 - 12 = 98, above = 110 - 12 = 98. Useful minimum = search row
    // 46 + 2.5 × 38 = 141, more than either side, so it spans: min(294, 256 - 16) = 240 high, top 8.
    withGeometry({ panelHeight: 294, viewportHeight: 256, viewportWidth: 320, anchorTop: 110, chrome: 46, rowHeight: 38 });
    const { picker } = mount();
    open(picker);
    assert.equal(panel().style.getPropertyValue("--pop-max-height"), "240px");
    assert.equal(panel().style.getPropertyValue("--pop-top"), "8px");
    assert.equal(panel().style.getPropertyValue("--pop-left"), "8px", "pulled inside the 320 px viewport");
    assert.ok(240 - 46 >= 2.5 * 38, "the list keeps 194 px: five 38 px rows");
  });

  test("the key hints give their room to the list on short screens, and there is no hidden 70vh cap", () => {
    const css = fs.readFileSync(fileURLToPath(new URL("../styles/components.css", import.meta.url)), "utf8");
    assert.match(css, /@media\s*\(max-height:\s*30rem\)\s*\{\s*\.cmdpick__foot\s*\{\s*display:\s*none;?\s*\}/);
    const rule = /\.cmdpick__panel\s*\{([^}]*)\}/.exec(css)[1];
    assert.match(rule, /max-height:\s*var\(--pop-max-height,\s*none\)/);
  });

  test("below the trigger, inside the viewport, with no height cap when it fits", () => {
    withGeometry({ panelHeight: 167.6, viewportHeight: 844 });
    const { picker } = mount();
    open(picker);
    assert.equal(panel().style.getPropertyValue("--pop-top"), "50px", "anchor bottom 46 + gap 4");
    assert.equal(panel().style.getPropertyValue("--pop-left"), "30px", "pulled back from the right edge (390 - 8 - 352)");
    assert.equal(panel().style.getPropertyValue("--pop-max-height"), "", "a panel that fits is not capped, so a short list never scrolls");
    assert.equal(panel().hasAttribute("style"), false);
  });

  test("capped to the room there is when it does not fit", () => {
    withGeometry({ panelHeight: 400, viewportHeight: 300 });
    const { picker } = mount();
    open(picker);
    assert.equal(panel().style.getPropertyValue("--pop-max-height"), "242px", "300 - 46 - 4 - 8");
  });
});

describe("BT-004-05 RESULTS ARE ANNOUNCED (a11y review finding 3, WCAG 4.1.3)", () => {
  const status = () => panel().querySelector(".cmdpick__status");

  test("a polite, visually hidden status region in the panel, outside the listbox", () => {
    const { picker } = mount();
    open(picker);
    assert.ok(status(), "present");
    assert.equal(status().getAttribute("role"), "status");
    assert.equal(status().getAttribute("aria-live"), "polite");
    assert.equal(status().getAttribute("aria-atomic"), "true");
    assert.ok(status().classList.contains("sr-only"), "visually hidden");
    same(status().parentNode, panel(), "not inside the listbox, which may hold only options");
    assert.equal(status().textContent, "", "silent on opening a list that has options");
  });

  test("after typing pauses it says how many results, or that nothing matches", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { picker } = mount();
    open(picker);
    const box = panel().querySelector(".cmdpick__search");
    type(box, "o"); // Food, Rent and housing
    assert.equal(status().textContent, "", "not while typing");
    t.mock.timers.tick(399);
    assert.equal(status().textContent, "", "not before the pause");
    t.mock.timers.tick(1);
    assert.equal(status().textContent, "2 results");
    type(box, "tra");
    t.mock.timers.tick(400);
    assert.equal(status().textContent, "1 result");
    type(box, "euzzz");
    t.mock.timers.tick(400);
    assert.equal(status().textContent, "Nothing matches “euzzz”.");
  });

  test("typing again before the pause restarts the wait, so only the last count is spoken", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { picker } = mount();
    open(picker);
    const box = panel().querySelector(".cmdpick__search");
    type(box, "r"); // Rent and housing, Travel
    t.mock.timers.tick(300);
    type(box, "re"); // Rent and housing
    t.mock.timers.tick(300);
    assert.equal(status().textContent, "", "the first count was never spoken");
    t.mock.timers.tick(100);
    assert.equal(status().textContent, "1 result");
  });

  test("an empty list says so when it opens", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { picker } = mount({ options: [], value: "" });
    open(picker);
    t.mock.timers.tick(400);
    assert.equal(status().textContent, "Nothing to choose from.");
  });

  test("closing cancels a pending announcement", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { picker } = mount();
    open(picker);
    const region = status();
    type(panel().querySelector(".cmdpick__search"), "tra");
    press(panel(), "Escape");
    t.mock.timers.tick(400);
    assert.equal(region.textContent, "", "nothing is announced for a list that is gone");
  });
});

describe("BT-004-05 THE PANEL FOLLOWS ITS TRIGGER (a11y review finding 5, UX review U1)", () => {
  // A window and a visual viewport that can be resized and fired at, as a browser's are.
  function eventTarget(props = {}) {
    const listeners = new Map();
    return Object.assign({
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
      removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)); },
      fire(type) { for (const fn of [...(listeners.get(type) || [])]) fn({ type, target: this }); },
      count(type) { return (listeners.get(type) || []).length; },
    }, props);
  }
  // Rectangles read from `geo` at the moment they are asked for, so a test can "scroll" by moving the
  // trigger. `.scroller` stands for a dialog body with overflow:auto; `clip` is its visible box.
  let geo;
  function withLayout(initial = {}) {
    geo = { anchorTop: 10, anchorLeft: 40, panelHeight: 167.6, chrome: 86, rowHeight: 36, clip: null, ...initial };
    const create = document.createElement;
    const box = (top, left, width, height) => ({ top, left, width, height, bottom: top + height, right: left + width });
    document.createElement = (tag) => {
      const node = create(tag);
      node.getBoundingClientRect = function () {
        if (this.classList.contains("cmdpick__panel")) return box(0, 0, 352, geo.panelHeight);
        if (this.classList.contains("cmdpick__list")) return box(0, 0, 352, geo.panelHeight - geo.chrome);
        if (this.classList.contains("cmdpick__opt")) return box(0, 0, 340, geo.rowHeight);
        if (this.classList.contains("scroller")) return geo.clip || box(0, 0, 10000, 10000);
        return box(geo.anchorTop, geo.anchorLeft, 200, 36);
      };
      return node;
    };
    const view = eventTarget({
      innerWidth: 1280,
      innerHeight: 900,
      getComputedStyle: (n) => (n.classList && n.classList.contains("scroller") ? { overflowX: "hidden", overflowY: "auto" } : { overflowX: "visible", overflowY: "visible" }),
    });
    document.defaultView = view;
    return view;
  }
  function mountInScroller() {
    const scroller = document.createElement("div");
    scroller.classList.add("scroller");
    dom.body.appendChild(scroller);
    const select = selectOf(OPTIONS, "food");
    const picker = createCommandPicker({ select, label: "Category" });
    scroller.appendChild(picker.element);
    return { picker, scroller };
  }
  const scrolled = (target) => document.dispatchEvent(new DomEvent("scroll", { target }));
  const top = () => panel().style.getPropertyValue("--pop-top");
  const left = () => panel().style.getPropertyValue("--pop-left");

  test("when a dialog body or the page scrolls, the open panel moves with its trigger", () => {
    withLayout();
    const { picker, scroller } = mountInScroller();
    open(picker);
    assert.equal(top(), "50px", "10 + 36 + 4");
    geo.anchorTop = 210;
    scrolled(scroller);
    assert.equal(top(), "250px", "210 + 36 + 4: it followed the dialog body");
    geo.anchorTop = 110;
    scrolled(document);
    assert.equal(top(), "150px", "and the page");
  });

  test("the list's own scrolling does not move the panel", () => {
    withLayout();
    const { picker } = mountInScroller();
    open(picker);
    geo.anchorTop = 300;
    scrolled(panel().querySelector(".cmdpick__list"));
    assert.equal(top(), "50px");
  });

  test("after a window resize it is placed again inside the new width", () => {
    const view = withLayout({ anchorLeft: 600 });
    const { picker } = mountInScroller();
    open(picker);
    assert.equal(left(), "600px", "600 + 352 fits in 1280 - 8");
    view.innerWidth = 820;
    view.fire("resize");
    // The trigger (600–800) is still in the window; 600 + 352 - (820 - 8) = 140 past the edge, so 460.
    assert.equal(left(), "460px", "pulled back inside the narrower window");
  });

  test("when the on-screen keyboard shrinks the visual viewport, the panel is capped to what is still visible", () => {
    const view = withLayout({ panelHeight: 400, anchorTop: 300 });
    view.innerWidth = 390;
    view.innerHeight = 844;
    view.visualViewport = eventTarget({ width: 390, height: 844, offsetTop: 0, offsetLeft: 0 });
    const { picker } = mountInScroller();
    open(picker);
    assert.equal(panel().style.getPropertyValue("--pop-max-height"), "", "fits below at first: 844 - 336 - 12 = 496");
    view.visualViewport.height = 500;
    view.visualViewport.fire("resize");
    // below = 500 - 336 - 12 = 152; above = 300 - 12 = 288: above, capped at 288, top 8.
    assert.equal(panel().style.getPropertyValue("--pop-max-height"), "288px");
    assert.equal(top(), "8px");
  });

  test("when the trigger scrolls out of the dialog body's visible area, the list closes and focus stays on the trigger", () => {
    withLayout({ anchorTop: 200, clip: { top: 100, left: 0, width: 1280, height: 400, bottom: 500, right: 1280 } });
    const { picker, scroller } = mountInScroller();
    open(picker);
    assert.ok(panel());
    geo.anchorTop = 520; // under the dialog body's visible bottom (500), though still inside the window
    scrolled(scroller);
    none(panel(), "closed");
    same(document.activeElement, trigger(picker), "focus is on the trigger, not lost with the panel");
  });

  test("and when it leaves the window entirely", () => {
    withLayout();
    const { picker } = mountInScroller();
    open(picker);
    geo.anchorTop = -80;
    scrolled(document);
    none(panel());
    same(document.activeElement, trigger(picker));
  });

  test("closing stops following: no listeners are left on the window or the visual viewport", () => {
    const view = withLayout();
    view.visualViewport = eventTarget({ width: 1280, height: 900, offsetTop: 0, offsetLeft: 0 });
    const { picker } = mountInScroller();
    open(picker);
    assert.equal(view.count("resize"), 1);
    assert.equal(view.visualViewport.count("resize"), 1);
    press(panel(), "Escape");
    assert.equal(view.count("resize"), 0);
    assert.equal(view.visualViewport.count("resize"), 0);
    assert.equal(view.visualViewport.count("scroll"), 0);
  });
});

describe("BT-004-04 LEAVING THE PALETTE", () => {
  test("tabbing out closes it without pulling focus back; focus that went nowhere keeps it open", () => {
    const { picker } = mount();
    const elsewhere = document.createElement("button");
    dom.body.appendChild(elsewhere);
    open(picker);
    panel().dispatchEvent(new DomEvent("focusout", { bubbles: true, relatedTarget: null }));
    assert.ok(panel(), "a press on inert text is not leaving");
    const box = panel().querySelector(".cmdpick__search");
    box.dispatchEvent(new DomEvent("focusout", { bubbles: true, relatedTarget: elsewhere }));
    none(panel());
    assert.equal(picker.isOpen(), false);
    same(document.activeElement, box, "focus is not dragged back to the trigger");
  });
});
