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
  test("the trigger names the field AND its current value, and says whether it is open", () => {
    const { picker } = mount({ value: "rent" });
    assert.equal(trigger(picker).getAttribute("aria-label"), "Category: Rent and housing. Search and choose.");
    assert.equal(trigger(picker).getAttribute("aria-expanded"), "false");
    open(picker);
    assert.equal(trigger(picker).getAttribute("aria-expanded"), "true");
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
  // The double has no layout, so every element is given a fixed rectangle: the panel's natural size
  // and the trigger's position. Only the arithmetic and the CSS variables are asserted.
  function withGeometry({ panelHeight, viewportHeight, anchorTop = 10 }) {
    const create = document.createElement;
    document.createElement = (tag) => {
      const node = create(tag);
      node.getBoundingClientRect = function () {
        return this.classList.contains("cmdpick__panel")
          ? { top: 0, left: 0, width: 352, height: panelHeight, bottom: panelHeight, right: 352 }
          : { top: anchorTop, left: 40, width: 200, height: 36, bottom: anchorTop + 36, right: 240 };
      };
      return node;
    };
    document.defaultView = { innerWidth: 390, innerHeight: viewportHeight };
  }

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
