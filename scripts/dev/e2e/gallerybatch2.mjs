// BT-013-11 (2026-09-20): visual evidence for the second batch of reference-led Design Gallery
// upgrades, expanding the standard Terry approved for BT-013-10's three concepts to three of the
// remaining 12 — each upgrades ONE existing concept's weakest, most generic page to a bespoke
// composition built closely against a real reference image, while keeping that concept's own
// established identity intact:
//   - merchant-insights ("Spend Radar")'s Transactions page, against `.local/refcheck/r03.png`.
//   - household-hub ("Family Circle")'s Shared expenses page, against `.local/refcheck/r04.png`.
//   - goal-navigator ("Milestone Path")'s Dashboard, against `.local/refcheck/r06.png`.
// Captures the real browser-rendered implementation at desktop and mobile widths, light and dark
// mode, for side-by-side comparison — never a generated image or a written description.
export const name = "gallerybatch2";
export const title = "BT-013-11: three reference-led upgrades (Spend Radar/Transactions, Family Circle/Shared, Milestone Path/Dashboard), real-browser evidence";
export const needsBrowser = true;

async function openConcept(session, conceptId) {
  await session.goto("gallery");
  await session.waitForText("All 15 concepts");
  await session.click({ role: "button", text: "Preview this concept", scope: `[data-concept="${conceptId}"]` });
  await session.waitFor("!!document.querySelector('.gpreview-pane .gframe')", { what: `the ${conceptId} preview frame` });
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

export async function run(h, t) {
  const { dave } = await h.browsers(["dave"], { prefix: "gallerybatch2-desktop-", width: 1440, height: 1000 });

  // ---- 1. Spend Radar's Transactions page (reference-monsy) -----------------------------------
  await openConcept(dave, "merchant-insights");
  await dave.choose("Preview page", "Transactions");
  await dave.waitFor("!!document.querySelector('.gpreview-pane .gframe__main')", { what: "the Transactions preview" });
  await setMode(dave, "light");
  await scrollToPreview(dave);
  const monsy = await dave.evaluate(`(() => {
    const m = document.querySelector('.gpreview-pane .gframe__main');
    const text = m.textContent;
    const rows = [...m.querySelectorAll('table.gtable-dense tbody tr')];
    return {
      hasPeriodLabel: /2026/.test(text),
      hasActions: /Add income/.test(text) && /Add expense/.test(text) && /Add saving/.test(text),
      rowCount: rows.length,
      hasTypePills: !!m.querySelector('.gmonsy-type'),
      hasIncomeType: /Income/.test(text), hasExpenseType: /Expense/.test(text),
    };
  })()`);
  t.check("Spend Radar's Transactions page renders the bespoke Monsy-style ledger (period label, entry actions, real type pills)", {
    expected: { hasPeriodLabel: true, hasActions: true, rowCount: 8, hasTypePills: true, hasIncomeType: true, hasExpenseType: true },
    actual: monsy,
  });
  await dave.shot("1-monsy-transactions-light");
  t.note("Compare against .local/refcheck/r03.png at a comparable desktop size.");
  await setMode(dave, "dark");
  await scrollToPreview(dave);
  await dave.shot("2-monsy-transactions-dark");
  t.check("dave: no console errors/exceptions after Spend Radar", { expected: [], actual: dave.problems() });

  // ---- 2. Family Circle's Shared expenses page (reference-groupsplit) -------------------------
  await openConcept(dave, "household-hub");
  await dave.choose("Preview page", "Shared expenses");
  await dave.waitFor("!!document.querySelector('.gpreview-pane .gframe__main')", { what: "the Shared expenses preview" });
  await setMode(dave, "light");
  await scrollToPreview(dave);
  const groupsplit = await dave.evaluate(`(() => {
    const m = document.querySelector('.gpreview-pane .gframe__main');
    const text = m.textContent;
    return {
      hasEvents: /Events/.test(text) && /General/.test(text),
      hasGroupTotal: !!m.querySelector('.ggroupsplit-total'),
      hasAvatars: m.querySelectorAll('.ggroupsplit-avatar').length >= 2,
      hasCards: m.querySelectorAll('.ggroupsplit-card').length >= 1,
      hasRealNames: /Alice|Bob|Dana/.test(text),
    };
  })()`);
  t.check("Family Circle's Shared expenses page renders the bespoke GroupSplit-style total, member avatars and expense cards", {
    expected: { hasEvents: true, hasGroupTotal: true, hasAvatars: true, hasCards: true, hasRealNames: true },
    actual: groupsplit,
  });
  await dave.shot("3-groupsplit-shared-light");
  t.note("Compare against .local/refcheck/r04.png at a comparable desktop size.");
  await setMode(dave, "dark");
  await scrollToPreview(dave);
  await dave.shot("4-groupsplit-shared-dark");
  t.check("dave: no console errors/exceptions after Family Circle", { expected: [], actual: dave.problems() });

  // ---- 3. Milestone Path's Dashboard (reference-debtpayoff) ------------------------------------
  await openConcept(dave, "goal-navigator");
  // The "Preview page" picker persists across concept switches (by design, gallery.js) — it was left
  // on "Shared expenses" by the previous concept, so it must be explicitly reset to Dashboard here.
  await dave.choose("Preview page", "Dashboard");
  await dave.waitFor("!!document.querySelector('.gpreview-pane .gframe__main')", { what: "the Dashboard preview" });
  await setMode(dave, "light");
  await scrollToPreview(dave);
  const payoff = await dave.evaluate(`(() => {
    const m = document.querySelector('.gpreview-pane .gframe__main');
    const text = m.textContent;
    return {
      hasHeroFigure: /payments until debt-free/.test(text),
      hasFreedomDay: /Freedom day/.test(text),
      hasJourney: !!m.querySelector('.gpayoff-journey'),
      hasPaymentOrder: /Payment order/.test(text),
      gaugeCount: m.querySelectorAll('.chart--gauge').length,
      hasIllustrativeDisclosure: /illustrative/i.test(text),
    };
  })()`);
  t.check("Milestone Path's dashboard renders the bespoke debt-payoff hero, journey, payment order and two gauges, with the assumption disclosed", {
    expected: { hasHeroFigure: true, hasFreedomDay: true, hasJourney: true, hasPaymentOrder: true, gaugeCount: 2, hasIllustrativeDisclosure: true },
    actual: payoff,
  });
  await dave.shot("5-payoff-dashboard-light");
  t.note("Compare against .local/refcheck/r06.png at a comparable desktop size.");
  await setMode(dave, "dark");
  await scrollToPreview(dave);
  await dave.shot("6-payoff-dashboard-dark");
  t.check("dave: no console errors/exceptions after Milestone Path", { expected: [], actual: dave.problems() });
  await dave.close();

  // ---- mobile: all three, no horizontal overflow, genuinely reflowed -------------------------
  const { dave: mobile } = await h.browsers(["dave"], { prefix: "gallerybatch2-mobile-", width: 390, height: 844 });
  for (const [conceptId, page, shot] of [
    ["merchant-insights", "Transactions", "7-monsy-mobile"],
    ["household-hub", "Shared expenses", "8-groupsplit-mobile"],
    ["goal-navigator", "Dashboard", "9-payoff-mobile"],
  ]) {
    await openConcept(mobile, conceptId);
    // The "Preview page" picker persists across concept switches (gallery.js) — always select
    // explicitly rather than relying on whatever the previous concept in this loop left it on.
    await mobile.choose("Preview page", page);
    await mobile.waitFor("!!document.querySelector('.gpreview-pane .gframe__main')", { what: `the ${page} preview` });
    await setMode(mobile, "light");
    await scrollToPreview(mobile);
    const overflow = await mobile.evaluate("document.documentElement.scrollWidth - window.innerWidth");
    t.check(`${conceptId} mobile (390px): no horizontal page overflow`, { expected: true, actual: overflow <= 1 });
    await mobile.shot(`${shot}-light`);
    await setMode(mobile, "dark");
    await scrollToPreview(mobile);
    await mobile.shot(`${shot}-dark`);
  }
  t.check("mobile: no console errors/exceptions across all three", { expected: [], actual: mobile.problems() });
  await mobile.close();
}
