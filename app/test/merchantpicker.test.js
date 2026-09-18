// BT-007-01 searchable merchant picker: filtering (accents, case, aliases), keyboard selection with
// aria-activedescendant, the "Add … as a new merchant" option, Escape handling and keeping a
// record's existing (possibly closed) merchant. Pointer picks and scrolling need a real browser.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { createMerchantPicker } from "../js/ui/merchantpicker.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const key = (node, k) => { const e = Object.assign(new DomEvent("keydown", { bubbles: true, key: k }), { key: k }); node.dispatchEvent(e); return e; };
const type = (picker, text) => { picker.input.value = text; picker.input.dispatchEvent(new DomEvent("input", { bubbles: true })); };
const list = (picker) => picker.element.querySelector('[role="listbox"]');
const options = (picker) => list(picker).querySelectorAll('[role="option"]').map((o) => o.textContent);

const MERCHANTS = [
  { id: "m1", name: "Fictional Grocer", visibility: "shared" },
  { id: "m2", name: "Corner Cafe", aliases: ["CC"], visibility: "shared" },
  { id: "m3", name: "Café Rouge", visibility: "private" },
];

describe("BT-007-01 merchant picker", () => {
  test("typing filters by name ignoring case and accents, and offers to add an unknown name", () => {
    const p = createMerchantPicker({ merchants: MERCHANTS, onRequestCreate: () => {} });
    type(p, "CAFE");
    assert.equal(p.input.getAttribute("aria-expanded"), "true");
    assert.deepEqual(options(p), ["Corner Cafe", "Café Rouge · private", "Add “CAFE” as a new merchant"]);
    type(p, "cc");
    assert.deepEqual(options(p).slice(0, 1), ["Corner Cafe"], "aliases are searched");
    type(p, "fictional grocer");
    assert.deepEqual(options(p), ["Fictional Grocer"], "no add option when the name already exists");
  });

  test("arrow keys move the active option (announced through aria-activedescendant) and Enter chooses", () => {
    const chosen = [];
    const p = createMerchantPicker({ merchants: MERCHANTS, onChange: (m) => chosen.push(m && m.id) });
    type(p, "cafe");
    key(p.input, "ArrowDown");
    key(p.input, "ArrowDown");
    const active = p.input.getAttribute("aria-activedescendant");
    assert.equal(list(p).querySelector(`#${active}`).textContent, "Café Rouge · private");
    const e = key(p.input, "Enter");
    assert.equal(e.defaultPrevented, true, "Enter on an option never submits the surrounding form");
    assert.deepEqual(chosen, ["m3"]);
    assert.equal(p.getValue(), "m3");
    assert.equal(p.input.value, "Café Rouge");
    assert.equal(p.input.getAttribute("aria-expanded"), "false");
  });

  test("the add option hands the typed name to the form instead of choosing anything", () => {
    const requested = [];
    const p = createMerchantPicker({ merchants: MERCHANTS, onRequestCreate: (name) => requested.push(name) });
    type(p, "Totally New Shop");
    key(p.input, "ArrowDown");
    key(p.input, "Enter");
    assert.deepEqual(requested, ["Totally New Shop"]);
    assert.equal(p.getValue(), null);
  });

  test("Escape closes an open list and is consumed; a closed list leaves Escape to the dialog", () => {
    const p = createMerchantPicker({ merchants: MERCHANTS });
    type(p, "c");
    assert.equal(key(p.input, "Escape").defaultPrevented, true);
    assert.equal(p.input.getAttribute("aria-expanded"), "false");
    assert.equal(key(p.input, "Escape").defaultPrevented, false);
  });

  test("Bills → Merchant fix (review, 2026-09-18): clicking or focusing the empty input opens the full list without typing first", () => {
    const p = createMerchantPicker({ merchants: MERCHANTS });
    assert.equal(p.input.getAttribute("aria-expanded"), "false");
    p.input.dispatchEvent(new DomEvent("focus", { bubbles: true }));
    assert.equal(p.input.getAttribute("aria-expanded"), "true", "focusing alone opens the list");
    assert.deepEqual(options(p), ["Fictional Grocer", "Corner Cafe", "Café Rouge · private"], "unfiltered — nothing was typed");
    p.input.dispatchEvent(new DomEvent("blur", { bubbles: true }));
    assert.equal(p.input.getAttribute("aria-expanded"), "false");
    p.input.dispatchEvent(new DomEvent("click", { bubbles: true }));
    assert.equal(p.input.getAttribute("aria-expanded"), "true", "clicking alone also opens the list");
  });

  test("editing the text after a choice clears the selection; an existing closed merchant is kept", () => {
    const changes = [];
    const p = createMerchantPicker({ merchants: MERCHANTS, onChange: (m) => changes.push(m && m.id) });
    type(p, "grocer");
    key(p.input, "ArrowDown");
    key(p.input, "Enter");
    type(p, "grocer x");
    assert.deepEqual(changes, ["m1", null]);
    assert.equal(p.getValue(), null);
    const kept = createMerchantPicker({ merchants: [], current: { id: "old", name: "Closed Shop" } });
    assert.deepEqual([kept.getValue(), kept.input.value], ["old", "Closed Shop"]);
  });
});
