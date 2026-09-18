// Account requests (BT-014-17, Terry 2026-09-17: "a feature that the site admin can turn off or on
// that enables a request account feature that the site admin approves"). Real browser: Dave (site
// admin) turns the feature on from the new "Account requests" Site Settings sub-tab; Frank, signing
// in for the first time in this fresh run, sees ONLY the waiting screen — no nav, no onboarding,
// cannot create a workspace; Dave's queue shows his real email/name and approves him; he is then let
// straight through to ordinary onboarding. Grace is used for the reject path.
//
// Frank and Grace exist specifically for this scenario (scripts/dev/server.mjs, BT-014-17): alice,
// bob, carol, dave and eve all already have a user document by the time a scenario's own code runs —
// the harness's own dev-server readiness probe signs in as eve to check the server is up
// (scripts/dev/harness/devserver.mjs), and the fictional seed invites bob and carol into alice's
// household (scripts/dev/seed.mjs) — found by direct diagnosis (a raw GET /api/me for eve, before
// her browser ever opened, already showed pendingApproval: false). A "brand-new signup" test needs
// an identity untouched by either.
export const name = "accountrequests";
export const title = "BT-014-17: account requests toggle, the waiting screen, the approval queue, approve and reject";
export const needsBrowser = true;

export async function run(h, t) {
  // ---- API: off by default; only a site administrator may see or change it ----------------------
  const before = await h.api("dave").ok("site-settings");
  t.check("account requests are off by default", { expected: false, actual: !!before.settings.accountRequestsEnabled });
  const asAlice = await h.api("alice").request("site-settings", { method: "PUT", body: { accountRequestsEnabled: true } });
  t.check("alice (not a site admin): cannot change site settings", { expected: 403, actual: asAlice.status });
  const asAliceQueue = await h.api("alice").request("analytics", { query: { action: "pending-users" } });
  t.check("alice (not a site admin): cannot see the approval queue", { expected: 403, actual: asAliceQueue.status });

  // Dave alone, first: opening a browser for frank/grace at all performs their own sign-in (the
  // harness's own doc: "each with its own profile, debugging port and sign-in"), which would create
  // their user document — as 'approved', since the toggle is still off — before the scenario ever
  // gets to test them as brand-new pending signups. Their browsers are opened only AFTER the toggle
  // is confirmed on.
  const bDave = await h.browsers(["dave"], { prefix: "acctreq-" });

  // ---- Dave turns the feature on from the UI, not the API, to prove the real control works -------
  await bDave.dave.open("dashboard");
  await bDave.dave.click({ role: "button", text: "DS" }); // account menu trigger (initials)
  await bDave.dave.click({ role: "link", name: "Account requests" });
  await bDave.dave.waitForText("Turn account requests on or off", { scope: "main" });
  const checkbox = await bDave.dave.evaluate("document.getElementById('account-requests-toggle').checked");
  t.check("the toggle starts off", { expected: false, actual: checkbox });
  await bDave.dave.click({ role: "checkbox", name: "Require site-administrator approval for new accounts" });
  await bDave.dave.waitForText("new accounts now wait for approval", { scope: "main" });
  const afterToggle = await h.api("dave").ok("site-settings");
  t.check("the toggle really changed the site setting", { expected: true, actual: !!afterToggle.settings.accountRequestsEnabled });

  const b = { ...bDave, ...(await h.browsers(["frank", "grace"], { prefix: "acctreq-" })) };

  // ---- Frank signs in for the first time in this fresh run: only the waiting screen --------------
  await b.frank.open("dashboard");
  await b.frank.waitForText("Waiting for approval");
  const frankText = await b.frank.text();
  const frankNoNav = await b.frank.evaluate("!document.querySelector('.app__nav')");
  t.check("frank sees the waiting screen, no nav, no onboarding", {
    expected: { waiting: true, noNav: true, noCreate: true },
    actual: { waiting: /needs to approve your account/.test(frankText), noNav: frankNoNav, noCreate: !/Create your first workspace/.test(frankText) },
  });
  const frankCreate = await h.api("frank").request("workspaces", { method: "POST", body: { name: "Frank Household", kind: "personal" } });
  t.check("frank cannot create a workspace via the API either", { expected: 403, actual: frankCreate.status });
  await b.frank.shot("waiting-for-approval");

  // ---- Dave's queue shows frank's real email/name and approves him --------------------------------
  // Dave never left this page since flipping the toggle, and (like every other site-admin page,
  // adminworkspaces.js/analytics.js/gallery.js) it loads its data once per view mount, not on every
  // store update — so a real admin would need to revisit the page to see a request that arrived
  // while it was already open, exactly what this does.
  await b.dave.goto("dashboard");
  await b.dave.goto("account-requests");
  await b.dave.waitForText("frank@example.com", { scope: "main" });
  const queueText = await b.dave.text("main");
  t.check("the queue shows frank's real name too", { expected: true, actual: /Frank Newcomer/.test(queueText) });
  await b.dave.shot("approval-queue");
  await b.dave.click({ role: "button", name: "Approve frank@example.com" });
  await b.dave.waitForText("Nobody is waiting for approval", { scope: "main" });

  // ---- Frank is now let through to ordinary onboarding ---------------------------------------------
  await b.frank.reload();
  await b.frank.waitForText("Create your first workspace");
  t.check("frank no longer sees the waiting screen", { expected: false, actual: (await b.frank.text()).includes("needs to approve your account") });
  const frankCreateNow = await h.api("frank").request("workspaces", { method: "POST", body: { name: "Frank Household", kind: "personal" } });
  t.check("frank can now create a workspace", { expected: 201, actual: frankCreateNow.status });

  // ---- Reject: grace stays blocked, with a distinct message ----------------------------------------
  await b.grace.open("dashboard");
  await b.dave.goto("dashboard");
  await b.dave.goto("account-requests");
  await b.dave.waitForText("grace@example.com", { scope: "main" });
  await b.dave.click({ role: "button", name: "Reject grace@example.com" });
  await b.dave.waitForText("Nobody is waiting for approval", { scope: "main" });
  await b.grace.reload();
  await b.grace.waitForText("Account request not approved");
  t.check("grace sees the rejected message, distinct from 'waiting'", { expected: true, actual: !(await b.grace.text()).includes("Waiting for approval") });
  await b.grace.shot("rejected");

  for (const s of Object.values(b)) { await s.settle(); t.check(`${s.name}: no exceptions, console errors or failed requests in the browser`, { expected: [], actual: s.problems({ allowHttp: [{ status: 403, path: /\/api\/(workspaces|site-settings|analytics)/ }] }) }); }
}
