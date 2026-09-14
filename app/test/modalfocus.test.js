// A11Y2-001: after a dialog's action re-renders the view, focus goes to the control with the same
// name in the new view, or to the main region — never to the page body.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { openModal } from "../js/ui/modal.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

function page() {
  const main = document.createElement("main");
  main.setAttribute("id", "main");
  document.body.appendChild(main);
  return main;
}
function opener(parent, label) {
  const b = document.createElement("button");
  b.setAttribute("aria-label", label);
  parent.appendChild(b);
  b.focus();
  return b;
}

describe("A11Y2-001 focus after a dialog closes", () => {
  test("returns to the opener when it is still on the page", () => {
    const main = page();
    const b = opener(main, "Skip Rent");
    openModal({ title: "Skip Rent?", body: [] }).close();
    assert.equal(document.activeElement, b);
  });

  test("moves to the re-rendered control with the same name when the opener was replaced", () => {
    const main = page();
    const b = opener(main, "Edit Rent");
    const modal = openModal({ title: "Edit Rent", body: [] });
    main.removeChild(b);
    const rebuilt = document.createElement("button");
    rebuilt.setAttribute("aria-label", "Edit Rent");
    main.appendChild(rebuilt);
    modal.close();
    assert.equal(document.activeElement, rebuilt);
  });

  test("falls back to the main region when the control is gone", () => {
    const main = page();
    const b = opener(main, "Skip Rent, due 2026-09-19");
    const modal = openModal({ title: "Skip", body: [] });
    main.removeChild(b);
    modal.close();
    assert.equal(document.activeElement, main);
  });
});
