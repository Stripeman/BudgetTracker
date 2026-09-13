// BT-004-05 — every dropdown in the views is TaskTracker's command picker (Terry, 2026-09-14: "use the
// same component. and any drop down that possible to use, can use that too"). For each converted view:
// no plain native dropdown is left, each picker is labelled by its field, short fixed lists have no
// search box, and a choice made THROUGH THE PICKER is exactly what the view submits. Fictional data
// only. Layout, contrast and real screen-reader output are checked in a real browser, not here.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { nativeDropdowns, pickerLabels, pickerNamed, chooseOption, chooseByKeyboard, triggerFor } from "./pickerassert.js";
import { openNewWorkspace, createOnboarding } from "../js/ui/views/landing.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const spoken = (select) => triggerFor(select).getAttribute("aria-label");

describe("BT-004-05 landing: New workspace and the first-workspace page", () => {
  test("Kind and Reporting currency are pickers; Kind is a short list without search", () => {
    const store = { actions: { createWorkspace: async () => ({ id: "ws_x", name: "x" }) } };
    const dialog = openNewWorkspace({ store }).element;
    assert.deepEqual(nativeDropdowns(dialog), []);
    assert.deepEqual(pickerLabels(dialog), ["Kind", "Reporting currency"]);
    assert.equal(spoken(pickerNamed(dialog, "Kind")), "Kind: Personal. Choose.");
    assert.equal(spoken(pickerNamed(dialog, "Reporting currency")), "Reporting currency: EUR. Search and choose.");
  });

  test("what is chosen in the pickers is what the workspace is created with", async () => {
    const calls = [];
    const store = { actions: { createWorkspace: async (body) => { calls.push(body); return { id: "ws_trip", name: body.name }; } } };
    const dialog = openNewWorkspace({ store }).element;
    dialog.querySelector("input").value = "Fictional trip to Porto";
    chooseByKeyboard(pickerNamed(dialog, "Kind"), { keys: ["t"] });
    chooseByKeyboard(pickerNamed(dialog, "Reporting currency"), { type: "gbp" });
    buttonNamed(dialog, "Create workspace").click();
    await tick();
    assert.deepEqual(calls, [{ name: "Fictional trip to Porto", kind: "trip", reportingCurrency: "GBP" }]);
  });

  test("the first-workspace page uses the same pickers", async () => {
    const calls = [];
    const view = createOnboarding({ store: { actions: { createWorkspace: async (body) => { calls.push(body); } } } });
    dom.body.appendChild(view.element);
    assert.deepEqual(nativeDropdowns(view.element), []);
    assert.equal(spoken(pickerNamed(view.element, "Kind")), "Kind: Household. Choose.");
    view.element.querySelector("input").value = "Fictional flat";
    chooseOption(pickerNamed(view.element, "Kind"), "Shared-expense group");
    buttonNamed(view.element, "Create workspace").click();
    await tick();
    assert.deepEqual(calls, [{ name: "Fictional flat", kind: "group", reportingCurrency: "EUR" }]);
  });
});
