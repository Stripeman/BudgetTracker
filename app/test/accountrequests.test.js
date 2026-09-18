// BT-014-17: the site-admin "Account requests" page — the on/off toggle and the approval queue.
// Site-admin only, fetches nothing for anyone else. Real email/name IS shown here, deliberately
// (unlike the Workspaces directory) — an approval queue is meaningless without knowing who is asking.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { installDom } from "./domdouble.js";
import { createView } from "../js/ui/views/accountrequests.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("BT-014-17 the Account requests view", () => {
  test("a non-admin sees nothing and nothing is fetched", async () => {
    let calls = 0;
    const view = createView({ api: { siteSettings: async () => { calls += 1; return { settings: {} }; }, pendingAccounts: async () => { calls += 1; return { pending: [] }; } } });
    dom.body.appendChild(view.element);
    view.update({ auth: { user: { siteAdmin: false } } });
    await tick();
    assert.equal(calls, 0);
    const notAdmin = view.element.querySelector("p.muted");
    assert.equal(notAdmin.hidden, false);
    assert.equal(view.element.querySelector(".stack").hidden, true);
  });

  test("a site administrator sees the current toggle state and the queue, with real email/name", async () => {
    const view = createView({
      api: {
        siteSettings: async () => ({ settings: { accountRequestsEnabled: true } }),
        pendingAccounts: async () => ({ pending: [{ subject: "google:g-frank", email: "frank@example.com", name: "Frank Newcomer", createdAt: "2026-09-17T10:00:00.000Z" }], truncated: false }),
      },
    });
    dom.body.appendChild(view.element);
    view.update({ auth: { user: { siteAdmin: true } } });
    await tick();
    assert.equal(view.element.querySelector(".stack").hidden, false);
    const checkbox = view.element.querySelector('input[type="checkbox"]');
    assert.equal(checkbox.checked, true);
    assert.match(view.element.textContent, /frank@example\.com/);
    assert.match(view.element.textContent, /Frank Newcomer/);
    assert.ok(view.element.querySelector('button[aria-label="Approve frank@example.com"]'));
    assert.ok(view.element.querySelector('button[aria-label="Reject frank@example.com"]'));
  });

  test("with nobody waiting, says so plainly", async () => {
    const view = createView({ api: { siteSettings: async () => ({ settings: { accountRequestsEnabled: false } }), pendingAccounts: async () => ({ pending: [], truncated: false }) } });
    dom.body.appendChild(view.element);
    view.update({ auth: { user: { siteAdmin: true } } });
    await tick();
    assert.match(view.element.textContent, /Nobody is waiting for approval/);
  });

  test("ticking the checkbox saves the toggle immediately", async () => {
    let saved = null;
    const view = createView({
      api: {
        siteSettings: async () => ({ settings: { accountRequestsEnabled: false } }),
        pendingAccounts: async () => ({ pending: [], truncated: false }),
        saveSiteSettings: async (body) => { saved = body; return { settings: { accountRequestsEnabled: true } }; },
      },
    });
    dom.body.appendChild(view.element);
    view.update({ auth: { user: { siteAdmin: true } } });
    await tick();
    const checkbox = view.element.querySelector('input[type="checkbox"]');
    checkbox.checked = true;
    checkbox.dispatchEvent({ type: "change", bubbles: true });
    await tick();
    assert.deepEqual(saved, { accountRequestsEnabled: true });
    assert.match(view.element.textContent, /new accounts now wait for approval/);
  });

  test("a failed save puts the checkbox back and explains why", async () => {
    const view = createView({
      api: {
        siteSettings: async () => ({ settings: { accountRequestsEnabled: false } }),
        pendingAccounts: async () => ({ pending: [], truncated: false }),
        saveSiteSettings: async () => { throw { status: 403, code: "forbidden", message: "Only site administrators can change site settings." }; },
      },
    });
    dom.body.appendChild(view.element);
    view.update({ auth: { user: { siteAdmin: true } } });
    await tick();
    const checkbox = view.element.querySelector('input[type="checkbox"]');
    checkbox.checked = true;
    checkbox.dispatchEvent({ type: "change", bubbles: true });
    await tick();
    assert.equal(checkbox.checked, false, "reverted after the failed save");
    assert.match(view.element.textContent, /Only site administrators can change site settings\./);
  });

  test("Approve calls the API with the right subject and reloads the queue", async () => {
    let approved = null;
    let queueCalls = 0;
    const pendingFirst = [{ subject: "google:g-frank", email: "frank@example.com", name: "Frank Newcomer", createdAt: "2026-09-17T10:00:00.000Z" }];
    const view = createView({
      api: {
        siteSettings: async () => ({ settings: { accountRequestsEnabled: true } }),
        pendingAccounts: async () => { queueCalls += 1; return { pending: queueCalls === 1 ? pendingFirst : [], truncated: false }; },
        approveAccount: async (subject) => { approved = subject; return { subject, approvalStatus: "approved" }; },
      },
    });
    dom.body.appendChild(view.element);
    view.update({ auth: { user: { siteAdmin: true } } });
    await tick();
    view.element.querySelector('button[aria-label="Approve frank@example.com"]').dispatchEvent({ type: "click", bubbles: true });
    await tick();
    assert.equal(approved, "google:g-frank");
    assert.equal(queueCalls, 2, "the queue reloads after approving");
    assert.match(view.element.textContent, /Nobody is waiting for approval/);
  });

  test("Reject calls the API with the right subject", async () => {
    let rejected = null;
    const view = createView({
      api: {
        siteSettings: async () => ({ settings: { accountRequestsEnabled: true } }),
        pendingAccounts: async () => ({ pending: [{ subject: "google:g-frank", email: "frank@example.com", name: "Frank Newcomer", createdAt: "2026-09-17T10:00:00.000Z" }], truncated: false }),
        rejectAccount: async (subject) => { rejected = subject; return { subject, approvalStatus: "rejected" }; },
      },
    });
    dom.body.appendChild(view.element);
    view.update({ auth: { user: { siteAdmin: true } } });
    await tick();
    view.element.querySelector('button[aria-label="Reject frank@example.com"]').dispatchEvent({ type: "click", bubbles: true });
    await tick();
    assert.equal(rejected, "google:g-frank");
  });

  test("no innerHTML, outerHTML or insertAdjacentHTML in the view (also enforced repo-wide by scripts/validate.cjs)", () => {
    const src = readFileSync(fileURLToPath(new URL("../js/ui/views/accountrequests.js", import.meta.url)), "utf8");
    assert.doesNotMatch(src, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML/);
  });
});
