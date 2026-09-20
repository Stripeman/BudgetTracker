// BT-013-10 (Terry, 2026-09-20): visual evidence for the THIRD of the three reference-led designs —
// the Ledgerfly-inspired forecast overview (`ledgerfly-forecast`, api/_shared/layouts.js,
// dashboardPattern 'reference-ledgerfly', app/js/ui/gallery/compose.js heroReferenceLedgerfly).
// Captures the real browser-rendered implementation at desktop and mobile widths, light and dark
// mode, plus its Transactions secondary page, for side-by-side comparison against
// `.local/refcheck/r05.png` — never a generated image or a written description, per Terry's explicit
// requirement. Also checks the structural substitution rule (a real, already-existing Expected/
// Cautious/Hopeful scenario panel, never a fake "run simulation" control) and the required accessible
// chart/figure-table pattern.
export const name = "ledgerflyforecast";
export const title = "BT-013-10: the Ledgerfly-inspired forecast overview concept, real-browser evidence at desktop/mobile and light/dark, plus its Transactions page";
export const needsBrowser = true;

async function openLedgerfly(session) {
  await session.goto("gallery");
  await session.waitForText("All 15 concepts");
  await session.click({ role: "button", text: "Preview this concept", scope: '[data-concept="ledgerfly-forecast"]' });
  await session.waitFor("!!document.querySelector('.gpreview-pane .gframe')", { what: "the ledgerfly-forecast preview frame" });
  await scrollToPreview(session);
}

async function scrollToPreview(session) {
  await session.evaluate("document.querySelector('.gpreview-pane').scrollIntoView({ block: 'start' })");
  await session.settle();
}

async function setMode(session, mode) {
  // `data-theme` must be set alongside `data-mode`/`data-color-scheme` (same diagnosis as
  // acruoverview.mjs/finexabudget.mjs) — without a known palette id, the mode toggle has no effect.
  await session.evaluate(`(() => {
    const r = document.documentElement;
    r.setAttribute('data-theme', 'midnight');
    r.setAttribute('data-mode', ${JSON.stringify(mode)});
    r.setAttribute('data-color-scheme', ${JSON.stringify(mode)});
    void document.body.offsetHeight;
  })()`);
  await session.settle();
}

export async function run(h, t) {
  const { dave } = await h.browsers(["dave"], { prefix: "ledgerflyforecast-desktop-", width: 1440, height: 1000 });

  await openLedgerfly(dave);
  await setMode(dave, "light");
  await scrollToPreview(dave);
  const structure = await dave.evaluate(`(() => {
    const m = document.querySelector('.gpreview-pane .gframe__main');
    const text = m.textContent;
    return {
      hasKpiStrip: !!m.querySelector('.gledgerfly-kpis'),
      hasEmphasisCard: !!m.querySelector('.gledgerfly-kpi--emphasis'),
      kpiCount: m.querySelectorAll('.gledgerfly-kpi').length,
      hasForecastChart: !!m.querySelector('.chart--trendfill'),
      hasFigureTable: !!m.querySelector('table.sr-only'),
      hasBreakdown: /Spending breakdown/.test(text),
      hasDrivers: /Primary cost drivers/.test(text),
      hasScenario: /Scenario planning/.test(text) && /Expected/.test(text) && /Cautious/.test(text) && /Hopeful/.test(text),
      hasObligation: /Largest upcoming obligation/.test(text),
      noFakeSimulation: !/Run Simulation/.test(text),
    };
  })()`);
  t.check("the Ledgerfly-inspired dashboard renders its own bespoke KPI strip (with one emphasised card), dominant forecast chart, real breakdown column and honest scenario/obligation row", {
    expected: {
      hasKpiStrip: true, hasEmphasisCard: true, kpiCount: 4, hasForecastChart: true, hasFigureTable: true,
      hasBreakdown: true, hasDrivers: true, hasScenario: true, hasObligation: true, noFakeSimulation: true,
    },
    actual: structure,
  });
  await dave.shot("1-ledgerfly-desktop-light");
  t.note("Compare against .local/refcheck/r05.png at a comparable desktop size.");

  await setMode(dave, "dark");
  await scrollToPreview(dave);
  await dave.shot("2-ledgerfly-desktop-dark");

  await dave.choose("Preview page", "Transactions");
  await dave.waitFor("!!document.querySelector('.gpreview-pane .gframe__main')", { what: "the Transactions preview" });
  await scrollToPreview(dave);
  await dave.shot("3-ledgerfly-transactions-dark");
  await setMode(dave, "light");
  await scrollToPreview(dave);
  await dave.shot("4-ledgerfly-transactions-light");
  t.check("dave (desktop): no console errors/exceptions", { expected: [], actual: dave.problems() });
  await dave.close();

  // ---- mobile: a genuinely composed narrow layout, not merely a squeezed desktop screen -------------
  const { dave: mobile } = await h.browsers(["dave"], { prefix: "ledgerflyforecast-mobile-", width: 390, height: 844 });
  await openLedgerfly(mobile);
  await setMode(mobile, "light");
  await scrollToPreview(mobile);
  const mobileLayout = await mobile.evaluate(`(() => {
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    return { overflow };
  })()`);
  t.check("mobile (390px): no horizontal page overflow", { expected: true, actual: mobileLayout.overflow <= 1 });
  await mobile.shot("5-ledgerfly-mobile-light");
  await setMode(mobile, "dark");
  await scrollToPreview(mobile);
  await mobile.shot("6-ledgerfly-mobile-dark");
  t.check("mobile: no console errors/exceptions", { expected: [], actual: mobile.problems() });
  await mobile.close();
}
