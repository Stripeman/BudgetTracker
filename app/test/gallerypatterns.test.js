// BT-013 Design Gallery — secondary-page composition patterns (review, 2026-09-18): "Every concept
// is coherent beyond its dashboard; reject repeated generic secondary screens." Before this fix,
// Transactions/Bills/Budget rendered through ONE shared template for all 15 concepts (only nav/
// density/card chrome differed), and Accounts/Merchants was not a Gallery page at all. This test
// exercises the REAL manifest (api/_shared/layouts.js) through the REAL composition engine
// (compose.js) — never a decoupled fixture — so a concept whose pattern fields are missing, or a
// pattern renderer that throws, fails here rather than rendering blank in front of Terry.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { installDom } from "./domdouble.js";
import { renderConceptFrame } from "../js/ui/gallery/compose.js";

const require = createRequire(import.meta.url);
const { CONCEPTS, REQUIRED_PAGES, TRANSACTIONS_PATTERNS, BILLS_PATTERNS, BUDGET_PATTERNS, ACCOUNTS_PATTERNS, SETTINGS_PATTERNS, SHARED_PATTERNS, TRIPS_PATTERNS, TYPE_VOICES, CHART_EMPHASES } = require("../../api/_shared/layouts.js");

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

describe("BT-013 secondary-page composition patterns: every real concept, every real page", () => {
  test("every one of the 15 real concepts renders every one of the required pages without throwing, with real content", () => {
    for (const concept of CONCEPTS) {
      for (const pageId of REQUIRED_PAGES) {
        const frame = renderConceptFrame(concept, pageId, () => {}, { requiredPages: REQUIRED_PAGES });
        assert.ok(frame.querySelector(".gframe__main").childNodes.length > 0, `${concept.id} ${pageId}`);
      }
    }
  });

  test("every concept declares a value from each new pattern axis", () => {
    for (const c of CONCEPTS) {
      assert.ok(TRANSACTIONS_PATTERNS.includes(c.transactionsPattern), `${c.id} transactionsPattern`);
      assert.ok(BILLS_PATTERNS.includes(c.billsPattern), `${c.id} billsPattern`);
      assert.ok(BUDGET_PATTERNS.includes(c.budgetPattern), `${c.id} budgetPattern`);
      assert.ok(ACCOUNTS_PATTERNS.includes(c.accountsPattern), `${c.id} accountsPattern`);
      assert.ok(SETTINGS_PATTERNS.includes(c.settingsPattern), `${c.id} settingsPattern`);
      // Shared expenses / Trips (review, 2026-09-18 follow-up): these two required pages were the
      // last still sharing one template across all 15 concepts after the first secondary-page fix.
      assert.ok(SHARED_PATTERNS.includes(c.sharedPattern), `${c.id} sharedPattern`);
      assert.ok(TRIPS_PATTERNS.includes(c.tripsPattern), `${c.id} tripsPattern`);
    }
  });

  test("all 5 transactions patterns, all 4 bills patterns, all 3 budget patterns, all 3 accounts patterns, both settings patterns, all 3 shared patterns and all 3 trips patterns are actually used across the 15 concepts (genuine variety, not one pattern with 15 names)", () => {
    assert.equal(new Set(CONCEPTS.map((c) => c.transactionsPattern)).size, TRANSACTIONS_PATTERNS.length);
    assert.equal(new Set(CONCEPTS.map((c) => c.billsPattern)).size, BILLS_PATTERNS.length);
    assert.equal(new Set(CONCEPTS.map((c) => c.budgetPattern)).size, BUDGET_PATTERNS.length);
    assert.equal(new Set(CONCEPTS.map((c) => c.accountsPattern)).size, ACCOUNTS_PATTERNS.length);
    assert.equal(new Set(CONCEPTS.map((c) => c.settingsPattern)).size, SETTINGS_PATTERNS.length);
    assert.equal(new Set(CONCEPTS.map((c) => c.sharedPattern)).size, SHARED_PATTERNS.length);
    assert.equal(new Set(CONCEPTS.map((c) => c.tripsPattern)).size, TRIPS_PATTERNS.length);
  });

  test("a dense-table transactions concept and a card-list transactions concept render structurally different markup for the SAME data", () => {
    const dense = CONCEPTS.find((c) => c.transactionsPattern === "dense-table");
    const cards = CONCEPTS.find((c) => c.transactionsPattern === "card-list");
    const denseFrame = renderConceptFrame(dense, "transactions", () => {}, { requiredPages: REQUIRED_PAGES });
    const cardFrame = renderConceptFrame(cards, "transactions", () => {}, { requiredPages: REQUIRED_PAGES });
    assert.ok(denseFrame.querySelector("table.gtable-dense"), "dense-table renders a real table");
    assert.equal(cardFrame.querySelector("table.gtable-dense"), null, "card-list does not");
    assert.ok(cardFrame.querySelector(".gminicard"), "card-list renders mini cards");
    assert.equal(denseFrame.querySelector(".gminicard"), null, "dense-table does not");
  });

  test("a kanban-columns bills concept groups overdue/due-soon/upcoming as side-by-side columns; a timeline concept renders one ordered list instead", () => {
    const kanban = CONCEPTS.find((c) => c.billsPattern === "kanban-columns");
    const timeline = CONCEPTS.find((c) => c.billsPattern === "timeline");
    const kanbanFrame = renderConceptFrame(kanban, "bills", () => {}, { requiredPages: REQUIRED_PAGES });
    const timelineFrame = renderConceptFrame(timeline, "bills", () => {}, { requiredPages: REQUIRED_PAGES });
    assert.ok(kanbanFrame.querySelector(".gkanban"), "kanban-columns renders the column grid");
    assert.equal(timelineFrame.querySelector(".gkanban"), null);
    assert.ok(timelineFrame.querySelector("ol.gtimeline"), "timeline renders one ordered list");
  });

  test("the new Accounts/Merchants page (gap fix) shows both accounts and merchants, in every one of its three patterns", () => {
    for (const pattern of ACCOUNTS_PATTERNS) {
      const concept = CONCEPTS.find((c) => c.accountsPattern === pattern);
      assert.ok(concept, `at least one concept uses ${pattern}`);
      const frame = renderConceptFrame(concept, "accounts", () => {}, { requiredPages: REQUIRED_PAGES });
      const text = frame.querySelector(".gframe__main").textContent;
      assert.match(text, /Merchants/, `${pattern} shows a Merchants section`);
      assert.match(text, /Joint Checking|Household Card|Alice Savings|Car Loan/, `${pattern} shows real account names`);
    }
  });

  test("a two-column-grouped settings concept reuses the REAL production settings grid class, not a lookalike", () => {
    const concept = CONCEPTS.find((c) => c.settingsPattern === "two-column-grouped");
    const frame = renderConceptFrame(concept, "settings", () => {}, { requiredPages: REQUIRED_PAGES });
    assert.ok(frame.querySelector(".settings-group__body"), "reuses the exact class the real Workspace settings card's CSS grid targets");
  });

  test("Accounts/Merchants has its own nav item, correctly labelled", () => {
    const concept = CONCEPTS[0];
    const frame = renderConceptFrame(concept, "accounts", () => {}, { requiredPages: REQUIRED_PAGES });
    const items = [...frame.querySelectorAll(".gnav__item")].map((n) => n.textContent);
    assert.ok(items.some((t) => t.includes("Accounts")), `nav items: ${items.join(", ")}`);
  });

  // Shared expenses / Trips (review, 2026-09-18 follow-up) --------------------------------------
  test("a ledger-table shared concept renders a real table; a settlement-focus concept renders a 'Settle up' heading instead; a balance-list concept renders neither", () => {
    const ledger = CONCEPTS.find((c) => c.sharedPattern === "ledger-table");
    const settlement = CONCEPTS.find((c) => c.sharedPattern === "settlement-focus");
    const balance = CONCEPTS.find((c) => c.sharedPattern === "balance-list");
    const ledgerFrame = renderConceptFrame(ledger, "shared", () => {}, { requiredPages: REQUIRED_PAGES });
    const settlementFrame = renderConceptFrame(settlement, "shared", () => {}, { requiredPages: REQUIRED_PAGES });
    const balanceFrame = renderConceptFrame(balance, "shared", () => {}, { requiredPages: REQUIRED_PAGES });
    assert.ok(ledgerFrame.querySelector("table.gtable-dense"), "ledger-table renders a real table");
    assert.equal(settlementFrame.querySelector("table.gtable-dense"), null, "settlement-focus does not render a table");
    assert.equal(balanceFrame.querySelector("table.gtable-dense"), null, "balance-list does not render a table");
    assert.match(settlementFrame.querySelector(".gframe__main").textContent, /Settle up/, "settlement-focus shows the 'Settle up' heading");
    assert.doesNotMatch(ledgerFrame.querySelector(".gframe__main").textContent, /Settle up/, "ledger-table does not");
    assert.doesNotMatch(balanceFrame.querySelector(".gframe__main").textContent, /Settle up/, "balance-list does not");
  });

  test("every one of the 3 shared patterns shows the real shared-expense fixture data", () => {
    for (const pattern of SHARED_PATTERNS) {
      const concept = CONCEPTS.find((c) => c.sharedPattern === pattern);
      assert.ok(concept, `at least one concept uses ${pattern}`);
      const frame = renderConceptFrame(concept, "shared", () => {}, { requiredPages: REQUIRED_PAGES });
      const text = frame.querySelector(".gframe__main").textContent;
      assert.ok(text.length > 20, `${pattern} shows real content`);
    }
  });

  test("a timeline trips concept renders one ordered list of trips in date order; a card-grid concept and a list concept do not", () => {
    const timeline = CONCEPTS.find((c) => c.tripsPattern === "timeline");
    const cardGrid = CONCEPTS.find((c) => c.tripsPattern === "card-grid");
    const list = CONCEPTS.find((c) => c.tripsPattern === "list");
    const timelineFrame = renderConceptFrame(timeline, "trips", () => {}, { requiredPages: REQUIRED_PAGES });
    const cardFrame = renderConceptFrame(cardGrid, "trips", () => {}, { requiredPages: REQUIRED_PAGES });
    const listFrame = renderConceptFrame(list, "trips", () => {}, { requiredPages: REQUIRED_PAGES });
    assert.ok(timelineFrame.querySelector("ol.gtimeline"), "timeline renders one ordered list");
    assert.equal(cardFrame.querySelector("ol.gtimeline"), null, "card-grid does not");
    assert.equal(listFrame.querySelector("ol.gtimeline"), null, "list does not");
    assert.ok(cardFrame.querySelector(".ggrid--metrics"), "card-grid renders a card grid");
    assert.equal(listFrame.querySelector(".ggrid--metrics"), null, "list does not render a card grid");
  });

  test("every trips page still shows the illustrative-only disclosure regardless of pattern (BT-010 is not a real feature yet)", () => {
    for (const pattern of TRIPS_PATTERNS) {
      const concept = CONCEPTS.find((c) => c.tripsPattern === pattern);
      const frame = renderConceptFrame(concept, "trips", () => {}, { requiredPages: REQUIRED_PAGES });
      assert.match(frame.querySelector(".gframe__main").textContent, /not yet a real BudgetTracker feature/, `${pattern} keeps the disclosure`);
    }
  });

  // Typography and new chart primitives (Terry, 2026-09-18: "deliberate typography, color, graphics,
  // metrics") ------------------------------------------------------------------------------------
  test("every concept's frame carries its own real typographic voice as a data attribute, for every one of the 15 real concepts", () => {
    for (const c of CONCEPTS) {
      const frame = renderConceptFrame(c, "dashboard", () => {}, { requiredPages: REQUIRED_PAGES });
      assert.equal(frame.dataset.voice, c.typeVoice, `${c.id} carries its own typeVoice`);
      assert.ok(TYPE_VOICES.includes(frame.dataset.voice), `${c.id} voice ${frame.dataset.voice} is a real value`);
    }
  });

  test("all 4 typographic voices are genuinely used, each by more than one concept (a real shared axis, not a per-concept one-off)", () => {
    const byVoice = new Map();
    for (const c of CONCEPTS) byVoice.set(c.typeVoice, (byVoice.get(c.typeVoice) || 0) + 1);
    assert.equal(byVoice.size, TYPE_VOICES.length);
    for (const voice of TYPE_VOICES) assert.ok(byVoice.get(voice) >= 2, `${voice} used by at least 2 concepts, got ${byVoice.get(voice)}`);
  });

  test("Wealth Overview's chart-first dashboard renders the new filled area chart (reference 5), not the plain multi-line chart; every other concept's dashboard never renders one", () => {
    const area = CONCEPTS.find((c) => c.chartEmphasis === "area");
    assert.ok(area, "fixture sanity");
    const areaFrame = renderConceptFrame(area, "dashboard", () => {}, { requiredPages: REQUIRED_PAGES });
    assert.ok(areaFrame.querySelector(".chart--area"), "area-emphasis concept renders the filled area chart");
    assert.ok(areaFrame.querySelector(".chart__area-fill"), "the area chart has a real filled polygon");
    for (const c of CONCEPTS.filter((c) => c.chartEmphasis !== "area")) {
      const frame = renderConceptFrame(c, "dashboard", () => {}, { requiredPages: REQUIRED_PAGES });
      assert.equal(frame.querySelector(".chart--area"), null, `${c.id} does not render the area chart`);
    }
  });

  test("Goal Navigator's goal-progress dashboard renders the new circular gauge (reference 1/6), with the real percentage in its accessible label", () => {
    const donut = CONCEPTS.find((c) => c.chartEmphasis === "donut");
    assert.ok(donut, "fixture sanity");
    const frame = renderConceptFrame(donut, "dashboard", () => {}, { requiredPages: REQUIRED_PAGES });
    const gauges = [...frame.querySelectorAll(".chart--gauge")];
    assert.equal(gauges.length, 2, "one gauge per goal card (loan payoff, savings goal)");
    for (const g of gauges) {
      assert.equal(g.getAttribute("role"), "img");
      assert.match(g.getAttribute("aria-label"), /%/, "the gauge's accessible label states the real percentage");
    }
  });

  test("Financial Command Center's command-console dashboard adds a 'Budget used' ring alongside its forecast bar chart, since its chartEmphasis is 'mixed'", () => {
    const mixed = CONCEPTS.find((c) => c.chartEmphasis === "mixed");
    assert.ok(mixed, "fixture sanity");
    const frame = renderConceptFrame(mixed, "dashboard", () => {}, { requiredPages: REQUIRED_PAGES });
    assert.match(frame.querySelector(".gframe__main").textContent, /Budget used/);
    assert.ok(frame.querySelector(".chart--gauge"), "renders the ring");
    assert.ok(frame.querySelector(".chart--bars"), "keeps its existing forecast bar chart too");
  });

  test("every chart emphasis, including the two new ones, is genuinely used across the 15 concepts", () => {
    assert.equal(new Set(CONCEPTS.map((c) => c.chartEmphasis)).size, CHART_EMPHASES.length);
  });

  // ---- Per-concept colour identity (review, 2026-09-19) ----------------------------------------
  function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function relLuminance([r, g, b]) {
    const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const [rl, gl, bl] = [f(r), f(g), f(b)];
    return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  }
  function contrastRatio(hexA, hexB) {
    const la = relLuminance(hexToRgb(hexA));
    const lb = relLuminance(hexToRgb(hexB));
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
  }

  test("every concept declares its own accentLight/accentDark, each a genuinely distinct colour", () => {
    for (const c of CONCEPTS) {
      assert.match(c.accentLight, /^#[0-9a-f]{6}$/i, `${c.id} accentLight`);
      assert.match(c.accentDark, /^#[0-9a-f]{6}$/i, `${c.id} accentDark`);
    }
    assert.equal(new Set(CONCEPTS.map((c) => c.accentLight.toLowerCase())).size, CONCEPTS.length, "every concept's light accent is unique");
    assert.equal(new Set(CONCEPTS.map((c) => c.accentDark.toLowerCase())).size, CONCEPTS.length, "every concept's dark accent is unique");
  });

  test("every concept's accent pair meets >=3:1 non-text contrast against the real light surface (#ffffff) and dark surface (#141a24) respectively — the same bar this repository already holds hairline borders and focus rings to", () => {
    for (const c of CONCEPTS) {
      const lightRatio = contrastRatio(c.accentLight, "#ffffff");
      const darkRatio = contrastRatio(c.accentDark, "#141a24");
      assert.ok(lightRatio >= 3, `${c.id} light accent ${c.accentLight} contrast ${lightRatio.toFixed(2)} against #ffffff`);
      assert.ok(darkRatio >= 3, `${c.id} dark accent ${c.accentDark} contrast ${darkRatio.toFixed(2)} against #141a24`);
    }
  });

  test("a concept's own accent colour is applied ONLY to its own frame, as inline CSS custom properties, never a shared/global style", () => {
    const a = CONCEPTS[0];
    const b = CONCEPTS[1];
    const frameA = renderConceptFrame(a, "dashboard", () => {}, { requiredPages: REQUIRED_PAGES });
    const frameB = renderConceptFrame(b, "dashboard", () => {}, { requiredPages: REQUIRED_PAGES });
    assert.equal(frameA.style.getPropertyValue("--g-accent-light"), a.accentLight);
    assert.equal(frameA.style.getPropertyValue("--g-accent-dark"), a.accentDark);
    assert.equal(frameB.style.getPropertyValue("--g-accent-light"), b.accentLight);
    assert.notEqual(frameA.style.getPropertyValue("--g-accent-light"), frameB.style.getPropertyValue("--g-accent-light"));
  });

  // ---- Real interactive Settings controls (review, 2026-09-19) ----------------------------------
  test("Settings is no longer a read-only label/badge list: a real control exists for every sample setting, and changing one visibly updates its own state without navigating away or calling an API", () => {
    for (const pattern of SETTINGS_PATTERNS) {
      const concept = CONCEPTS.find((c) => c.settingsPattern === pattern);
      const frame = renderConceptFrame(concept, "settings", () => {}, { requiredPages: REQUIRED_PAGES });
      const selects = [...frame.querySelectorAll("select")];
      assert.ok(selects.length >= 4, `${pattern} renders a real control per sample setting (got ${selects.length})`);
      const first = selects[0];
      const before = first.value;
      const other = [...first.querySelectorAll("option")].map((o) => o.value).find((v) => v !== before);
      assert.ok(other, `${pattern} control has another option to switch to`);
      first.value = other;
      first.dispatchEvent({ type: "change", bubbles: true });
      assert.equal(first.value, other, `${pattern} control genuinely changed`);
      assert.match(frame.querySelector(".gframe__main").textContent, /Preview only/, `${pattern} is honest that nothing is saved`);
    }
  });

  // ---- Shared-expense event directory/detail (review, 2026-09-19, reflecting the now-real BT-009-20
  // model) ------------------------------------------------------------------------------------------
  test("every one of the 3 shared patterns shows a real Events directory (name, status, count) reflecting BT-009-20's model", () => {
    for (const pattern of SHARED_PATTERNS) {
      const concept = CONCEPTS.find((c) => c.sharedPattern === pattern);
      const frame = renderConceptFrame(concept, "shared", () => {}, { requiredPages: REQUIRED_PAGES });
      const text = frame.querySelector(".gframe__main").textContent;
      assert.match(text, /Events/, `${pattern} shows an Events section`);
      assert.match(text, /General/, `${pattern} shows the default event by name`);
      assert.match(text, /Museum day/, `${pattern} shows the second event by name`);
      assert.match(text, /Closed/, `${pattern} shows a real lifecycle status`);
    }
  });

  test("choosing one event in the directory narrows 'Recent shared expenses' to that event's own, and 'Show every event combined' (Viewing this event) returns to the full list", () => {
    const concept = CONCEPTS.find((c) => c.sharedPattern === "balance-list");
    const frame = renderConceptFrame(concept, "shared", () => {}, { requiredPages: REQUIRED_PAGES });
    const before = frame.querySelector(".gframe__main").textContent;
    assert.match(before, /Museum tickets/, "combined view shows every event's expenses");
    assert.match(before, /Dinner at the harbour/);
    const viewButtons = [...frame.querySelectorAll("button")].filter((b) => b.textContent === "View");
    assert.ok(viewButtons.length >= 1, "at least one event offers a View button");
    // Choose the closed "Museum day" event specifically (its own li contains that text).
    const museumRow = [...frame.querySelectorAll("li")].find((li) => li.textContent.includes("Museum day"));
    const museumView = [...museumRow.querySelectorAll("button")].find((b) => b.textContent === "View");
    museumView.dispatchEvent({ type: "click", bubbles: true });
    const after = frame.querySelector(".gframe__main").textContent;
    assert.match(after, /Museum tickets/, "scoped view still shows the chosen event's own expense");
    assert.doesNotMatch(after, /Dinner at the harbour/, "scoped view no longer shows the OTHER event's expense");
    assert.match(after, /Showing only "Museum day"/, "a plain-language scoped banner is shown, matching the real page's own wording style");
    const backButton = [...frame.querySelectorAll("button")].find((b) => b.textContent === "Viewing this event");
    assert.ok(backButton, "the now-selected event shows a way back to combined");
    backButton.dispatchEvent({ type: "click", bubbles: true });
    const backTo = frame.querySelector(".gframe__main").textContent;
    assert.match(backTo, /Dinner at the harbour/, "back to combined shows every event's expenses again");
  });

  // ---- The one silent no-op button (review, 2026-09-19) -----------------------------------------
  test("story-flow's 'Add expense' button is no longer a silent no-op: pressing it calls onNavigate to switch the preview to Transactions", () => {
    const concept = CONCEPTS.find((c) => c.dashboardPattern === "story-flow");
    assert.ok(concept, "fixture sanity");
    let navigatedTo = null;
    const frame = renderConceptFrame(concept, "dashboard", (id) => { navigatedTo = id; }, { requiredPages: REQUIRED_PAGES });
    const addExpense = [...frame.querySelectorAll("button")].find((b) => b.textContent === "Add expense");
    assert.ok(addExpense, "the button still exists");
    addExpense.dispatchEvent({ type: "click", bubbles: true });
    assert.equal(navigatedTo, "transactions", "pressing it is a real action, not a silent no-op");
  });
});
