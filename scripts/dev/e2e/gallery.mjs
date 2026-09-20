// BT-013 Design Gallery, verified in real headless Edge (never a static screenshot claim): the
// Gallery is reachable only by a site administrator (401/403/hidden nav for everyone else); every
// one of the 15 concepts renders a live thumbnail with no console errors; a sample walk across
// distinct navStyle/dashboardPattern families renders every required page; desktop/tablet/mobile
// widths with no horizontal overflow at 320px; light/dark and a palette sample with the same
// pageContrast/pageBorderContrast pattern login.mjs already established; reduced motion; and the
// workspace `layoutId` setting's real plumbing (schema/API/audit/permissions), shown in a real
// browser even though it is not yet wired to any of the 15 concepts.
export const name = "gallery";
export const title = "BT-013 Design Gallery: site-admin only, all 15 concepts render, sampled pages/viewports/palettes/modes, no 320px overflow, reduced motion, layoutId setting plumbing";
export const needsBrowser = true;

// The same contrast primitives as scripts/dev/e2e/login.mjs (serialized with toString(), so each
// must stay self-contained) — reused rather than reinvented, applied to the Gallery's own real text.
function pageContrast(selectors) {
  function relLuminance([r, g, b]) {
    const chan = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
  }
  function parseRgb(str) {
    const m = /rgba?\(([^)]+)\)/.exec(str || "");
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function effectiveBg(el) {
    for (let node = el; node; node = node.parentElement) {
      const bg = parseRgb(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0.99) return bg;
    }
    return { r: 255, g: 255, b: 255 };
  }
  function ratio(fg, bg) {
    const l1 = relLuminance([fg.r, fg.g, fg.b]) + 0.05;
    const l2 = relLuminance([bg.r, bg.g, bg.b]) + 0.05;
    return l1 > l2 ? l1 / l2 : l2 / l1;
  }
  const out = {};
  for (const sel of selectors) {
    const els = [...document.querySelectorAll(sel)].slice(0, 3);
    out[sel] = els.map((el) => { const fg = parseRgb(getComputedStyle(el).color); return fg ? Math.round(ratio(fg, effectiveBg(el)) * 100) / 100 : null; });
  }
  return out;
}

const PALETTES_SAMPLE = ["midnight", "forest", "rose"]; // 3 of the 8 (login.mjs checks all 8 for its own smaller page; the Gallery is much larger, so this session sampled 3 spanning light/mid/dark accent hues — see the handoff report for why)
const CONTRAST_SELECTORS = [".gcard-outer h3", ".gcard-outer p.muted", ".gcard__title", ".gmetric__value", ".gnav__item"];

const toMs = (css) => { const s = String(css).trim(); return s.endsWith("ms") ? parseFloat(s) : s.endsWith("s") ? parseFloat(s) * 1000 : NaN; };

export async function run(h, t) {
  // ---- API: only a site administrator may read or change the Gallery -----------------------------
  for (const as of ["alice", "bob", "carol"]) {
    const res = await h.api(as).request("design-gallery");
    t.check(`${as} (not a site admin): GET /api/design-gallery is refused`, { expected: 403, actual: res.status });
  }
  const asEve = await h.api("eve").request("design-gallery");
  t.check("eve (outsider): GET /api/design-gallery is refused", { expected: 403, actual: asEve.status });
  const asAnon = await fetch(`${h.base}/api/design-gallery`);
  t.check("anonymous: GET /api/design-gallery is refused", { expected: 401, actual: asAnon.status });
  const daveGet = await h.api("dave").ok("design-gallery");
  t.check("dave (site admin): sees all 15 concepts and the 8 required pages (Accounts/Merchants added, review 2026-09-18)", { expected: { concepts: 15, pages: 8 }, actual: { concepts: daveGet.concepts.length, pages: daveGet.requiredPages.length } });
  const alicePatch = await h.api("alice").request("design-gallery", { method: "PATCH", body: { picks: { selectedIds: ["executive-ledger"] } } });
  t.check("alice: PATCH /api/design-gallery (picks) is refused", { expected: 403, actual: alicePatch.status });

  // ---- browsers: alice (non-admin) and dave (site admin) -----------------------------------------
  const { alice, dave } = await h.browsers(["alice", "dave"], { prefix: "gallery-" });

  await alice.open("dashboard");
  t.check("alice: no 'Design Gallery' entry anywhere in her DOM", { expected: false, actual: await alice.exists('a[href="#/gallery"]') });
  await alice.goto("gallery");
  const aliceText = await alice.text();
  t.check("alice: opening #/gallery directly shows no concept data, only the refusal sentence", {
    expected: { hasData: false, hasRefusal: true },
    actual: { hasData: /All 15 concepts/.test(aliceText), hasRefusal: /only shown to site administrators/.test(aliceText) },
  });
  t.check("alice: no exceptions or console errors", { expected: [], actual: alice.problems({ allowHttp: [{ status: 403, path: /\/api\/design-gallery$/ }] }) });

  await dave.open("dashboard");
  // Usage, Design Gallery and Workspaces are grouped under one "Site Settings" nav entry (Terry,
  // 2026-09-17); from the Dashboard, only that grouping entry is reachable — the three sub-tabs
  // appear once inside it, not from every other page.
  t.check("dave: a 'Site Settings' entry exists in the DOM from the Dashboard", { expected: true, actual: await dave.exists('a[href="#/admin-workspaces"]') });
  await dave.goto("gallery");
  await dave.waitForText("All 15 concepts");
  const subTabHrefs = await dave.evaluate("[...document.querySelectorAll('.app__nav--sub a')].map((a) => a.getAttribute('href'))");
  t.check("dave: all four Site Settings sub-tabs (Workspaces, Design Gallery, Usage, Account requests) are present once inside the group", {
    expected: ["#/admin-workspaces", "#/gallery", "#/analytics", "#/account-requests"], actual: subTabHrefs,
  });
  const cardCount = await dave.evaluate("document.querySelectorAll('.gcard-outer').length");
  t.check("dave: all 15 concept cards render", { expected: 15, actual: cardCount });
  const thumbCount = await dave.evaluate("document.querySelectorAll('.gcard-outer .gframe').length");
  t.check("dave: every card carries a live rendered preview thumbnail (never a static image)", { expected: 15, actual: thumbCount });
  const navFamilies = await dave.evaluate("[...new Set([...document.querySelectorAll('.gcard-outer .gframe')].map((f) => f.dataset.nav))].sort()");
  t.check("dave: the loaded concepts show at least 4 distinct navigation families (genuine structural variety)", { expected: true, actual: navFamilies.length >= 4 });
  await dave.shot("grid-all-15");
  t.check("dave: no console errors/exceptions loading and rendering all 15 concepts at once", { expected: [], actual: dave.problems() });

  // ---- sample deep walk: 5 concepts spanning distinct nav styles, every required page -------------
  // Sampled (not all 15 x 7 in the browser): the composition-engine unit tests
  // (app/test/gallery.test.js) already render 20 x 7 = 140 combinations headlessly without a browser,
  // against that test's own self-contained representative fixture (independent of the 15 real
  // concepts here since Terry's 2026-09-17 cut), and assert no exception; this real-browser walk
  // instead proves the ones a person would
  // actually navigate render correctly with real layout/CSS, covering every distinct navStyle family
  // (sidebar, top, rail, sidebar-right, command, tabs) at least once.
  const sample = [
    { id: "executive-ledger", nav: "sidebar" },
    { id: "financial-command-center", nav: "rail" },
    { id: "analyst-workspace", nav: "sidebar-right" },
    { id: "focus-mode", nav: "command" },
    { id: "modern-banking", nav: "tabs" },
    { id: "household-hub", nav: "top" },
  ];
  const pages = ["dashboard", "transactions", "bills", "budget", "accounts", "shared", "trips", "settings"];
  const PAGE_LABELS = { dashboard: "Dashboard", transactions: "Transactions", bills: "Bills", budget: "Budget", accounts: "Accounts / Merchants", shared: "Shared expenses", trips: "Trips", settings: "Settings" };
  for (const { id, nav } of sample) {
    await dave.click({ role: "button", text: "Preview this concept", scope: `[data-concept="${id}"]` });
    for (const page of pages) {
      await dave.choose("Preview page", PAGE_LABELS[page]);
      const frameNav = await dave.evaluate("(() => { const f = document.querySelector('.gpreview-pane .gframe'); return f ? f.dataset.nav : null; })()");
      t.check(`${id}/${page}: the preview frame's own navStyle matches the concept (${nav})`, { expected: nav, actual: frameNav });
      const hasContent = await dave.evaluate("(() => { const m = document.querySelector('.gpreview-pane .gframe__main'); return !!m && m.textContent.trim().length > 20; })()");
      t.check(`${id}/${page}: the page has real rendered content`, { expected: true, actual: hasContent });
      // One full 7-page walk-through in screenshots, for the flagship concept most representative
      // of the "table-first, sidebar" family (Terry's report quotes exact paths for all of these).
      if (id === "executive-ledger") await dave.shot(`page-${page}`);
    }
    t.check(`${id}: no console errors/exceptions after walking all 7 required pages`, { expected: [], actual: dave.problems() });
  }
  await dave.shot("preview-sample");

  // ---- secondary-page composition patterns (review, 2026-09-18): real proof, not just unit tests,
  // that Transactions/Bills/Accounts genuinely differ in STRUCTURE between concepts, not only chrome.
  await dave.click({ role: "button", text: "Preview this concept", scope: '[data-concept="executive-ledger"]' }); // transactionsPattern: dense-table
  await dave.choose("Preview page", "Transactions");
  const denseHtml = await dave.evaluate("(() => { const m = document.querySelector('.gpreview-pane .gframe__main'); return { hasTable: !!m.querySelector('table.gtable-dense'), hasCards: !!m.querySelector('.gminicard') }; })()");
  t.check("Executive Ledger's Transactions page is a real dense table (dense-table pattern)", { expected: { hasTable: true, hasCards: false }, actual: denseHtml });
  await dave.shot("transactions-dense-table");
  await dave.click({ role: "button", text: "Preview this concept", scope: '[data-concept="modern-banking"]' }); // transactionsPattern: card-list
  await dave.choose("Preview page", "Transactions");
  const cardHtml = await dave.evaluate("(() => { const m = document.querySelector('.gpreview-pane .gframe__main'); return { hasTable: !!m.querySelector('table.gtable-dense'), hasCards: !!m.querySelector('.gminicard') }; })()");
  t.check("Modern Banking's Transactions page is a card grid instead (card-list pattern) — same data, genuinely different structure", { expected: { hasTable: false, hasCards: true }, actual: cardHtml });
  await dave.shot("transactions-card-list");

  await dave.click({ role: "button", text: "Preview this concept", scope: '[data-concept="financial-command-center"]' }); // billsPattern: kanban-columns
  await dave.choose("Preview page", "Bills");
  const kanban = await dave.evaluate("!!document.querySelector('.gpreview-pane .gkanban')");
  t.check("Financial Command Center's Bills page is three side-by-side kanban columns", { expected: true, actual: kanban });
  await dave.shot("bills-kanban");
  await dave.click({ role: "button", text: "Preview this concept", scope: '[data-concept="wealth-overview"]' }); // billsPattern: timeline
  await dave.choose("Preview page", "Bills");
  const timeline = await dave.evaluate("(() => { const m = document.querySelector('.gpreview-pane .gframe__main'); return { kanban: !!m.querySelector('.gkanban'), timeline: !!m.querySelector('ol.gtimeline') }; })()");
  t.check("Wealth Overview's Bills page is one chronological timeline instead — same data, genuinely different structure", { expected: { kanban: false, timeline: true }, actual: timeline });
  await dave.shot("bills-timeline");

  // Accounts/Merchants — the page the Gallery was entirely missing before this fix.
  await dave.click({ role: "button", text: "Preview this concept", scope: '[data-concept="acru-overview"]' }); // accountsPattern: table
  await dave.choose("Preview page", "Accounts / Merchants");
  const accountsPage = await dave.evaluate("(() => { const m = document.querySelector('.gpreview-pane .gframe__main'); return { text: m.textContent, hasTable: !!m.querySelector('table.gtable-dense') }; })()");
  t.check("the new Accounts/Merchants page shows real account and merchant names, as a table for this concept", {
    expected: { hasTable: true, hasAccounts: true, hasMerchants: true },
    actual: { hasTable: accountsPage.hasTable, hasAccounts: /Joint Checking|Household Card/.test(accountsPage.text), hasMerchants: /Fictional Grocer|Corner Cafe/.test(accountsPage.text) },
  });
  await dave.shot("accounts-merchants-table");

  // Shared expenses / Trips (review, 2026-09-18 follow-up): these two were the last required pages
  // still sharing one template across all 15 concepts — real-browser proof they now genuinely
  // differ in structure too, not just chrome.
  await dave.click({ role: "button", text: "Preview this concept", scope: '[data-concept="executive-ledger"]' }); // sharedPattern: ledger-table
  await dave.choose("Preview page", "Shared expenses");
  const sharedLedger = await dave.evaluate("(() => { const m = document.querySelector('.gpreview-pane .gframe__main'); return { hasTable: !!m.querySelector('table.gtable-dense'), hasSettleUp: /Settle up/.test(m.textContent) }; })()");
  t.check("Executive Ledger's Shared expenses page is a real ledger table (ledger-table pattern)", { expected: { hasTable: true, hasSettleUp: false }, actual: sharedLedger });
  await dave.shot("shared-ledger-table");
  await dave.click({ role: "button", text: "Preview this concept", scope: '[data-concept="financial-command-center"]' }); // sharedPattern: settlement-focus
  await dave.choose("Preview page", "Shared expenses");
  const sharedSettlement = await dave.evaluate("(() => { const m = document.querySelector('.gpreview-pane .gframe__main'); return { hasTable: !!m.querySelector('table.gtable-dense'), hasSettleUp: /Settle up/.test(m.textContent) }; })()");
  t.check("Financial Command Center's Shared expenses page leads with 'Settle up' instead — same data, genuinely different structure", { expected: { hasTable: false, hasSettleUp: true }, actual: sharedSettlement });
  await dave.shot("shared-settlement-focus");
  t.check("dave: no console errors/exceptions after the Shared expenses pattern walk", { expected: [], actual: dave.problems() });

  await dave.click({ role: "button", text: "Preview this concept", scope: '[data-concept="wealth-overview"]' }); // tripsPattern: timeline
  await dave.choose("Preview page", "Trips");
  const tripsTimeline = await dave.evaluate("(() => { const m = document.querySelector('.gpreview-pane .gframe__main'); return { hasTimeline: !!m.querySelector('ol.gtimeline'), hasCardGrid: !!m.querySelector('.ggrid--metrics'), hasDisclosure: /not yet a real BudgetTracker feature/.test(m.textContent) }; })()");
  t.check("Wealth Overview's Trips page is one chronological ordered list, and still keeps the illustrative-only disclosure", { expected: { hasTimeline: true, hasCardGrid: false, hasDisclosure: true }, actual: tripsTimeline });
  await dave.shot("trips-timeline");
  await dave.click({ role: "button", text: "Preview this concept", scope: '[data-concept="modern-banking"]' }); // tripsPattern: card-grid
  await dave.choose("Preview page", "Trips");
  const tripsCardGrid = await dave.evaluate("(() => { const m = document.querySelector('.gpreview-pane .gframe__main'); return { hasTimeline: !!m.querySelector('ol.gtimeline'), hasCardGrid: !!m.querySelector('.ggrid--metrics') }; })()");
  t.check("Modern Banking's Trips page is a card grid instead — same data, genuinely different structure", { expected: { hasTimeline: false, hasCardGrid: true }, actual: tripsCardGrid });
  await dave.shot("trips-card-grid");
  t.check("dave: no console errors/exceptions after the Trips pattern walk", { expected: [], actual: dave.problems() });

  // ---- Compare mode: two concepts side by side --------------------------------------------------
  await dave.click({ role: "button", text: "Preview this concept", scope: '[data-concept="executive-ledger"]' });
  await dave.click({ role: "button", text: "Compare with current preview", scope: '[data-concept="modern-banking"]' });
  const compareFrames = await dave.evaluate("document.querySelectorAll('.gcompare .gframe').length");
  t.check("Compare mode shows two live frames side by side", { expected: 2, actual: compareFrames });
  const ids = await dave.evaluate("(() => { const all = [...document.querySelectorAll('[id]')].map((n) => n.id); return { total: all.length, unique: new Set(all).size }; })()");
  t.check("Compare mode: no duplicate element ids on the page (two concepts sharing card titles still get unique heading ids)", { expected: ids.total, actual: ids.unique });
  await dave.shot("compare");
  t.check("dave: no console errors/exceptions after Compare mode", { expected: [], actual: dave.problems() });

  // Compare mode persists across concept switches until explicitly removed — leave it now, before
  // any check below that queries `.gpreview-pane` expecting exactly ONE concept's own content
  // (BT-013-09 found this the hard way: once a redesigned concept's own dashboard could add its own
  // extra chart element, a still-active compare pane silently contaminated an unrelated concept's
  // count of the same element). A "Preview this concept" click re-renders the whole grid (refreshing
  // every card's own "Compare…"/"Remove from compare" label from the current compareId — the grid is
  // never refreshed by the compare toggle alone), so it comes first here, not after.
  await dave.click({ role: "button", text: "Preview this concept", scope: '[data-concept="executive-ledger"]' }); // typeVoice: technical-mono
  await dave.click({ role: "button", text: "Remove from compare", scope: '[data-concept="modern-banking"]' });

  // ---- typography voice and the new chart primitives (Terry, 2026-09-18: "deliberate typography…
  // graphics, metrics" — reference 5's filled forecast area, reference 1/6's circular progress ring) -
  await dave.choose("Preview page", "Dashboard");
  const monoHeading = await dave.evaluate("(() => { const h = document.querySelector('.gpreview-pane .gpage__head h2'); return h ? getComputedStyle(h).fontFamily : null; })()");
  await dave.click({ role: "button", text: "Preview this concept", scope: '[data-concept="wealth-overview"]' }); // typeVoice: editorial-serif
  await dave.choose("Preview page", "Dashboard");
  const serifHeading = await dave.evaluate("(() => { const h = document.querySelector('.gpreview-pane .gpage__head h2'); return h ? getComputedStyle(h).fontFamily : null; })()");
  t.check("Executive Ledger (technical-mono) and Wealth Overview (editorial-serif) render their page heading in genuinely different computed font families", {
    expected: true, actual: !!monoHeading && !!serifHeading && monoHeading !== serifHeading,
  });
  t.note(`technical-mono heading font: ${monoHeading}; editorial-serif heading font: ${serifHeading}`);

  // Wealth Overview: the new filled forecast area chart (reference 5), real content, not a bare line.
  const areaChart = await dave.evaluate("(() => { const m = document.querySelector('.gpreview-pane .gframe__main'); return { hasArea: !!m.querySelector('.chart--area'), hasFill: !!m.querySelector('.chart__area-fill') }; })()");
  t.check("Wealth Overview's chart-first Dashboard renders the new filled area chart", { expected: { hasArea: true, hasFill: true }, actual: areaChart });
  await dave.shot("wealth-overview-area-chart");

  // Goal Navigator: the new circular progress gauge (reference 1/6), a real accessible label with the
  // actual percentage, never colour or the arc alone.
  await dave.click({ role: "button", text: "Preview this concept", scope: '[data-concept="goal-navigator"]' });
  await dave.choose("Preview page", "Dashboard");
  const gauge = await dave.evaluate("(() => { const gs = [...document.querySelectorAll('.gpreview-pane .chart--gauge')]; return { count: gs.length, labels: gs.map((g) => g.getAttribute('aria-label')) }; })()");
  t.check("Goal Navigator's goal-progress Dashboard renders two circular gauges, each with a real percentage in its accessible label", {
    expected: true, actual: gauge.count === 2 && gauge.labels.every((l) => /%/.test(l || "")),
  });
  t.note(`gauge labels: ${JSON.stringify(gauge.labels)}`);
  await dave.shot("goal-navigator-gauge");

  // Everyday Banking (BT-013-09 redesign): chartEmphasis 'mixed' adds a "Budget used" ring to its
  // mosaic dashboard, alongside its own regular figure tiles.
  await dave.click({ role: "button", text: "Preview this concept", scope: '[data-concept="modern-banking"]' });
  await dave.choose("Preview page", "Dashboard");
  const mixedMosaic = await dave.evaluate("(() => { const m = document.querySelector('.gpreview-pane .gframe__main'); return { hasBudgetUsed: /Budget used/.test(m.textContent), hasGauge: !!m.querySelector('.chart--gauge'), hasMosaic: !!m.querySelector('.gmosaic') }; })()");
  t.check("Everyday Banking's mosaic Dashboard adds a 'Budget used' ring alongside its own regular tiles, since its chartEmphasis is 'mixed'", {
    expected: { hasBudgetUsed: true, hasGauge: true, hasMosaic: true }, actual: mixedMosaic,
  });
  await dave.shot("modern-banking-mixed-mosaic");
  t.check("dave: no console errors/exceptions after the typography/chart walk", { expected: [], actual: dave.problems() });

  // ---- desktop / tablet / mobile widths, no horizontal overflow at 320px -------------------------
  const { dave: narrow } = await h.browsers(["dave"], { prefix: "gallery-320-", width: 320, height: 720 });
  await narrow.open("gallery");
  await narrow.waitForText("All 15 concepts");
  const overflow320 = await narrow.evaluate("document.documentElement.scrollWidth - window.innerWidth");
  t.check("320px width: no horizontal page overflow", { expected: true, actual: overflow320 <= 1 });
  await narrow.shot("320px");
  t.check("320px: no console errors/exceptions", { expected: [], actual: narrow.problems() });

  const { dave: tablet } = await h.browsers(["dave"], { prefix: "gallery-834-", width: 834, height: 900 });
  await tablet.open("gallery");
  await tablet.waitForText("All 15 concepts");
  const overflow834 = await tablet.evaluate("document.documentElement.scrollWidth - window.innerWidth");
  t.check("834px (tablet) width: no horizontal page overflow", { expected: true, actual: overflow834 <= 1 });
  await tablet.shot("834px");

  // ---- light/dark and a palette sample (3 of 8), reusing the login page's contrast pattern -------
  // The attribute change and the contrast read are ONE evaluate() call (found by direct
  // diagnosis): across two separate CDP round-trips, a deeply nested custom-property-driven
  // background (inside the scaled preview frames) was sometimes read before Edge finished
  // recomputing style for the new attribute, giving a false near-1:1 ratio; querying computed
  // style for the SAME element twice in the same script (forcing one recalculation first) always
  // read correctly, which is what combining the two steps into one call does structurally.
  for (const themeId of PALETTES_SAMPLE) {
    for (const mode of ["light", "dark"]) {
      const ratios = await dave.evaluate(`(() => {
        const r = document.documentElement;
        r.setAttribute('data-theme', ${JSON.stringify(themeId)});
        r.setAttribute('data-mode', ${JSON.stringify(mode)});
        r.setAttribute('data-color-scheme', ${JSON.stringify(mode)});
        void document.body.offsetHeight; // force a style/layout flush before reading computed style
        return (${pageContrast.toString()})(${JSON.stringify(CONTRAST_SELECTORS)});
      })()`);
      const failing = Object.entries(ratios).flatMap(([sel, list]) => list.map((r, i) => (r === null || r < 4.5) ? `${sel}[${i}]: ${r}` : null)).filter(Boolean);
      t.check(`${themeId}/${mode}: sampled Gallery text is >= 4.5:1 against its effective background`, { expected: [], actual: failing });
      if (themeId === "midnight" || themeId === "forest") await dave.shot(`palette-${themeId}-${mode}`);
    }
  }
  await dave.evaluate("(() => { const r = document.documentElement; r.setAttribute('data-theme', 'midnight'); r.setAttribute('data-mode', 'light'); r.setAttribute('data-color-scheme', 'light'); })()");

  // ---- reduced motion: the harness already emulates prefers-reduced-motion for every session; the
  // Gallery introduces no new transition, so the existing site-wide near-zero transition policy
  // (base.css) must still hold on a Gallery-specific element. -------------------------------------
  const navDuration = await dave.evaluate("getComputedStyle(document.querySelector('.gnav__item')).transitionDuration");
  t.check("reduced motion: a Gallery nav item's own transition duration is effectively zero (the site-wide reduced-motion rule applies here too)", { expected: true, actual: toMs(navDuration) <= 1 });

  // ---- the workspace layoutId setting's real plumbing, in a real browser (not yet wired to any of
  // the 15 concepts — only "Classic" is a real, selectable option today) ---------------------------
  await alice.useWorkspace("Fictional Household");
  await alice.goto("workspace");
  // The settings card groups its settings under collapsible headings, only the first open by
  // default (settingsform.js) — "Appearance" (layoutId's group) is not the first, so it is opened
  // the way a person would: pressing its own heading toggle.
  await alice.waitForText("Appearance");
  await alice.click({ role: "button", text: "Appearance" });
  await alice.waitForText("Layout theme");
  const workspaceText = await alice.text();
  t.check("alice (owner): the Workspace settings page shows the real 'Layout theme' setting with today's one real option", {
    expected: true, actual: /Layout theme/.test(workspaceText) && /Classic \(current\)/.test(workspaceText),
  });
  t.check("alice: no console errors/exceptions on Workspace settings", { expected: [], actual: alice.problems() });

  // ---- per-concept colour identity (review, 2026-09-19): two concepts' own --g-accent genuinely
  // differ, and it is scoped to each concept's own frame only (never a global/site style). ---------
  await dave.click({ role: "button", text: "Preview this concept", scope: '[data-concept="executive-ledger"]' });
  await dave.choose("Preview page", "Dashboard");
  const accentA = await dave.evaluate("getComputedStyle(document.querySelector('.gpreview-pane .gframe')).getPropertyValue('--g-accent').trim()");
  await dave.click({ role: "button", text: "Preview this concept", scope: '[data-concept="wealth-overview"]' });
  await dave.choose("Preview page", "Dashboard");
  const accentB = await dave.evaluate("getComputedStyle(document.querySelector('.gpreview-pane .gframe')).getPropertyValue('--g-accent').trim()");
  const bodyAccent = await dave.evaluate("getComputedStyle(document.body).getPropertyValue('--g-accent').trim()");
  t.check("Executive Ledger and Wealth Overview render genuinely different accent colours, scoped to each concept's own frame (never leaking onto <body>)", {
    expected: { differ: true, notOnBody: true }, actual: { differ: !!accentA && !!accentB && accentA !== accentB, notOnBody: bodyAccent === "" },
  });
  t.note(`Executive Ledger --g-accent: ${accentA}; Wealth Overview --g-accent: ${accentB}`);
  await dave.shot("accent-identity");

  // ---- real interactive Settings controls (review, 2026-09-19): no longer a read-only badge list --
  await dave.choose("Preview page", "Settings");
  const beforeSetting = await dave.evaluate("(() => { const s = document.querySelector('.gpreview-pane select'); return s ? s.value : null; })()");
  await dave.evaluate(`(() => {
    const s = document.querySelector('.gpreview-pane select');
    const other = [...s.options].map((o) => o.value).find((v) => v !== s.value);
    s.value = other;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const afterSetting = await dave.evaluate("(() => { const s = document.querySelector('.gpreview-pane select'); return s ? s.value : null; })()");
  const settingsText = await dave.text(".gpreview-pane");
  t.check("a Settings control in the real browser genuinely changes value when interacted with, and says plainly that nothing is saved", {
    expected: { changed: true, saysPreviewOnly: true }, actual: { changed: !!beforeSetting && !!afterSetting && beforeSetting !== afterSetting, saysPreviewOnly: /Preview only/.test(settingsText) },
  });
  await dave.shot("settings-interactive");

  // ---- Shared-expense event directory/detail (review, 2026-09-19, reflecting the real BT-009-20
  // model): choosing one event narrows the expense list; going back shows every event combined. ----
  await dave.choose("Preview page", "Shared expenses");
  const sharedBefore = await dave.text(".gpreview-pane");
  t.check("the Shared expenses preview shows a real Events directory with the sample events by name and status", {
    expected: true, actual: /Events/.test(sharedBefore) && /General/.test(sharedBefore) && /Museum day/.test(sharedBefore) && /Closed/.test(sharedBefore),
  });
  await dave.click({ role: "button", name: "View only Museum day", scope: ".gpreview-pane" });
  const sharedAfter = await dave.text(".gpreview-pane");
  t.check("choosing an event in the real browser narrows the shared-expenses list to that event's own, with a plain-language scoped banner", {
    expected: true, actual: /Showing only/.test(sharedAfter),
  });
  await dave.shot("shared-events-scoped");
  await dave.click({ role: "button", name: "Stop viewing Museum day — show every event combined", scope: ".gpreview-pane" });
  const sharedBack = await dave.text(".gpreview-pane");
  t.check("going back shows every event combined again", { expected: false, actual: /Showing only/.test(sharedBack) });
  t.check("dave: no console errors/exceptions after the Events directory walk", { expected: [], actual: dave.problems() });

  // ---- the one silent no-op button (review, 2026-09-19): story-flow's "Add expense" now genuinely
  // switches the preview to Transactions, instead of doing nothing. ----------------------------------
  await dave.click({ role: "button", text: "Preview this concept", scope: '[data-concept="calm-budget"]' }); // dashboardPattern: story-flow
  await dave.choose("Preview page", "Dashboard");
  await dave.click({ role: "button", text: "Add expense", scope: ".gpreview-pane" });
  const pageAfterAddExpense = await dave.evaluate("(() => { const f = document.querySelector('.gpreview-pane .gframe'); return f ? f.dataset.page : null; })()");
  t.check("pressing story-flow's 'Add expense' in the real browser switches the preview page to Transactions — a real action, not a silent no-op", {
    expected: "transactions", actual: pageAfterAddExpense,
  });
  t.check("dave: no console errors/exceptions after the story-flow no-op fix check", { expected: [], actual: dave.problems() });

  t.check("dave: no console errors/exceptions across the whole scenario", { expected: [], actual: dave.problems() });
}
