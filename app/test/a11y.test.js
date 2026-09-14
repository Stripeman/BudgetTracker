// Accessibility review remediation that can be proven without a browser (A11Y-001, A11Y-002).
// Keyboard behaviour of a real <select> popup, contrast rendering and screen-reader output still
// need a real browser and assistive technology.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { commitOnConfirm } from "../js/ui/components.js";
import { createDayNightControl } from "../js/ui/daynight.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

function selectWith(values, initial) {
  const s = document.createElement("select");
  s.value = initial;
  s.options = values;
  return s;
}
const key = (node, k) => node.dispatchEvent(Object.assign(new DomEvent("keydown", { bubbles: true, key: k }), { key: k }));
const fire = (node, type) => node.dispatchEvent(new DomEvent(type, { bubbles: true }));

describe("A11Y-002 selects commit only on an explicit choice", () => {
  test("arrowing through options never commits; Enter does", () => {
    const s = selectWith(["a", "b", "c"], "a");
    const commits = [];
    commitOnConfirm(s, (v) => commits.push(v));
    key(s, "ArrowDown"); s.value = "b"; fire(s, "change");
    key(s, "ArrowDown"); s.value = "c"; fire(s, "change");
    assert.deepEqual(commits, [], "each arrow key changes the value but commits nothing");
    key(s, "Enter");
    assert.deepEqual(commits, ["c"]);
  });

  test("leaving the control commits the browsed value once", () => {
    const s = selectWith(["a", "b"], "a");
    const commits = [];
    commitOnConfirm(s, (v) => commits.push(v));
    key(s, "ArrowDown"); s.value = "b"; fire(s, "change");
    fire(s, "blur");
    fire(s, "blur");
    assert.deepEqual(commits, ["b"]);
  });

  test("a pointer pick commits immediately; Escape reverts a keyboard browse", () => {
    const s = selectWith(["a", "b", "c"], "a");
    const commits = [];
    commitOnConfirm(s, (v) => commits.push(v));
    fire(s, "pointerdown"); s.value = "b"; fire(s, "change");
    assert.deepEqual(commits, ["b"]);
    key(s, "ArrowDown"); s.value = "c";
    key(s, "Escape");
    assert.equal(s.value, "b", "Escape restores the committed value");
    fire(s, "blur");
    assert.deepEqual(commits, ["b"], "nothing further was committed");
  });

  test("reset() updates the committed value without calling back", () => {
    const s = selectWith(["member", "owner"], "member");
    const commits = [];
    const c = commitOnConfirm(s, (v) => commits.push(v));
    c.reset("owner");
    fire(s, "blur");
    assert.equal(s.value, "owner");
    assert.deepEqual(commits, []);
  });
});

describe("A11Y-001 the appearance control redraws when the device changes", () => {
  test("refresh() reflects the device's current answer while following it", () => {
    let deviceDark = false;
    const theme = { getMode: () => "system", getResolvedMode: () => (deviceDark ? "dark" : "light"), setMode() {} };
    const control = createDayNightControl({ theme });
    dom.body.appendChild(control.element);
    const toggle = control.element.querySelector(".daynight__switch");
    assert.equal(toggle.getAttribute("aria-label"), "Appearance: Light");
    deviceDark = true;
    control.refresh();
    assert.equal(toggle.getAttribute("aria-label"), "Appearance: Dark");
    assert.match(control.element.querySelector(".daynight__note").textContent, /asking for dark/);
  });
});
