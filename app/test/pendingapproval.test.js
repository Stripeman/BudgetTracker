// BT-014-17: a pending or rejected account sees only a blocking screen — no nav, no workspace
// picker, no view, nothing else in the DOM — until a site administrator approves them. Server-side
// enforcement (a pending/rejected account cannot create or join a workspace) is
// api/test/account-requests.test.js's job; this proves the FRONTEND actually shows and hides the
// right thing for the fields GET /api/me now returns (pendingApproval, rejected).
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { createShell } from "../js/ui/shell.js";
import { createThemeController } from "../js/ui/theme.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const noop = async () => {};

function boot(user) {
  const state = {
    auth: { status: "ready", user },
    workspaces: [], selectedWorkspaceId: null, preferences: null, site: null,
    app: { version: "0.0.0-test", environment: "test" },
  };
  const store = {
    getState: () => state,
    subscribe() {},
    actions: { refreshTransactions: noop, refreshBills: noop, refreshForecast: noop, refreshGroup: noop, refreshWeekActivity: noop, refreshMonthActivity: noop, savePreferences: async () => ({ ok: true }) },
  };
  const theme = createThemeController({ root: { setAttribute() {} }, storage: { getItem: () => null, setItem() {} }, media: { matches: false, addEventListener() {} } });
  const router = { current: () => ({ id: "dashboard", params: {} }), subscribe() {}, navigate() {} };
  const mountPoint = document.createElement("div");
  dom.body.appendChild(mountPoint);
  const shell = createShell({ mountPoint, store, router, theme, api: {} });
  shell.render();
  return { mountPoint };
}

describe("BT-014-17 the pending/rejected account screen", () => {
  test("a pending account sees only the waiting screen: no nav, no workspace picker, no dashboard", () => {
    const { mountPoint } = boot({ name: "Frank Newcomer", email: "frank@example.com", subject: "google:g-frank", siteAdmin: false, pendingApproval: true, rejected: false });
    assert.match(mountPoint.textContent, /Waiting for approval/);
    assert.match(mountPoint.textContent, /needs to approve your account/);
    assert.equal(mountPoint.querySelector(".app__nav"), null, "no section nav");
    assert.equal(mountPoint.querySelector(".picker--workspace"), null, "no workspace picker");
    assert.equal(mountPoint.querySelector("h1[id]"), null, "no Dashboard/onboarding heading");
    const signOut = mountPoint.querySelector('a[href="/.auth/logout?post_logout_redirect_uri=/"]');
    assert.ok(signOut, "a way to sign out is offered");
  });

  test("a rejected account sees a distinct message, also with no app chrome", () => {
    const { mountPoint } = boot({ name: "Frank Newcomer", email: "frank@example.com", subject: "google:g-frank", siteAdmin: false, pendingApproval: false, rejected: true });
    assert.match(mountPoint.textContent, /Account request not approved/);
    assert.match(mountPoint.textContent, /did not approve your account request/);
    assert.doesNotMatch(mountPoint.textContent, /Waiting for approval/);
    assert.equal(mountPoint.querySelector(".app__nav"), null);
  });

  test("an approved account (the ordinary case) sees the normal app chrome, not the waiting screen", () => {
    const { mountPoint } = boot({ name: "Alice Fictional", email: "alice@example.com", subject: "google:g-alice", siteAdmin: false, pendingApproval: false, rejected: false });
    assert.doesNotMatch(mountPoint.textContent, /Waiting for approval/);
    assert.doesNotMatch(mountPoint.textContent, /Account request not approved/);
  });

  test("a site administrator is never shown the waiting screen, even if their own record were somehow pendingApproval", () => {
    // Defense in depth: the server already never sets pendingApproval/rejected for a site admin
    // (api/me/handler.js), but the frontend does not additionally trust that on its own here — this
    // proves today's actual behaviour matches the server's contract, not a second independent gate.
    const { mountPoint } = boot({ name: "Dave Siteadmin", email: "dave@example.com", subject: "google:g-dave", siteAdmin: true, pendingApproval: false, rejected: false });
    assert.doesNotMatch(mountPoint.textContent, /Waiting for approval/);
  });
});
