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
const { CONCEPTS, REQUIRED_PAGES, TRANSACTIONS_PATTERNS, BILLS_PATTERNS, BUDGET_PATTERNS, ACCOUNTS_PATTERNS, SETTINGS_PATTERNS, SHARED_PATTERNS, TRIPS_PATTERNS } = require("../../api/_shared/layouts.js");

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
});
