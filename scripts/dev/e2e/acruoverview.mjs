// BT-013-10 (Terry, 2026-09-20): visual evidence for the FIRST of the three reference-led designs —
// the ACRU-inspired financial overview (`acru-overview`, api/_shared/layouts.js, dashboardPattern
// 'reference-acru', app/js/ui/gallery/compose.js heroReferenceAcru). Captures the real browser-
// rendered implementation at desktop and mobile widths, light and dark mode, plus its Transactions
// secondary page, for side-by-side comparison against `.local/refcheck/r01.png` — never a generated
// image or a written description, per Terry's explicit requirement. Also checks the structural
// substitution rule (no bank-card visual, no "Upgrade" promo anywhere) and the required accessible
// chart/figure-table pattern.
export const name = "acruoverview";
export const title = "BT-013-10: the ACRU-inspired financial overview concept, real-browser evidence at desktop/mobile and light/dark, plus its Transactions page";
export const needsBrowser = true;

async function openAcru(session) {
  await session.goto("gallery");
  await session.waitForText("All 15 concepts");
  await session.click({ role: "button", text: "Preview this concept", scope: '[data-concept="acru-overview"]' });
  await session.waitFor("!!document.querySelector('.gpreview-pane .gframe')", { what: "the acru-overview preview frame" });
  // The preview pane sits ABOVE the concept grid; clicking a card far down the grid does not itself
  // scroll back up to it, so every screenshot must scroll it into view explicitly first.
  await scrollToPreview(session);
}

async function scrollToPreview(session) {
  await session.evaluate("document.querySelector('.gpreview-pane').scrollIntoView({ block: 'start' })");
  await session.settle();
}

async function setMode(session, mode) {
  // `data-theme` must be set alongside `data-mode`/`data-color-scheme` (found by direct diagnosis,
  // matching gallery.mjs's own established pattern) — without a known palette id, the mode toggle
  // alone has no visible effect at all.
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
  const { dave } = await h.browsers(["dave"], { prefix: "acruoverview-desktop-", width: 1440, height: 1000 });

  await openAcru(dave);
  await setMode(dave, "light");
  await scrollToPreview(dave);
  const structure = await dave.evaluate(`(() => {
    const m = document.querySelector('.gpreview-pane .gframe__main');
    const text = m.textContent;
    return {
      hasHeader: !!m.querySelector('.gacru-header'), hasSearch: !!m.querySelector('.gacru-search input'),
      hasHero: !!m.querySelector('.gacru-hero__figure'), hasStatRail: !!m.querySelector('.gacru-statrail'),
      hasAccounts: /Accounts/.test(text) && /Joint Checking|Household Card/.test(text),
      hasBills: /Upcoming bills/.test(text),
      hasSpending: !!m.querySelector('.gacru-segbar'), hasBudgetHealth: !!m.querySelector('.chart--gauge'),
      hasBudgetProgress: !!m.querySelector('.gacru-progrow'),
      noBankCard: !/VISA|Debit card|Credit card·|My card/.test(text), noPromo: !/Upgrade to Pro|Upgrade now/.test(text),
      hasFigureTable: !!m.querySelector('table.sr-only'),
    };
  })()`);
  t.check("the ACRU-inspired dashboard renders its own bespoke header, hero chart, stat rail, real BudgetTracker right column and lower panels", {
    expected: {
      hasHeader: true, hasSearch: true, hasHero: true, hasStatRail: true, hasAccounts: true, hasBills: true,
      hasSpending: true, hasBudgetHealth: true, hasBudgetProgress: true, noBankCard: true, noPromo: true, hasFigureTable: true,
    },
    actual: structure,
  });
  await dave.shot("1-acru-desktop-light");
  t.note("Compare against .local/refcheck/r01.png at a comparable desktop size.");

  await setMode(dave, "dark");
  await scrollToPreview(dave);
  await dave.shot("2-acru-desktop-dark");

  await dave.choose("Preview page", "Transactions");
  await dave.waitFor("!!document.querySelector('.gpreview-pane .gframe__main')", { what: "the Transactions preview" });
  await scrollToPreview(dave);
  await dave.shot("3-acru-transactions-dark");
  await setMode(dave, "light");
  await scrollToPreview(dave);
  await dave.shot("4-acru-transactions-light");
  t.check("dave (desktop): no console errors/exceptions", { expected: [], actual: dave.problems() });
  await dave.close();

  // ---- mobile: a genuinely composed narrow layout, not merely a squeezed desktop screen -------------
  const { dave: mobile } = await h.browsers(["dave"], { prefix: "acruoverview-mobile-", width: 390, height: 844 });
  await openAcru(mobile);
  await setMode(mobile, "light");
  await scrollToPreview(mobile);
  const mobileLayout = await mobile.evaluate(`(() => {
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    const frame = document.querySelector('.gpreview-pane .gframe');
    const nav = frame ? getComputedStyle(frame).flexDirection : null;
    return { overflow, navFlexDirection: nav };
  })()`);
  t.check("mobile (390px): no horizontal page overflow", { expected: true, actual: mobileLayout.overflow <= 1 });
  await mobile.shot("5-acru-mobile-light");
  await setMode(mobile, "dark");
  await scrollToPreview(mobile);
  await mobile.shot("6-acru-mobile-dark");
  t.check("mobile: no console errors/exceptions", { expected: [], actual: mobile.problems() });
  await mobile.close();
}
