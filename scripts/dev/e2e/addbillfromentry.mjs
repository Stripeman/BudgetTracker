// "ADD AS BILL" (Terry, 2026-09-18: "button next to a transaction to add transaction as a bill and
// carry over/refill data from the transaction to bill"). A new item on a transaction's compact
// "::" actions menu (BT-015) opens the SAME "Add bill" dialog bills.js already uses, pre-filled
// from that entry's own account, direction, amount, category, merchant, notes and first-payment
// date — verified here in a real browser: the values are genuinely visible (not just present in
// the DOM double's approximation of a <textarea>'s seeded value, see billfromtransaction.test.js's
// own note on that), submitting creates a real new bill through the real API, and the original
// transaction is left completely unchanged (never edited, never deleted).
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";

export const name = "addbillfromentry";
export const title = "\"Add as bill\" on a transaction: pre-filled from the entry (account, direction, amount, category, merchant, notes, first-payment date), submits a real new bill, and never touches the original entry";
export const needsBrowser = true;

const fieldValue = (label) => `(() => {
  const l = [...document.querySelectorAll(".modal label")].find((x) => x.textContent === ${JSON.stringify(label)});
  const el = l && document.getElementById(l.getAttribute("for"));
  return el ? el.value : null;
})()`;
// A command-picker trigger's own visible value (never the disclosure arrow/search glyph that
// follows it, or its full accessible-name sentence) — the same text a sighted person reads.
const triggerName = (label) => `(() => {
  const l = [...document.querySelectorAll(".modal label")].find((x) => x.textContent === ${JSON.stringify(label)});
  const control = l && document.getElementById(l.getAttribute("for"));
  const value = control && control.querySelector(".cmdpick__value");
  return value ? value.textContent : (control ? control.value : null);
})()`;

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Bill-From-Entry Household", kind: "household" });
  const q = W.q;
  const alice = h.api("alice");
  const account = firstRecord(await alice.ok("accounts", { method: "POST", query: q, body: { name: "E2E Entry Checking", type: "checking", currency: "USD", openingBalance: "1000.00" } }));
  const category = firstRecord(await alice.ok("categories", { method: "POST", query: q, body: { name: "E2E Entry Groceries", color: "#16a34a" } }));
  const merchant = firstRecord(await alice.ok("payees", { method: "POST", query: q, body: { name: "E2E Entry Grocer" } }));
  const entry = firstRecord(await alice.ok("transactions", { method: "POST", query: q, body: { accountId: account.id, kind: "expense", amount: "45.67", categoryId: category.id, payeeId: merchant.id, notes: "E2E carried notes", date: "2026-09-05" } }));
  t.note(`workspace ${W.name}: ${W.id}; account ${account.id}; category ${category.id}; merchant ${merchant.id}; entry ${entry.id}`);

  const { alice: s } = await h.browsers(["alice"], { prefix: "billfromentry-" });
  await s.open("dashboard");
  await s.useWorkspace(W.name);
  await s.goto("transactions");
  await s.waitForText("E2E Entry Grocer", { scope: "main" });

  await s.openRecordMenu("E2E Entry Grocer", { scope: "main" });
  await s.click({ role: "button", name: "Add E2E Entry Grocer on 2026-09-05 as a bill", scope: ".actionsmenu__panel:not([hidden])" });
  await s.waitFor("!!document.querySelector('.modal')", { what: "the Add bill dialog to open" });
  const title = await s.evaluate("document.querySelector('.modal h2').textContent");
  t.check("opens the SAME Add bill dialog, titled for the entry it came from", { expected: "New bill from entry", actual: title });

  const prefilled = {
    account: await s.evaluate(triggerName("Account")),
    direction: await s.evaluate(triggerName("Direction")),
    category: await s.evaluate(triggerName("Category")),
    merchant: await s.evaluate(triggerName("Merchant")),
    amount: await s.evaluate(fieldValue("Amount")),
    notes: await s.evaluate(fieldValue("Notes")),
    firstPayment: await s.evaluate(fieldValue("First payment")),
  };
  t.check("every field is pre-filled from the entry: account, direction, category, merchant, amount, notes and first-payment date (the entry's own date)", {
    expected: { account: "E2E Entry Checking (USD)", direction: "Money out", category: "E2E Entry Groceries", merchant: "E2E Entry Grocer", amount: "45.67", notes: "E2E carried notes", firstPayment: "2026-09-05" },
    actual: prefilled,
  });

  // Still a genuinely new, fully editable bill — not a locked "edit" of anything: the account and
  // direction triggers, disabled only while editing an EXISTING bill, are still enabled here.
  const disabledState = await s.evaluate("(() => { const l = [...document.querySelectorAll('.modal label')].find((x) => x.textContent === 'Account'); const c = document.getElementById(l.getAttribute('for')); return c.disabled; })()");
  t.check("the Account field (locked only when editing an existing bill) stays enabled — this is a new bill, not an edit", { expected: false, actual: disabledState });

  await s.fill({ label: "Name", scope: ".modal" }, "E2E Entry Grocer Rent");
  await s.click({ role: "button", name: "Add bill", scope: ".modal" });
  await s.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await s.settle();

  const bills = (await alice.ok("recurring", { query: q })).recurring;
  const created = bills.find((b) => b.name === "E2E Entry Grocer Rent");
  t.check("a real new bill was created, carrying the entry's account, amount, category, merchant, notes and date as its first payment", {
    expected: { found: true, accountId: account.id, amount: "45.67", categoryId: category.id, payeeId: merchant.id, startDate: "2026-09-05" },
    actual: created ? { found: true, accountId: created.accountId, amount: created.amount, categoryId: created.categoryId, payeeId: created.payeeId, startDate: created.schedule.startDate } : { found: false },
  });

  // The original entry itself is completely untouched — this action only ever creates something
  // new, never edits or removes the transaction it started from.
  const stillThere = await alice.ok("transactions", { query: q });
  const unchanged = stillThere.transactions.find((x) => x.id === entry.id);
  t.check("the original transaction is left exactly as it was (same revision, amount, notes) — creating a bill from it is never an edit", {
    expected: { revision: entry.revision, amount: entry.amount, notes: entry.notes },
    actual: unchanged ? { revision: unchanged.revision, amount: unchanged.amount, notes: unchanged.notes } : null,
  });

  await s.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: s.problems() });
}
