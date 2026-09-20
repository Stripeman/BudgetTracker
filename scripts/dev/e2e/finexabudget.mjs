// BT-013-10 (Terry, 2026-09-20): visual evidence for the SECOND of the three reference-led designs —
// the Finexa-inspired budget workspace (`finexa-budget`, api/_shared/layouts.js, budgetPattern
// 'reference-finexa', app/js/ui/gallery/compose.js budgetReferenceFinexa). Captures the real browser-
// rendered implementation at desktop and mobile widths, light and dark mode, plus its Dashboard
// secondary page, for side-by-side comparison against `.local/refcheck/r02.png` — never a generated
// image or a written description, per Terry's explicit requirement. Also checks the structural
// substitution rule (real BudgetTracker bills, never an invented "recurring payments"/subscription
// feature) and the required accessible chart/figure-table pattern.
export const name = "finexabudget";
export const title = "BT-013-10: the Finexa-inspired budget workspace concept, real-browser evidence at desktop/mobile and light/dark, plus its Dashboard page";
export const needsBrowser = true;

async function openFinexa(session) {
  await session.goto("gallery");
  await session.waitForText("All 15 concepts");
  await session.click({ role: "button", text: "Preview this concept", scope: '[data-concept="finexa-budget"]' });
  await session.waitFor("!!document.querySelector('.gpreview-pane .gframe')", { what: "the finexa-budget preview frame" });
  await scrollToPreview(session);
}

async function scrollToPreview(session) {
  await session.evaluate("document.querySelector('.gpreview-pane').scrollIntoView({ block: 'start' })");
  await session.settle();
}

async function setMode(session, mode) {
  // `data-theme` must be set alongside `data-mode`/`data-color-scheme` (same diagnosis as
  // acruoverview.mjs) — without a known palette id, the mode toggle alone has no visible effect at all.
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
  const { dave } = await h.browsers(["dave"], { prefix: "finexabudget-desktop-", width: 1440, height: 1000 });

  await openFinexa(dave);
  // Land on the Budget page specifically — the concept's own reference-led page.
  await dave.choose("Preview page", "Budget");
  await dave.waitFor("!!document.querySelector('.gpreview-pane .gframe__main')", { what: "the Budget preview" });
  await setMode(dave, "light");
  await scrollToPreview(dave);
  const structure = await dave.evaluate(`(() => {
    const m = document.querySelector('.gpreview-pane .gframe__main');
    const text = m.textContent;
    return {
      hasSubtitle: /Plan, track and control your spending limits/.test(text),
      hasAddAction: [...m.querySelectorAll('button')].some((b) => b.textContent.includes('Add budget line')),
      hasUtilChart: !!m.querySelector('.chart--dualbars'),
      hasFigureTable: !!m.querySelector('table.sr-only'),
      hasBillsSummary: /Upcoming bills/.test(text),
      cardCount: m.querySelectorAll('.gfinexa-cards .gcard').length,
      hasBar: !!m.querySelector('.gfinexa-cards .chart--bars'),
      hasArea: !!m.querySelector('.gfinexa-cards .chart--area'),
      hasGauge: !!m.querySelector('.gfinexa-cards .chart--gauge'),
      hasPie: !!m.querySelector('.gfinexa-cards .gpie'),
      hasStatusPill: /Critical|Almost reached|On track|Healthy/.test(text),
      noSubscriptionInvention: !/SaaS Tools|Cloud Services|Memberships|Ask Finexa/.test(text),
    };
  })()`);
  t.check("the Finexa-inspired Budget page renders its own bespoke subtitle/action row, utilization chart, real bills summary and four genuinely different category-card charts", {
    expected: {
      hasSubtitle: true, hasAddAction: true, hasUtilChart: true, hasFigureTable: true, hasBillsSummary: true,
      cardCount: 4, hasBar: true, hasArea: true, hasGauge: true, hasPie: true, hasStatusPill: true, noSubscriptionInvention: true,
    },
    actual: structure,
  });
  await dave.shot("1-finexa-desktop-light");
  t.note("Compare against .local/refcheck/r02.png at a comparable desktop size.");
  // The utilization chart and bills summary fill the first viewport; scroll to the category cards
  // (the reference's own four-card row) for a second, equally real piece of evidence.
  await dave.evaluate("document.querySelector('.gfinexa-cards').scrollIntoView({ block: 'center' })");
  await dave.settle();
  await dave.shot("1b-finexa-desktop-light-cards");
  await scrollToPreview(dave);

  await setMode(dave, "dark");
  await scrollToPreview(dave);
  await dave.shot("2-finexa-desktop-dark");

  await dave.choose("Preview page", "Dashboard");
  await dave.waitFor("!!document.querySelector('.gpreview-pane .gframe__main')", { what: "the Dashboard preview" });
  await scrollToPreview(dave);
  await dave.shot("3-finexa-dashboard-dark");
  await setMode(dave, "light");
  await scrollToPreview(dave);
  await dave.shot("4-finexa-dashboard-light");
  t.check("dave (desktop): no console errors/exceptions", { expected: [], actual: dave.problems() });
  await dave.close();

  // ---- mobile: a genuinely composed narrow layout, not merely a squeezed desktop screen -------------
  const { dave: mobile } = await h.browsers(["dave"], { prefix: "finexabudget-mobile-", width: 390, height: 844 });
  await openFinexa(mobile);
  await mobile.choose("Preview page", "Budget");
  await mobile.waitFor("!!document.querySelector('.gpreview-pane .gframe__main')", { what: "the Budget preview" });
  await setMode(mobile, "light");
  await scrollToPreview(mobile);
  const mobileLayout = await mobile.evaluate(`(() => {
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    return { overflow };
  })()`);
  t.check("mobile (390px): no horizontal page overflow", { expected: true, actual: mobileLayout.overflow <= 1 });
  await mobile.shot("5-finexa-mobile-light");
  await setMode(mobile, "dark");
  await scrollToPreview(mobile);
  await mobile.shot("6-finexa-mobile-dark");
  t.check("mobile: no console errors/exceptions", { expected: [], actual: mobile.problems() });
  await mobile.close();
}
