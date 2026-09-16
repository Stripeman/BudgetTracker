// BT-011-08 — the redesigned unauthenticated sign-in page (Terry, 2026-09-16). Structure, ARIA and
// wiring only; rendered contrast, real layout, keyboard order and motion need a browser (see
// scripts/dev/e2e/login.mjs, run against the isolated harness with `npm run e2e -- --only login`).
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { renderLanding } from "../js/ui/views/landing.js";
import { AUTH } from "../js/core/api.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

// A recording double of the canonical theme controller (the same shape appearance.test.js uses).
function recordingTheme(initial = "system") {
  const listeners = new Set();
  let mode = initial;
  return {
    getMode: () => mode,
    getResolvedMode: () => (mode === "system" ? "light" : mode),
    setMode(next) { mode = next; for (const l of listeners) l({ mode }); return mode; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

describe("BT-011-08 sign-in page: structure and landmarks", () => {
  test("one main landmark carrying the skip link's target, and exactly one H1 with the brief's heading", () => {
    const main = renderLanding({});
    assert.equal(main.localName, "main");
    assert.equal(main.getAttribute("id"), "main");
    assert.equal(main.getAttribute("tabindex"), "-1");
    const h1s = main.querySelectorAll("h1");
    assert.equal(h1s.length, 1, "exactly one H1 on the page");
    assert.equal(h1s[0].textContent, "Know where your money is going.");
  });

  test("the preview panel is a second, named landmark, never competing with the main heading", () => {
    const main = renderLanding({});
    const aside = main.querySelector("aside");
    assert.ok(aside, "the illustrative preview is a landmark");
    assert.match(aside.getAttribute("aria-label"), /Illustrative preview/);
    assert.equal(aside.querySelectorAll("h1").length, 0, "no second H1 inside the preview");
  });

  test("brand, value statement and privacy points render in words", () => {
    const main = renderLanding({});
    assert.match(main.querySelector(".login__brandname").textContent, /BudgetTracker/);
    assert.match(main.querySelector(".login__lede").textContent, /Plan budgets, track bills and debt/);
    const points = main.querySelector(".login__points").querySelectorAll("li").map((li) => li.textContent);
    assert.deepEqual(points, [
      "Financial records are private by default.",
      "Sharing is explicit and controlled by you.",
      "Site administrators cannot browse private financial records.",
    ]);
  });

  test("the brand mark image is decorative (empty alt), never announced twice with the text beside it", () => {
    const main = renderLanding({});
    const img = main.querySelector(".login__logo");
    assert.equal(img.getAttribute("alt"), "");
  });
});

describe("BT-011-08 sign-in page: the Google sign-in route is unchanged", () => {
  test("a real link to AUTH.login('/'), not a button pretending to be one", () => {
    const main = renderLanding({});
    const link = main.querySelector(".login__google");
    assert.equal(link.localName, "a", "a real link, so it works without JavaScript and with every input method");
    assert.equal(link.getAttribute("href"), AUTH.login("/"));
    assert.equal(link.textContent, "Sign in with Google");
  });

  test("the Google mark is decoration; the accessible name comes from the words alone", () => {
    const main = renderLanding({});
    const mark = main.querySelector(".login__googlemark");
    assert.equal(mark.getAttribute("aria-hidden"), "true");
    assert.equal(mark.getAttribute("focusable"), "false");
  });
});

describe("BT-011-08 sign-in page: the reused day/night control (BT-011-01)", () => {
  test("mounted and wired to the SAME theme controller the rest of the app uses, not a second one", () => {
    const theme = recordingTheme("light");
    const main = renderLanding({ theme });
    const control = main.querySelector(".daynight");
    assert.ok(control, "the day/night control is present, not reinvented");
    const toggle = control.querySelector(".daynight__switch");
    toggle.click();
    assert.equal(theme.getMode(), "dark", "pressing it changes the canonical controller");
  });

  test("with no theme controller supplied, the page still renders (defensive default, never throws)", () => {
    assert.doesNotThrow(() => renderLanding({}));
    assert.equal(renderLanding({}).querySelector(".daynight"), null);
  });
});

describe("BT-011-08 sign-in page: the illustrative preview never fetches and never needs sign-in", () => {
  // scripts/validate.cjs rule 8 already enforces, repository-wide, that only app/js/core/api.js may
  // call `fetch`; this test proves the preview panel needs no data at all to render (build it from
  // PREVIEW alone, with no api/theme given), which the rule alone cannot show.
  test("renders from the local PREVIEW constant alone, with no api or theme given", () => {
    const main = renderLanding({});
    const widgets = main.querySelectorAll(".login__widget");
    // Budget progress, money in/out, spending categories, cash-flow forecast, a trip settlement and
    // a recurring bill — the brief's six illustrative elements.
    assert.equal(widgets.length, 6);
  });

  test("every drawn figure in the preview is decorative (aria-hidden); the numbers are also real text beside it", () => {
    const main = renderLanding({});
    const aside = main.querySelector("aside");
    for (const svg of aside.querySelectorAll("svg")) assert.equal(svg.getAttribute("aria-hidden"), "true");
    assert.match(aside.textContent, /Fictional/, "the preview says plainly that its data is fictional");
  });

  test("money direction is never two-way: the trip card uses the no-money-moved mark, not an arrow, for an amount owed", () => {
    const main = renderLanding({});
    const tripWidget = [...main.querySelectorAll(".login__widget")].find((w) => /Fictional Lisbon Trip/.test(w.textContent));
    assert.ok(tripWidget, "the trip settlement widget is present");
    assert.ok(tripWidget.querySelector(".dir--no-money-moved"), "an amount owed moved no money, so it gets the no-money-moved mark");
    assert.equal(tripWidget.querySelectorAll(".dir--money-in, .dir--money-out").length, 0);
  });

  test("the footer stays generic and makes no call when no api client is supplied", () => {
    const main = renderLanding({});
    const foot = main.querySelector(".login__foot");
    assert.equal(foot.textContent.trim(), "BudgetTracker");
    assert.equal(foot.querySelector(".badge--env").hidden, true);
  });

  test("given an api client, the footer's version/channel comes ONLY from the public GET /api/site-settings, never a private route", async () => {
    const calls = [];
    const api = { siteSettings: () => { calls.push("site-settings"); return Promise.resolve({ app: { version: "0.1.0-alpha.1", environment: "preview" } }); } };
    const main = renderLanding({ api });
    await Promise.resolve().then(() => Promise.resolve());
    assert.deepEqual(calls, ["site-settings"]);
    assert.match(main.querySelector(".login__foot").textContent, /BudgetTracker 0\.1\.0-alpha\.1/);
    assert.equal(main.querySelector(".badge--env").hidden, false);
    assert.equal(main.querySelector(".badge--env").textContent, "preview");
  });

  test("a failed public call leaves the generic footer rather than throwing or exposing the error", async () => {
    const api = { siteSettings: () => Promise.reject(new Error("offline")) };
    const main = renderLanding({ api });
    await Promise.resolve().then(() => Promise.resolve()).catch(() => {});
    assert.equal(main.querySelector(".login__foot").textContent.trim(), "BudgetTracker");
  });
});
