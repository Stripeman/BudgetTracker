// Dashboard: nav icon+label polish (Terry, 2026-09-17: "colored icons from Executive Ledger",
// "the navigation bar from Modern Banking"), and three widgets that did not exist before this
// change — a "Spending by category" donut, a "Top merchants" list ranked by spend (unlike the
// Merchants page's own alphabetical order), and a "this week" income/expense recap — verified in a
// real browser because a DOM-double unit test cannot see real SVG rendering, colour or layout.
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";

export const name = "dashboard";
export const title = "Dashboard: nav icons, spending-by-category donut, top merchants, this-week recap, category chip on Recent entries";
export const needsBrowser = true;

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Dashboard Household", kind: "household" });
  const q = W.q;
  const alice = h.api("alice");
  const account = firstRecord(await alice.ok("accounts", { method: "POST", query: q, body: { name: "E2E Checking", type: "checking", currency: "USD", openingBalance: "1000.00" } }));
  const cats = (await alice.ok("categories", { query: q })).categories;
  const groceries = cats.find((c) => c.name === "Groceries");
  const dining = cats.find((c) => c.name === "Dining");
  t.note(`categories: Groceries=${groceries.id} (${groceries.color}), Dining=${dining.id} (${dining.color})`);
  const grocer = firstRecord(await alice.ok("payees", { method: "POST", query: q, body: { name: "E2E Grocer" } }));
  const cafe = firstRecord(await alice.ok("payees", { method: "POST", query: q, body: { name: "E2E Cafe" } }));
  const today = new Date().toISOString().slice(0, 10);
  await alice.ok("transactions", { method: "POST", query: q, body: { accountId: account.id, kind: "expense", amount: "40.00", date: today, payeeId: grocer.id, categoryId: groceries.id } });
  await alice.ok("transactions", { method: "POST", query: q, body: { accountId: account.id, kind: "expense", amount: "15.00", date: today, payeeId: cafe.id, categoryId: dining.id } });
  await alice.ok("transactions", { method: "POST", query: q, body: { accountId: account.id, kind: "income", amount: "500.00", date: today } });

  const b = await h.browsers(["alice"], { prefix: "dashboard-" });
  await b.alice.open("dashboard");
  await b.alice.useWorkspace(W.name);
  await b.alice.waitForText("Spending by category", { scope: "main" });

  // ---- Nav: icon + label, active item marked (Terry's "Modern Banking" nav bar ask) -------------
  const navShape = await b.alice.evaluate(`(() => {
    const links = [...document.querySelectorAll(".app__nav a")];
    return {
      count: links.length,
      everyHasIconAndLabel: links.every((a) => a.querySelector("svg.icon") && a.textContent.trim().length > 0),
      dashboardCurrent: (() => { const d = links.find((a) => a.getAttribute("href") === "#/dashboard"); return d ? d.getAttribute("aria-current") : null; })(),
      othersNotCurrent: links.filter((a) => a.getAttribute("href") !== "#/dashboard").every((a) => a.getAttribute("aria-current") !== "page"),
    };
  })()`);
  t.check("every nav item shows an icon and a real text label", { expected: true, actual: navShape.everyHasIconAndLabel && navShape.count > 0 });
  t.check("the current route (Dashboard) is the only one marked aria-current=page", { expected: { dashboardCurrent: "page", othersNotCurrent: true }, actual: { dashboardCurrent: navShape.dashboardCurrent, othersNotCurrent: navShape.othersNotCurrent } });
  const shot = await b.alice.shot("nav-and-widgets");
  t.note(`screenshot: ${shot}`);

  // ---- This week's income/expenses recap ---------------------------------------------------------
  const weekText = await b.alice.evaluate(`(() => { const h2 = [...document.querySelectorAll('h2')].find((x) => x.textContent === 'Spending by category'); return h2 ? h2.closest('section').parentElement.parentElement.textContent : document.querySelector('main').textContent; })()`);
  t.check("this week's income (USD 500.00) is shown", { expected: true, actual: /Income this week \(USD\)/.test(weekText) && /USD 500\.00/.test(weekText) });
  t.check("this week's expenses (USD 55.00 = 40 + 15) are shown", { expected: true, actual: /Expenses this week \(USD\)/.test(weekText) && /USD 55\.00/.test(weekText) });

  // ---- Spending by category: a real donut, a legend and a sr-only figure table -------------------
  const donut = await b.alice.evaluate(`(() => {
    const svg = document.querySelector('svg.chart--donut');
    if (!svg) return { found: false };
    const segs = [...svg.querySelectorAll('.chart__donut-seg')];
    return { found: true, ariaHidden: svg.getAttribute('aria-hidden'), segCount: segs.length, colors: segs.map((s) => s.getAttribute('stroke')).sort() };
  })()`);
  t.check("a donut chart is drawn, decorative, with one segment per category", { expected: { found: true, ariaHidden: "true", segCount: 2 }, actual: { found: donut.found, ariaHidden: donut.ariaHidden, segCount: donut.segCount } });
  t.check("segment colours match the categories' own colours", { expected: [dining.color, groceries.color].sort(), actual: donut.colors });
  const legendText = await b.alice.evaluate("document.querySelector('.chart__legend').textContent");
  t.check("the visible legend names both categories and their exact amounts (colour is never the only signal)", {
    expected: true, actual: /Groceries/.test(legendText) && /USD 40\.00/.test(legendText) && /Dining/.test(legendText) && /USD 15\.00/.test(legendText),
  });

  // ---- Top merchants: ranked by spend, not alphabetical (E2E Grocer 40.00 > E2E Cafe 15.00) -------
  const merchantsText = await b.alice.evaluate(`(() => { const h2 = [...document.querySelectorAll('h2')].find((x) => x.textContent === 'Top merchants'); return h2.closest('section').textContent; })()`);
  t.check("Top merchants shows both, higher spend first", { expected: true, actual: merchantsText.indexOf("E2E Grocer") < merchantsText.indexOf("E2E Cafe") && merchantsText.indexOf("E2E Cafe") !== -1 });
  t.check("Top merchants shows the exact spend amounts", { expected: true, actual: /USD 40\.00/.test(merchantsText) && /USD 15\.00/.test(merchantsText) });

  // ---- Recent entries: a coloured category chip beside the merchant -------------------------------
  const recentCat = await b.alice.evaluate(`(() => {
    const h2 = [...document.querySelectorAll('h2')].find((x) => x.textContent === 'Recent entries');
    const chip = h2.closest('section').querySelector('.catlabel');
    if (!chip) return { found: false };
    return { found: true, text: chip.textContent, swatch: chip.querySelector('.catlabel__icon').style.getPropertyValue('--swatch') };
  })()`);
  t.check("a Recent entries row shows its category, coloured", { expected: true, actual: recentCat.found && /Groceries|Dining/.test(recentCat.text) && !!recentCat.swatch });

  // ---- 320px: no horizontal overflow, still no console errors -------------------------------------
  const { alice: narrow } = await h.browsers(["alice"], { prefix: "dashboard-320-", width: 320, height: 900 });
  await narrow.open("dashboard");
  await narrow.useWorkspace(W.name);
  await narrow.waitForText("Spending by category", { scope: "main" });
  const overflow = await narrow.evaluate("document.documentElement.scrollWidth - window.innerWidth");
  t.check("320px width: no horizontal page overflow", { expected: true, actual: overflow <= 1 });
  await narrow.shot("320px");
  t.check("320px: no console errors/exceptions", { expected: [], actual: narrow.problems() });

  // ---- Bug fix (2026-09-24, Terry: "data in each panel take a few seconds to load. initially
  // indicating to the user that there is nothing there... make it so each one thats loading has an
  // indicator like when the main site is loading") — real network-level delay on exactly the data
  // API calls (CDP Fetch domain interception, not a page-script fake, and not a blanket
  // Network.emulateNetworkConditions, which would also slow the app shell itself down and make the
  // shell's own load time hide the very panels this proves), so the panels genuinely have not
  // resolved yet at the moment the DOM is inspected — the app shell loads at normal speed, exactly
  // reproducing what Terry described (the page itself is up; specific panels lag behind it). -------
  const { alice: slow } = await h.browsers(["alice"], { prefix: "dashboard-slow-" });
  await slow.cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  // Bootstrap calls (the workspace picker's own list, identity, preferences, and reference data every
  // page needs regardless of panel) pass through at normal speed — exactly what genuinely differs in
  // Terry's report ("data in each panel take a few seconds to load", the shell and picker themselves
  // were never in question). Only the panels' OWN data calls (accounts, transactions/week/month
  // activity, bills, forecast, payees — all still hit the same `/api/transactions` endpoint with
  // different query filters, so this matches by path, not by slice) are held.
  const FAST_PATHS = ["/api/workspaces", "/api/me", "/api/preferences", "/api/site-settings", "/api/categories", "/api/members", "/api/icons", "/api/account-types", "/api/category-types", "/api/merchant-types"];
  slow.cdp.on("Fetch.requestPaused", async (p) => {
    const isBootstrap = FAST_PATHS.some((path) => p.request.url.includes(path));
    if (!isBootstrap) await new Promise((resolve) => setTimeout(resolve, 1500));
    await slow.cdp.send("Fetch.continueRequest", { requestId: p.requestId }).catch(() => {});
  });
  await slow.cdp.send("Page.navigate", { url: `${slow.base}/#/dashboard` });
  // Deliberately NOT slow.open()/settle() here — those wait for every request to finish, which is
  // exactly the state after the loading window this check exists to prove. A short real wait — long
  // enough for the shell and the (fast) bootstrap calls to finish, well short of the 1.5s the panel
  // data calls are held for — catches the page genuinely mid-flight instead.
  await new Promise((resolve) => setTimeout(resolve, 900));
  const midFlight = await slow.evaluate(`(() => ({
    spinners: document.querySelectorAll(".spinner").length,
    navRendered: !!document.querySelector(".app__nav"),
    fabricatedEmpty: /No spending recorded yet this month\\.|No merchant activity yet\\.|No accounts yet\\./.test(document.querySelector("main") ? document.querySelector("main").textContent : ""),
  }))()`);
  const shotLoading = await slow.shot("loading-indicators-mid-flight");
  t.check("the app shell itself is already up (its own load was never throttled)", { expected: true, actual: midFlight.navRendered });
  t.check("while its own data is genuinely still loading, at least one real spinner is visible in the actual rendered page", { expected: true, actual: midFlight.spinners > 0 });
  t.check("no panel fabricates an empty/'nothing here' message while it is still loading", { expected: false, actual: midFlight.fabricatedEmpty });
  t.note(`spinners visible mid-flight: ${midFlight.spinners}; screenshot: ${shotLoading}`);
  // Let the held requests through and confirm the page finishes loading normally: the real figures
  // appear, no spinner is left behind, and the interception itself caused no error.
  await slow.settle({ timeout: 20000 });
  await slow.useWorkspace(W.name);
  await slow.waitForText("Spending by category", { scope: "main" });
  const settled = await slow.evaluate(`(() => ({
    spinners: document.querySelectorAll(".spinner").length,
    hasRealSpending: /USD 40\\.00/.test(document.querySelector("main").textContent),
  }))()`);
  t.check("once loading genuinely finishes, no spinner is left behind and the real figures are shown", { expected: { spinners: 0, hasRealSpending: true }, actual: settled });
  t.check("slow: no exceptions, console errors or failed requests caused by the delayed load", { expected: [], actual: slow.problems() });

  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: b.alice.problems() });
}
