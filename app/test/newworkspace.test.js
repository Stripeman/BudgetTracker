// "New workspace…" (account menu): anyone signed in can start another workspace to track things
// separately. The dialog asks the same questions as the first-workspace page, refuses an empty name,
// sends exactly the chosen values once (one idempotency key per opening) and closes.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { openNewWorkspace } from "../js/ui/views/landing.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);

describe("New workspace", () => {
  test("refuses an empty name, then creates the workspace with the chosen values and closes", async () => {
    const calls = [];
    const store = { actions: { createWorkspace: async (body, key) => { calls.push([body, key]); return { id: "ws_side", name: body.name }; } } };
    const modal = openNewWorkspace({ store });
    const dialog = modal.element;
    const create = buttonNamed(dialog, "Create workspace");
    create.click();
    await tick();
    assert.equal(calls.length, 0, "nothing is sent without a name");
    assert.equal(dialog.querySelector(".modal__error").textContent, "Give the workspace a name.");
    const name = dialog.querySelector("input");
    assert.equal(name.getAttribute("aria-invalid"), "true");
    name.value = "  Side business  ";
    create.click();
    await tick();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][0], { name: "Side business", kind: "personal", reportingCurrency: "EUR" });
    assert.match(calls[0][1], /^k-[0-9a-f]{32}$/, "an idempotency key goes with the request");
    assert.equal(document.body.querySelector(".modal"), null, "the dialog closes");
  });

  test("a failure is shown inside the dialog, which stays open with what was typed", async () => {
    const store = { actions: { createWorkspace: async () => { throw new Error("Workspace could not be created."); } } };
    const modal = openNewWorkspace({ store });
    const dialog = modal.element;
    dialog.querySelector("input").value = "Trip to Lisbon";
    buttonNamed(dialog, "Create workspace").click();
    await tick();
    assert.ok(document.body.querySelector(".modal"), "still open");
    assert.equal(dialog.querySelector("input").value, "Trip to Lisbon");
    assert.equal(dialog.querySelector(".modal__error").hidden, false);
  });
});
