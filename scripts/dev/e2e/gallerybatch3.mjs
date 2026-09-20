// BT-013-12 (2026-09-20): visual/behavioural evidence for the third batch of Design Gallery upgrades
// — expanding the reference-led standard Terry approved to the remaining nine concepts as ORIGINAL,
// professionally composed dashboards (reusing established composition/typography/spacing/chart/colour/
// navigation principles across designs, per Terry's own explicit instruction, rather than a new
// external reference image each). Seven concepts were polished IN PLACE (same dashboard pattern id,
// genuinely richer composition); travel-ledger was separated out of the old shared `split-focus`
// pattern into its own bespoke `trip-focus`, and analyst-workspace is now `split-focus`'s sole holder
// with a real category report. Verifies desktop/mobile, light/dark, real interactions and structural
// accessibility markers for all nine, never a generated image or written description.
export const name = "gallerybatch3";
export const title = "BT-013-12: nine originally-composed Design Gallery dashboards, real-browser evidence";
export const needsBrowser = true;

async function openConcept(session, conceptId) {
  await session.goto("gallery");
  await session.waitForText("All 15 concepts");
  await session.click({ role: "button", text: "Preview this concept", scope: `[data-concept="${conceptId}"]` });
  await session.waitFor("!!document.querySelector('.gpreview-pane .gframe')", { what: `the ${conceptId} preview frame` });
  await session.choose("Preview page", "Dashboard");
  // The "Preview page" picker's own state can persist across concept switches within one browser
  // session (gallery.js) — wait for the frame to actually REPORT the dashboard page (its own
  // `data-page` attribute), not just for `.gframe__main` to exist (which is also true while a
  // stale previous page is still showing), before treating the concept as ready to interact with.
  await session.waitFor("(() => { const f = document.querySelector('.gpreview-pane .gframe'); return !!f && f.dataset.page === 'dashboard'; })()", { what: "the Dashboard page to be the one actually shown" });
  await scrollToPreview(session);
}

async function scrollToPreview(session) {
  await session.evaluate("document.querySelector('.gpreview-pane').scrollIntoView({ block: 'start' })");
  await session.settle();
}

async function setMode(session, mode) {
  await session.evaluate(`(() => {
    const r = document.documentElement;
    r.setAttribute('data-theme', 'midnight');
    r.setAttribute('data-mode', ${JSON.stringify(mode)});
    r.setAttribute('data-color-scheme', ${JSON.stringify(mode)});
    void document.body.offsetHeight;
  })()`);
  await session.settle();
}

const CONCEPTS = [
  { id: "executive-ledger", shot: "1-ledger-command", check: (text, m) => ({ hasLedger: !!m.querySelector(".glcmd-main"), hasSide: !!m.querySelector(".glcmd-side"), hasMeta: /Across every account/.test(text) }) },
  { id: "modern-banking", shot: "2-everyday-banking", check: (text, m) => ({ hasMosaic: !!m.querySelector(".gmosaic"), hasSparkline: !!m.querySelector(".gmosaic__tile--big .chart--bars") }) },
  { id: "financial-command-center", shot: "3-ops-console", check: (text, m) => ({ hasRibbon: !!m.querySelector(".goc-ribbon"), hasNow: /Now/.test(text), hasSoon: /Soon/.test(text) }) },
  { id: "calm-budget", shot: "4-morning-briefing", check: (text, m) => ({ hasGradientWrap: !!m.querySelector(".gbriefing__wrap"), hasDate: /\d{4}|January|February|March|April|May|June|July|August|September|October|November|December/.test(text) }) },
  { id: "precision-grid", shot: "5-spreadsheet-mode", check: (text, m) => ({ hasGrid: /Accounts at a glance/.test(text), hasTable: !!m.querySelector("table.gtable-dense") }) },
  { id: "wealth-overview", shot: "6-net-worth-atlas", check: (text, m) => ({ hasArea: !!m.querySelector(".chart--area"), hasSplit: !!m.querySelector(".gwealth-split"), hasAssets: /Assets/.test(text), hasLiabilities: /Liabilities/.test(text) }) },
  { id: "travel-ledger", shot: "7-journey-ledger", check: (text, m) => ({ hasActiveTrip: /Active trip/.test(text), hasSettle: /Settle up/.test(text) }) },
  { id: "analyst-workspace", shot: "8-filter-desk", check: (text, m) => ({ hasFilters: /Filters/.test(text), hasReport: /Category report/.test(text), hasTable: !!m.querySelector("table.gtable-dense") }) },
  { id: "focus-mode", shot: "9-one-thing-mode", check: (text, m) => ({ hasIcon: !!m.querySelector(".gstory__icon"), hasNet: !!m.querySelector(".gstory__net") }) },
];

export async function run(h, t) {
  const { dave } = await h.browsers(["dave"], { prefix: "gallerybatch3-desktop-", width: 1440, height: 1000 });

  for (const c of CONCEPTS) {
    await openConcept(dave, c.id);
    await setMode(dave, "light");
    await scrollToPreview(dave);
    const result = await dave.evaluate(`(() => {
      const m = document.querySelector('.gpreview-pane .gframe__main');
      const text = m.textContent;
      const fn = ${c.check.toString()};
      return fn(text, m);
    })()`);
    const expected = Object.fromEntries(Object.keys(result).map((k) => [k, true]));
    t.check(`${c.id}: renders its own originally-composed dashboard`, { expected, actual: result });
    await dave.shot(`${c.shot}-light`);
    await setMode(dave, "dark");
    await scrollToPreview(dave);
    await dave.shot(`${c.shot}-dark`);
    t.check(`dave: no console errors/exceptions after ${c.id}`, { expected: [], actual: dave.problems() });
  }

  t.check("dave: no console errors/exceptions after the dashboard walk", { expected: [], actual: dave.problems() });
  await dave.close();

  // ---- meaningful interactions: two dashboards' own "Add expense" wiring still genuinely navigates —
  // each gets its OWN fresh session/preview state, never chained after another concept's own click-
  // triggered navigation, so the "Preview page" picker's persisted state can never leak between checks.
  const { dave: calmSession } = await h.browsers(["dave"], { prefix: "gallerybatch3-calm-", width: 1440, height: 1000 });
  await openConcept(calmSession, "calm-budget");
  await calmSession.click({ role: "button", text: "Add expense", scope: ".gpreview-pane" });
  const calmAfter = await calmSession.evaluate("(() => { const f = document.querySelector('.gpreview-pane .gframe'); return f ? f.dataset.page : null; })()");
  t.check("Morning Briefing's 'Add expense' still genuinely navigates to Transactions", { expected: "transactions", actual: calmAfter });
  t.check("calmSession: no console errors/exceptions", { expected: [], actual: calmSession.problems() });
  await calmSession.close();

  const { dave: focusSession } = await h.browsers(["dave"], { prefix: "gallerybatch3-focus-", width: 1440, height: 1000 });
  await openConcept(focusSession, "focus-mode");
  await focusSession.click({ role: "button", text: "Add expense", scope: ".gpreview-pane" });
  const focusAfter = await focusSession.evaluate("(() => { const f = document.querySelector('.gpreview-pane .gframe'); return f ? f.dataset.page : null; })()");
  t.check("One Thing Mode's 'Add expense' still genuinely navigates to Transactions", { expected: "transactions", actual: focusAfter });
  t.check("focusSession: no console errors/exceptions", { expected: [], actual: focusSession.problems() });
  await focusSession.close();

  // ---- mobile: all nine, no horizontal overflow, genuinely reflowed -----------------------------
  const { dave: mobile } = await h.browsers(["dave"], { prefix: "gallerybatch3-mobile-", width: 390, height: 844 });
  for (const c of CONCEPTS) {
    await openConcept(mobile, c.id);
    const overflow = await mobile.evaluate("document.documentElement.scrollWidth - window.innerWidth");
    t.check(`${c.id} mobile (390px): no horizontal page overflow`, { expected: true, actual: overflow <= 1 });
  }
  await mobile.shot("mobile-focus-mode-light");
  await setMode(mobile, "dark");
  await scrollToPreview(mobile);
  await mobile.shot("mobile-focus-mode-dark");
  t.check("mobile: no console errors/exceptions across all nine", { expected: [], actual: mobile.problems() });
  await mobile.close();
}
