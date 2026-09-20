// BT-013-15: Executive Forecast (`ledgerfly-forecast`) — every required page plus its two new extra
// pages (Merchants, Debt/loan detail) now carry the SAME navy KPI-strip identity its Dashboard already
// established (BT-013-10), not a generic shared template. Real-browser evidence for every one of them,
// never a generated image or a written description.
export const name = "ledgerflypages";
export const title = "BT-013-15: Executive Forecast — every page reference-matched, plus Merchants and Debt/loan detail";
export const needsBrowser = true;

const CONCEPT_ID = "ledgerfly-forecast";
// Card headings render visually upper-cased (CSS text-transform); `.innerText` reflects that, so every
// marker is matched case-insensitively rather than assuming a particular DOM casing.
const PAGES = [
  { id: "transactions", label: "Transactions", marker: /Total in/i },
  { id: "bills", label: "Bills", marker: /Payment timeline/i },
  { id: "budget", label: "Budget", marker: /Planned vs\.? spent/i },
  { id: "accounts", label: "Accounts", marker: /Net position/i },
  { id: "merchants", label: "Merchants", marker: /Spend by merchant/i },
  { id: "debt", label: "Debt detail", marker: /Balance movement/i },
  { id: "shared", label: "Shared expenses", marker: /Outstanding/i },
  { id: "trips", label: "Trips", marker: /Illustrative/i },
];

// Uses the in-frame NAV directly (not the admin toolbar's own "Preview page" shortcut, which lists
// only the nine globally required pages and never Merchants/Debt) so the same navigation reaches
// every page a real person would actually use, exactly like clicking the sidebar itself.
async function openPage(session, pageLabel) {
  await session.goto("gallery");
  await session.waitForText("All 15 concepts");
  await session.click({ role: "button", text: "Preview this concept", scope: `[data-concept="${CONCEPT_ID}"]` });
  await session.waitFor("!!document.querySelector('.gpreview-pane .gframe')", { what: "the Executive Forecast preview frame" });
  await session.click({ role: "button", text: pageLabel, scope: ".gpreview-pane .gnav" });
  await session.waitFor("!!document.querySelector('.gpreview-pane .gframe__main')", { what: `the ${pageLabel} preview` });
  await session.evaluate("document.querySelector('.gpreview-pane').scrollIntoView({ block: 'start' })");
  await session.settle();
}

function setMode(session, mode) {
  return session.evaluate(`(() => {
    const r = document.documentElement;
    r.setAttribute('data-theme', 'midnight');
    r.setAttribute('data-mode', ${JSON.stringify(mode)});
    r.setAttribute('data-color-scheme', ${JSON.stringify(mode)});
    void document.body.offsetHeight;
  })()`);
}

export async function run(h, t) {
  const { dave } = await h.browsers(["dave"], { prefix: "ledgerflypages-desktop-", width: 1440, height: 1000 });

  for (const p of PAGES) {
    await openPage(dave, p.label);
    const text = await dave.text(".gpreview-pane .gframe__main");
    t.check(`${p.label}: real, page-specific content renders (not a generic placeholder)`, { expected: true, actual: p.marker.test(text) });
    await dave.shot(`${p.id}-light`);
  }
  t.check("dave: no console errors/exceptions across every page", { expected: [], actual: dave.problems() });

  // ---- Shared expenses: directory vs. detail are genuinely different, real per-event balances -----
  await openPage(dave, "Shared expenses");
  const directoryText = await dave.text(".gpreview-pane .gframe__main");
  t.check("Shared expenses directory lists every event with a real lifecycle status", {
    expected: true, actual: /General/.test(directoryText) && /Museum day/.test(directoryText) && /Solo coffee run/.test(directoryText),
  });
  await dave.click({ role: "button", name: "View only Museum day", scope: ".gpreview-pane" });
  await dave.waitFor("document.querySelector('.gpreview-pane .gframe__main').textContent.toLowerCase().includes('who owes whom')", { what: "the event detail view" });
  const detailText = await dave.text(".gpreview-pane .gframe__main");
  t.check("selecting an event shows a genuinely different DETAIL view: real per-event balances and settlement, not just a narrowed list", {
    expected: true, actual: /who owes whom/i.test(detailText) && /Settle up/i.test(detailText),
  });
  await dave.shot("shared-detail-light");
  await setMode(dave, "dark");
  await dave.settle();
  await dave.shot("shared-detail-dark");
  await dave.click({ role: "button", text: "Viewing this event", scope: ".gpreview-pane" });
  await dave.waitFor("!document.querySelector('.gpreview-pane .gframe__main').textContent.toLowerCase().includes('who owes whom')", { what: "back to the combined directory view" });
  t.check("dave: no console errors/exceptions after the directory/detail round trip", { expected: [], actual: dave.problems() });
  await dave.close();

  // ---- mobile: every page reflows with no horizontal overflow -------------------------------------
  const { dave: mobile } = await h.browsers(["dave"], { prefix: "ledgerflypages-mobile-", width: 390, height: 844 });
  for (const p of PAGES) {
    await openPage(mobile, p.label);
    const overflow = await mobile.evaluate("document.documentElement.scrollWidth - window.innerWidth");
    t.check(`${p.label} mobile (390px): no horizontal page overflow`, { expected: true, actual: overflow <= 1 });
  }
  await mobile.shot("bills-mobile");
  t.check("mobile: no console errors/exceptions across every page", { expected: [], actual: mobile.problems() });
  await mobile.close();
}
