// BT-013-13 (2026-09-20): visual/behavioural evidence for the real summary row now shared by every
// remaining Transactions/Bills/Budget/Accounts/Shared/Trips pattern — coordinating each concept's own
// secondary pages with real derived context (entry/bill/trip counts, totals), continuing the same
// standard already established for every bespoke anchor page, per Terry's own "finish the coordinated
// required pages... preserving individual visual identity" instruction. One representative concept per
// page family, light/dark, desktop and mobile, never a generated image or a written description.
export const name = "gallerysummaries";
export const title = "BT-013-13: real summary rows on Transactions/Bills/Budget/Accounts/Shared/Trips, real-browser evidence";
export const needsBrowser = true;

async function openPage(session, conceptId, pageLabel) {
  await session.goto("gallery");
  await session.waitForText("All 15 concepts");
  await session.click({ role: "button", text: "Preview this concept", scope: `[data-concept="${conceptId}"]` });
  await session.waitFor("!!document.querySelector('.gpreview-pane .gframe')", { what: `the ${conceptId} preview frame` });
  await session.choose("Preview page", pageLabel);
  await session.waitFor("!!document.querySelector('.gpreview-pane .gframe__main')", { what: `the ${pageLabel} preview` });
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

const CHECKS = [
  { id: "executive-ledger", page: "Transactions", shot: "1-transactions-summary", text: [/Entries/, /Total in/, /Total out/] },
  { id: "financial-command-center", page: "Bills", shot: "2-bills-summary", text: [/Bills tracked/, /Overdue/, /Due soon/, /Total due/] },
  { id: "precision-grid", page: "Budget", shot: "3-budget-summary", text: [/Total planned/, /Total spent/, /Available/] },
  { id: "executive-ledger", page: "Accounts / Merchants", shot: "4-accounts-summary", text: [/Accounts/, /Total balance/, /Merchants tracked/] },
  { id: "travel-ledger", page: "Shared expenses", shot: "5-shared-summary", text: [/Members/, /Expenses/, /Total/] },
  { id: "household-hub", page: "Trips", shot: "6-trips-summary", text: [/Trips/, /Combined budget/, /Combined spent/] },
];

export async function run(h, t) {
  const { dave } = await h.browsers(["dave"], { prefix: "gallerysummaries-desktop-", width: 1440, height: 1000 });

  for (const c of CHECKS) {
    await openPage(dave, c.id, c.page);
    await setMode(dave, "light");
    await dave.evaluate("document.querySelector('.gpreview-pane').scrollIntoView({ block: 'start' })");
    await dave.settle();
    const text = await dave.evaluate("document.querySelector('.gpreview-pane .gframe__main').textContent");
    const matches = Object.fromEntries(c.text.map((re) => [re.source, re.test(text)]));
    t.check(`${c.id} / ${c.page}: real summary row present`, { expected: Object.fromEntries(c.text.map((re) => [re.source, true])), actual: matches });
    await dave.shot(`${c.shot}-light`);
    await setMode(dave, "dark");
    await dave.settle();
    await dave.shot(`${c.shot}-dark`);
    t.check(`dave: no console errors/exceptions after ${c.id} / ${c.page}`, { expected: [], actual: dave.problems() });
  }
  await dave.close();

  // ---- mobile: no horizontal overflow, all six ---------------------------------------------------
  const { dave: mobile } = await h.browsers(["dave"], { prefix: "gallerysummaries-mobile-", width: 390, height: 844 });
  for (const c of CHECKS) {
    await openPage(mobile, c.id, c.page);
    const overflow = await mobile.evaluate("document.documentElement.scrollWidth - window.innerWidth");
    t.check(`${c.id} / ${c.page} mobile (390px): no horizontal page overflow`, { expected: true, actual: overflow <= 1 });
  }
  t.check("mobile: no console errors/exceptions across all six", { expected: [], actual: mobile.problems() });
  await mobile.close();
}
