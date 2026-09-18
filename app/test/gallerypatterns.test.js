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
const { CONCEPTS, REQUIRED_PAGES, TRANSACTIONS_PATTERNS, BILLS_PATTERNS, BUDGET_PATTERNS, ACCOUNTS_PATTERNS, SETTINGS_PATTERNS } = require("../../api/_shared/layouts.js");

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
    }
  });

  test("all 5 transactions patterns, all 4 bills patterns, all 3 budget patterns, all 3 accounts patterns and both settings patterns are actually used across the 15 concepts (genuine variety, not one pattern with 15 names)", () => {
    assert.equal(new Set(CONCEPTS.map((c) => c.transactionsPattern)).size, TRANSACTIONS_PATTERNS.length);
    assert.equal(new Set(CONCEPTS.map((c) => c.billsPattern)).size, BILLS_PATTERNS.length);
    assert.equal(new Set(CONCEPTS.map((c) => c.budgetPattern)).size, BUDGET_PATTERNS.length);
    assert.equal(new Set(CONCEPTS.map((c) => c.accountsPattern)).size, ACCOUNTS_PATTERNS.length);
    assert.equal(new Set(CONCEPTS.map((c) => c.settingsPattern)).size, SETTINGS_PATTERNS.length);
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
});
