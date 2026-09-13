// BT-004-04 — THE WORKSPACE PICKER, adapted from TaskTracker's workspace-selector tests
// (app/test/profilenewworkspace.test.js "the searchable workspace selector" and
// shellprojectpicker.test.js, T: main fb24a41). BudgetTracker's marks are O (you own it) and M (any
// other role); there are no guest (G) or site-admin (S) workspaces here, and the exact role is always
// spelled out. Fictional workspaces only. Real screen-reader output and layout need a real browser.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { createWorkspacePicker, workspaceMarkerFor } from "../js/ui/workspacepicker.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

// Shaped exactly like `workspace-model.summary` (id, name, kind, status, the caller's role).
const WORKSPACES = [
  { id: "ws_family", name: "Family budget", kind: "household", status: "active", role: "owner" },
  { id: "ws_flat", name: "Shared flat", kind: "group", status: "active", role: "manager" },
  { id: "ws_club", name: "Chess club", kind: "group", status: "active", role: "member" },
  { id: "ws_trip", name: "Trip to Lisbon", kind: "trip", status: "archived", role: "viewer" },
];

function mount(options = {}) {
  const calls = { selected: [], created: [], announced: [] };
  const picker = createWorkspacePicker({
    workspaces: WORKSPACES,
    selectedId: "ws_family",
    onSelect: (id) => calls.selected.push(id),
    onCreate: (name) => calls.created.push({ name, focus: document.activeElement }),
    announce: (text) => calls.announced.push(text),
    ...options,
  });
  dom.body.appendChild(picker.element);
  return { picker, calls };
}

const trigger = (p) => p.element.querySelector(".cmdpick__trigger");
const panel = () => dom.body.querySelector(".cmdpick__panel");
const press = (node, key) => { const e = new DomEvent("keydown", { bubbles: true, key }); node.dispatchEvent(e); return e; };
const type = (box, value) => { box.value = value; box.dispatchEvent(new DomEvent("input", { bubbles: true })); };
// Element identity is asserted with booleans: handing a DOM-double node to assert makes a failing
// report serialise the whole cyclic document graph, which hangs instead of failing.
const same = (a, b, message = "not the expected element") => assert.ok(a === b, message);
const none = (a, message = "expected no element") => assert.ok(a === null || a === undefined, message);

// Opens the palette (if needed), optionally searches, and returns the rows.
function workspaceRows(p, query = null) {
  if (trigger(p).getAttribute("aria-expanded") !== "true") trigger(p).click();
  if (query !== null) type(panel().querySelector(".cmdpick__search"), query);
  return dom.body.querySelectorAll(".cmdpick__opt").map((node) => ({
    node,
    name: node.querySelector(".cmdpick__optlabel").textContent,
    badge: node.querySelector(".people__badge"),
  }));
}

describe("BT-004-04 the select stays the state", () => {
  test("a real, hidden select holds the chosen workspace inside the control", () => {
    const { picker } = mount();
    const select = picker.element.querySelector("#workspace-picker");
    assert.ok(select, "the select is present");
    assert.equal(select.tagName, "SELECT");
    assert.ok(select.classList.contains("cmdpick__native"), "hidden from sight, not from the document");
    assert.equal(select.value, "ws_family");
    assert.ok(picker.element.querySelector(".cmdpick__trigger"), "what you press is the palette trigger");
  });

  test("update() refreshes the list and the choice in place, on the same element (built once)", () => {
    const { picker } = mount();
    const element = picker.element;
    picker.update({ workspaces: [...WORKSPACES, { id: "ws_new", name: "Side business", status: "active", role: "owner" }], selectedId: "ws_new" });
    same(picker.element, element, "the same element");
    assert.equal(element.querySelector("#workspace-picker").value, "ws_new");
    assert.equal(element.querySelector(".cmdpick__value").textContent, "Side business");
    assert.equal(workspaceRows(picker).length, 5);
  });

  test("an update while the palette is open keeps it open", () => {
    const { picker } = mount();
    workspaceRows(picker);
    picker.update({ workspaces: WORKSPACES, selectedId: "ws_family" });
    assert.ok(panel(), "still open");
    assert.equal(trigger(picker).getAttribute("aria-expanded"), "true");
  });

  test("the visible label names the trigger, the control people use", () => {
    const { picker } = mount();
    const label = picker.element.querySelector(".picker__label");
    assert.equal(label.textContent, "Workspace");
    assert.equal(label.getAttribute("for"), trigger(picker).id);
  });
});

describe("BT-004-04 the trigger", () => {
  test("shows the current workspace with its badge and speaks the exact role", () => {
    const { picker } = mount({ selectedId: "ws_flat" });
    assert.equal(picker.element.querySelector(".cmdpick__value").textContent, "Shared flat");
    // (The DOM double has no descendant combinator, so the two steps are taken separately.)
    const badge = picker.element.querySelector(".cmdpick__badge").querySelector(".people__badge");
    assert.equal(badge.textContent, "M");
    assert.equal(badge.getAttribute("aria-label"), "Manager");
    assert.equal(trigger(picker).getAttribute("aria-label"), "Workspace: Shared flat — Manager. Search and choose.");
  });
});

describe("BT-004-04 search", () => {
  test("every workspace in the list is offered, and search filters by name, case-insensitively", () => {
    const { picker } = mount();
    assert.deepEqual(workspaceRows(picker).map((r) => r.name), ["Family budget", "Shared flat", "Chess club", "Trip to Lisbon (archived)"]);
    assert.deepEqual(workspaceRows(picker, "FLAT").map((r) => r.name), ["Shared flat"]);
    assert.deepEqual(workspaceRows(picker, "zzzz").map((r) => r.name), []);
    assert.match(dom.body.querySelector(".cmdpick__none").textContent, /Nothing matches/);
    assert.equal(workspaceRows(picker, "").length, 4, "clearing restores the whole list");
  });

  test("the search box says what it searches", () => {
    const { picker } = mount();
    trigger(picker).click();
    const box = panel().querySelector(".cmdpick__search");
    assert.equal(box.getAttribute("placeholder"), "Search workspace…");
    same(document.activeElement, box);
  });
});

describe("BT-004-04 keyboard, choosing and closing", () => {
  test("arrows move, Enter chooses: onSelect gets the id and the change is announced", () => {
    const { picker, calls } = mount();
    trigger(picker).click();
    press(panel(), "ArrowDown");
    assert.deepEqual(calls.selected, [], "moving alone switches nothing");
    press(panel(), "Enter");
    assert.deepEqual(calls.selected, ["ws_flat"]);
    assert.deepEqual(calls.announced, ["Switched to Shared flat"]);
    none(panel());
    same(document.activeElement, trigger(picker), "focus returns to the trigger");
  });

  test("a pointer press on a row chooses that workspace by id", () => {
    const { picker, calls } = mount();
    const row = workspaceRows(picker).find((r) => r.name === "Trip to Lisbon (archived)");
    row.node.dispatchEvent(new DomEvent("mousedown", { bubbles: true }));
    assert.deepEqual(calls.selected, ["ws_trip"]);
    assert.deepEqual(calls.announced, ["Switched to Trip to Lisbon (archived)"]);
  });

  test("choosing the workspace you are already in switches nothing and reloads nothing", () => {
    const { picker, calls } = mount();
    trigger(picker).click();
    press(panel(), "Enter");
    assert.deepEqual(calls.selected, [], "selectWorkspace resets and reloads every slice, so it is not called for the same id");
    assert.deepEqual(calls.announced, []);
    none(panel(), "the palette still closes");
    // And a real switch afterwards still goes through.
    trigger(picker).click();
    press(panel(), "End");
    press(panel(), "Enter");
    assert.deepEqual(calls.selected, ["ws_trip"]);
  });

  test("Escape closes only the palette and chooses nothing", () => {
    const { picker, calls } = mount();
    const heard = [];
    dom.body.addEventListener("keydown", (e) => { if (e.key === "Escape") heard.push(e.key); });
    trigger(picker).click();
    press(panel(), "ArrowDown");
    press(panel(), "Escape");
    none(panel());
    assert.deepEqual(heard, [], "Escape did not travel past the palette (arrows may bubble, as in TaskTracker)");
    assert.deepEqual(calls.selected, []);
    same(document.activeElement, trigger(picker));
  });
});

describe("BT-004-04 + New workspace", () => {
  test("is pinned in the palette with a clear name, and calls onCreate with focus already on the trigger", () => {
    const { picker, calls } = mount();
    trigger(picker).click();
    const button = panel().querySelector(".cmdpick__create");
    assert.equal(button.querySelector(".cmdpick__createlabel").textContent, "New workspace");
    assert.equal(button.querySelector(".cmdpick__plus").getAttribute("aria-hidden"), "true", "announced as New workspace, not 'plus'");
    button.click();
    assert.equal(calls.created.length, 1);
    assert.equal(calls.created[0].name, "");
    same(calls.created[0].focus, trigger(picker), "the dialog it opens will return focus to the trigger");
    none(panel());
  });

  test("carries what was typed into the search box", () => {
    const { picker, calls } = mount();
    workspaceRows(picker, "Allotment");
    assert.equal(panel().querySelector(".cmdpick__createlabel").textContent, "New workspace “Allotment”");
    panel().querySelector(".cmdpick__create").click();
    assert.equal(calls.created[0].name, "Allotment");
  });

  test("is not offered when no onCreate is given", () => {
    const { picker } = mount({ onCreate: null });
    trigger(picker).click();
    none(panel().querySelector(".cmdpick__create"), "no create action");
  });
});

describe("BT-004-04 the O / M badges", () => {
  const markerOf = (rows, name) => {
    const row = rows.find((r) => r.name === name);
    assert.ok(row && row.badge, `${name} has a badge`);
    return { letter: row.badge.textContent, label: row.badge.getAttribute("aria-label"), title: row.badge.getAttribute("title"), role: row.badge.getAttribute("role"), node: row.node };
  };

  test("an owned workspace is O and says Owner; every other role is M and says its exact role", () => {
    const rows = workspaceRows(mount().picker);
    assert.deepEqual(markerOf(rows, "Family budget"), { ...markerOf(rows, "Family budget"), letter: "O", label: "Owner", title: "You own this workspace", role: "img" });
    assert.equal(markerOf(rows, "Shared flat").letter, "M");
    assert.equal(markerOf(rows, "Shared flat").label, "Manager");
    assert.equal(markerOf(rows, "Chess club").label, "Member");
    assert.equal(markerOf(rows, "Trip to Lisbon (archived)").label, "Viewer");
  });

  test("each row is spoken in full, so the letter is never the only information", () => {
    const rows = workspaceRows(mount().picker);
    assert.equal(rows.find((r) => r.name === "Shared flat").node.getAttribute("aria-label"), "Shared flat — Manager");
    assert.equal(rows.find((r) => r.name === "Family budget").node.getAttribute("aria-label"), "Family budget — Owner");
  });

  test("the badge is its own element immediately left of the name, with the shared badge class", () => {
    const rows = workspaceRows(mount().picker);
    for (const row of rows) {
      const children = row.node.children;
      assert.ok(children[0].classList.contains("people__badge"), `${row.name}: badge first`);
      assert.equal(children[0].tagName, "SPAN");
      assert.ok(children[1].classList.contains("cmdpick__optlabel"), `${row.name}: name second`);
    }
  });

  test("no G or S: only O and M exist, and an unrecognised role reads as Member", () => {
    const letters = new Set(workspaceRows(mount().picker).map((r) => r.badge.textContent));
    assert.deepEqual([...letters].sort(), ["M", "O"]);
    assert.deepEqual(workspaceMarkerFor({ role: "siteadmin" }), { letter: "M", label: "Member", hint: "You are a member of this workspace" });
    assert.deepEqual(workspaceMarkerFor({}), { letter: "M", label: "Member", hint: "You are a member of this workspace" });
  });
});

describe("BT-004-04 archived workspaces stay distinguishable", () => {
  test("marked in the visible name, the spoken name and the trigger, and still findable by search", () => {
    const { picker } = mount({ selectedId: "ws_trip" });
    assert.equal(picker.element.querySelector(".cmdpick__value").textContent, "Trip to Lisbon (archived)");
    const rows = workspaceRows(picker, "lisbon");
    assert.deepEqual(rows.map((r) => r.name), ["Trip to Lisbon (archived)"]);
    assert.equal(rows[0].node.getAttribute("aria-label"), "Trip to Lisbon (archived) — Viewer");
  });
});

describe("BT-004-04 focus guarantee for re-renders", () => {
  test("hasFocus() reports focus inside the control and restoreFocus() puts it back on the trigger", () => {
    const { picker } = mount();
    assert.equal(picker.hasFocus(), false);
    trigger(picker).focus();
    assert.equal(picker.hasFocus(), true);
    document.activeElement = null;
    picker.restoreFocus();
    same(document.activeElement, trigger(picker));
  });
});
