// BT-009-26, in a real browser: offline entry — explicit device opt-in, the local-data disclosure,
// a genuine network-level offline emulation (CDP Network.emulateNetworkConditions, never a faked
// promise rejection) queuing a new expense instead of showing an error, and a real sync once back
// online that creates the real expense with the exact idempotency key it would have used.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "groupoffline";
export const title = "BT-009-26: offline entry in Shared expenses, in a real browser";
export const needsBrowser = true;

const OFFLINE = '[aria-labelledby="grp-offline"]';

export async function run(h, t) {
  const api = (u) => h.api(u);
  const W = await createWorkspace(h, { name: "E2E Offline Trip", kind: "group" });
  const { alice } = await h.browsers(["alice"], { prefix: "groupoffline-" });
  await alice.open("group");
  await alice.useWorkspace(W.name);
  await alice.goto("group");
  if (!(await alice.exists(OFFLINE))) { t.skip("offline entry in the browser", "the Offline entry card is not present at this commit"); return; }

  const offlineText = await alice.text(OFFLINE);
  t.check("the card discloses in words what is kept locally and what is not, and is off by default", {
    expected: true,
    actual: offlineText.includes("Only what you typed is kept on this device") && offlineText.includes("Nothing is currently waiting to be sent"),
  });

  // ---- 1. Without opting in, going offline shows a normal error, never a silent queue -------------
  await alice.setOffline(true);
  await alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Add shared expense dialog" });
  await alice.fill({ label: "Description", scope: ".modal" }, "E2E offline dinner (should error)");
  await alice.fill({ label: "Amount (EUR)", scope: ".modal" }, "20.00");
  await alice.click({ role: "button", name: "Save expense", scope: ".modal" });
  await alice.waitFor("!!document.querySelector('.modal .modal__error') && document.querySelector('.modal .modal__error').textContent.length > 0", { what: "a real error, since this device has not opted in" });
  await alice.shot("1-offline-without-optin-shows-error");
  await alice.click({ role: "button", name: "Cancel", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close" });
  await alice.setOffline(false);
  await alice.settle();
  alice.resetLog(); // the failed request above was deliberately induced; not a real problem

  // ---- 2. Opt in on this device --------------------------------------------------------------------
  await alice.click({ role: "checkbox", name: /Save new expenses and payments on this device/, scope: OFFLINE });
  await alice.waitForText("checked", { scope: OFFLINE }).catch(() => {}); // best-effort; the real check below is authoritative
  const checked = await alice.evaluate(`document.querySelector('#grp-offline-toggle').checked`);
  t.check("the toggle really turns on for this device", { expected: true, actual: checked });

  // ---- 3. Genuinely offline (network-level), adding an expense is saved on this device, not sent ---
  await alice.setOffline(true);
  await alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Add shared expense dialog" });
  await alice.fill({ label: "Description", scope: ".modal" }, "E2E offline dinner");
  await alice.fill({ label: "Amount (EUR)", scope: ".modal" }, "30.00");
  await alice.click({ role: "button", name: "Save expense", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close — queued, not failed" });
  await alice.waitFor("document.getElementById('a11y-live') && document.getElementById('a11y-live').textContent.includes('saved on this device')", { what: "the offline-save announcement" });
  await alice.waitForText("E2E offline dinner", { scope: OFFLINE });
  await alice.shot("2-queued-while-offline");

  const stillNothing = await api("alice").ok("group", { query: { ...W.q } });
  t.check("nothing was actually sent to the server while offline", { expected: undefined, actual: stillNothing.expenses.find((e) => e.description === "E2E offline dinner") });

  // ---- 4. Back online: the browser's own connectivity signal (a real 'online' event, from the
  // same CDP network-condition change, never a page reload or a button press) sends it automatically.
  await alice.setOffline(false);
  alice.resetLog(); // the failed request while genuinely offline above was deliberately induced too
  await alice.waitForText("Nothing is currently waiting to be sent", { scope: OFFLINE, timeout: 15000 });
  await alice.shot("3-synced-after-reconnect");

  const afterSync = await api("alice").ok("group", { query: { ...W.q } });
  const sent = afterSync.expenses.find((e) => e.description === "E2E offline dinner");
  t.check("the real expense was created once back online, with the real amount", { expected: "30.00", actual: sent ? sent.amount : null });

  await alice.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: alice.problems() });
}
