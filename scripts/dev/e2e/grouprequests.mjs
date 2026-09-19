// BT-009-26, in a real browser: in-app payment reminders/requests — sending one, an honest in-app-
// only disclosure, the person being reminded marking it as seen, its sender cancelling another one,
// and proof that none of this moves money or changes a balance.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "grouprequests";
export const title = "BT-009-26: in-app payment reminders/requests in Shared expenses, in a real browser";
export const needsBrowser = true;

const REMINDERS = '[aria-labelledby="grp-reminders"]';

export async function run(h, t) {
  const api = (u) => h.api(u);
  const W = await createWorkspace(h, { name: "E2E Reminders Trip", kind: "group", members: { bob: "member" } });
  const { alice, bob } = await h.browsers(["alice", "bob"], { prefix: "grouprequests-" });
  await alice.open("group");
  await alice.useWorkspace(W.name);
  await alice.goto("group");
  if (!(await alice.exists(REMINDERS))) { t.skip("payment reminders in the browser", "the Payment reminders card is not present at this commit"); return; }

  const remindersText = await alice.text(REMINDERS);
  t.check("the card states plainly this is in-app only and never moves money", {
    expected: true,
    actual: remindersText.includes("This is not an email, text or push notification") && remindersText.includes("never moves money or changes a balance"),
  });

  const refs = await api("alice").ok("members", { query: W.q });
  const bobRef = `member:${refs.members.find((m) => m.name.startsWith("Bob")).id}`;
  const netBefore = 0; // nothing recorded yet in this fresh workspace

  // ---- 1. Alice sends Bob a reminder for money she is owed ------------------------------------------
  await alice.click({ role: "button", name: "Send a reminder…", scope: REMINDERS });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Send a payment reminder dialog" });
  await alice.fill({ label: "Amount", scope: ".modal" }, "20.00");
  await alice.fill({ label: "Note (optional)", scope: ".modal" }, "E2E fictional dinner split");
  await alice.shot("1-send-reminder-dialog");
  await alice.click({ role: "button", name: "Send reminder", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after sending" });
  await alice.waitForText("You asked Bob", { scope: REMINDERS });

  // Nothing was actually sent outside the app, and no balance moved — checked directly against the API.
  const created = (await api("alice").ok("group", { query: { ...W.q, action: "payment-requests" } })).paymentRequests[0];
  t.check("the reminder is recorded as a plain in-app record, open, naming the real people", {
    expected: { from: bobRef, status: "open", amount: "20.00" }, actual: { from: created.from, status: created.status, amount: created.amount },
  });
  const balancesAfterSend = (await api("alice").ok("group", { query: { ...W.q, action: "balances" } })).balances[0];
  t.check("sending a reminder alone changes no balance", { expected: true, actual: balancesAfterSend.rows.every((r) => r.netMinor === 0) });

  // ---- 2. Bob, the one being reminded, sees it and marks it as seen ---------------------------------
  await bob.open("group");
  await bob.useWorkspace(W.name);
  await bob.goto("group");
  await bob.waitForText("asked You to pay", { scope: REMINDERS });
  const bobText = await bob.text(REMINDERS);
  t.check("Bob sees the real note, not a generic message", { expected: true, actual: bobText.includes("E2E fictional dinner split") });
  await bob.click({ role: "button", name: "Mark reminder to pay EUR 20.00 as seen", scope: REMINDERS });
  await bob.waitForText("Seen", { scope: REMINDERS });

  const afterDismiss = (await api("alice").ok("group", { query: { ...W.q, action: "payment-requests" } })).paymentRequests[0];
  t.check("marking as seen never means paid — it is just a status, and still no balance change", { expected: "dismissed", actual: afterDismiss.status });

  // ---- 3. Alice sends a second reminder, then cancels it herself ------------------------------------
  await alice.click({ role: "button", name: "Send a reminder…", scope: REMINDERS });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Send a payment reminder dialog" });
  await alice.fill({ label: "Amount", scope: ".modal" }, "5.00");
  await alice.click({ role: "button", name: "Send reminder", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after sending" });
  await alice.waitForText("5.00", { scope: REMINDERS });
  await alice.click({ role: "button", name: /^Cancel the reminder to Bob/, scope: REMINDERS });
  await alice.waitForText("Cancelled", { scope: REMINDERS });

  const list = (await api("alice").ok("group", { query: { ...W.q, action: "payment-requests" } })).paymentRequests;
  t.check("both reminders are kept for history, one dismissed and one cancelled — nothing deleted", {
    expected: ["dismissed", "cancelled"].sort(), actual: list.map((r) => r.status).sort(),
  });

  const balancesAfter = (await api("alice").ok("group", { query: { ...W.q, action: "balances" } })).balances[0];
  t.check("no reminder, however resolved, ever changed a balance", { expected: true, actual: balancesAfter.rows.every((r) => r.netMinor === netBefore) });

  await alice.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: alice.problems() });
  await bob.settle();
  t.check("bob: no exceptions, console errors or failed requests in the browser", { expected: [], actual: bob.problems() });
}
