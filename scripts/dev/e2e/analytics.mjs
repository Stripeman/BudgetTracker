// SITE USAGE (BT-012-01, Terry 2026-09-14: "i would like to add a usage statistics on the site for
// the site admin ... what users, how many users, frequency of use, last log ins etc"). Dave (site
// admin, by configuration, never by membership) can reach and read the Usage page with counts that
// match the API, after Alice, Bob and Carol sign in; Alice (not a site admin) has no "Usage" nav
// entry anywhere in the DOM and is refused both through the API and by the page itself when she
// opens #/analytics directly. The response never carries a financial field.
export const name = "analytics";
export const title = "Site usage (BT-012-01): Dave sees correct counts after alice/bob/carol sign in; Alice has no nav entry and is refused";
export const needsBrowser = true;

const FORBIDDEN_KEYS = ["accountId", "amountMinor", "balance", "currency", "payeeId", "categoryId", "merchantId", "transactions", "accounts", "merchants", "budgets", "payees", "name", "email"];

export async function run(h, t) {
  // ---- API: a non-admin is refused; a site administrator gets a well-shaped, non-financial answer.
  const asAlice = await h.api("alice").request("analytics");
  t.check("alice (not a site admin): GET /api/analytics is refused", { expected: 403, actual: asAlice.status });
  const asAnon = await fetch(`${h.base}/api/analytics`);
  t.check("anonymous: GET /api/analytics is refused", { expected: 401, actual: asAnon.status });

  const before = await h.api("dave").ok("analytics");
  t.check("dave (site admin, control): GET /api/analytics answers with the expected shape", {
    expected: true,
    actual: !!before && typeof before.totals.users === "number" && typeof before.totals.workspaces === "number" && Array.isArray(before.signInsPerDay) && Array.isArray(before.users),
  });
  const leaked = FORBIDDEN_KEYS.filter((k) => JSON.stringify(before).includes(`"${k}"`));
  t.check("dave: the response contains no financial field", { expected: [], actual: leaked });

  // ---- browsers: Alice, Bob and Carol sign in (each app boot calls GET /api/me, the usage touch).
  const b = await h.browsers(["alice", "bob", "carol", "dave"], { prefix: "analytics-" });
  for (const user of ["alice", "bob", "carol"]) await b[user].open("dashboard");

  // Dave has no workspace (a site administrator by configuration, not membership), so he lands on
  // the onboarding screen and the section nav is never populated (UX-011) — the same reason "My
  // settings" lives in the account menu rather than only the section nav, and now "Usage" does too.
  await b.dave.open("dashboard");
  t.check("dave: a 'Usage' entry pointing at #/analytics exists in the DOM (account menu or nav)", {
    expected: true, actual: await b.dave.exists('a[href="#/analytics"]'),
  });
  await b.dave.goto("analytics");
  await b.dave.waitForText("Site usage");
  await b.dave.waitForText("Total users");

  const after = await h.api("dave").ok("analytics");
  for (const user of ["alice", "bob", "carol", "dave"]) {
    const subject = `google:dev-${user}`;
    t.check(`${user}: appears in the Usage people list after signing in`, { expected: true, actual: after.users.some((u) => u.subject === subject) });
  }
  t.check("total users never goes down between the control read and now", { expected: true, actual: after.totals.users >= before.totals.users });
  t.check("at least one workspace is counted, by kind and status only (never a name)", {
    expected: true, actual: Object.values(after.workspacesByKindStatus || {}).reduce((s, n) => s + n, 0) >= 1,
  });

  // The page's own figure agrees with the API it was built from (not a stale or invented number).
  const totalCard = await b.dave.evaluate(
    "(() => { const h = [...document.querySelectorAll('.field__label')].find(x => x.textContent === 'Total users'); return h ? h.nextElementSibling.textContent : null; })()",
  );
  t.check("dave: the page's Total users figure matches the API", { expected: String(after.totals.users), actual: totalCard });
  await b.dave.shot("usage");

  // ---- Alice: no nav entry anywhere in the DOM, and the page itself shows nothing either. ---------
  await b.alice.goto("dashboard");
  t.check("alice: no 'Usage' entry anywhere in her DOM", { expected: false, actual: await b.alice.exists('a[href="#/analytics"]') });
  await b.alice.goto("analytics");
  const aliceUsageText = await b.alice.text();
  t.check("alice: opening #/analytics directly shows no usage data, only the refusal sentence", {
    expected: { hasData: false, hasRefusal: true },
    actual: { hasData: /Total users/.test(aliceUsageText), hasRefusal: /only shown to site administrators/.test(aliceUsageText) },
  });
  await b.alice.shot("usage-refused");

  for (const user of ["alice", "bob", "carol", "dave"]) {
    t.check(`${user}: no exceptions, console errors or failed requests in the browser`, { expected: [], actual: b[user].problems() });
  }
}
