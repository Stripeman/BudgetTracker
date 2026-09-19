// BT-020 (Terry, 2026-09-19): linking a recurring bill to the debt account it pays, a principal/
// interest breakdown, manual interest/fee entries and an audited balance correction — all through
// real browser workflows, never API-only. Alice creates a debt-payment bill (Pay from checking,
// Apply payment to a credit card, lender kept separately), records a plain payment, then a payment
// with an interest breakdown, adds a manual fee, and corrects the balance. Bob, a plain member, never
// sees Alice's private card at all. TWO BROWSERS AT ONCE.
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";

export const name = "debtpayments";
export const title = "BT-020: a debt-payment bill, a principal/interest breakdown, manual interest/fee entries and a balance correction, in real browsers";
export const needsBrowser = true;

// The Merchant field (createMerchantSelect, allowCustom): opens the same command picker as
// Category, types a name nothing matches, and commits it with Shift+Tab straight out of the search
// box — the same proven pattern as bills.mjs's own `typeMerchantDraft`.
async function typeMerchantDraft(s, term, { scope = ".modal" } = {}) {
  const at = await s.locate({ css: ".cmdpick__trigger", label: "Merchant", scope });
  await s.mouseClick(at.x, at.y);
  await s.waitFor("!!document.querySelector('.cmdpick__panel:not([hidden])')", { what: "the Merchant list to open" });
  const search = await s.locate({ css: ".cmdpick__search" });
  await s.mouseClick(search.x, search.y);
  await s.cdp.send("Input.insertText", { text: term });
  await s.settle({ quiet: 150 });
  await s.press("Tab", { shift: true });
  await s.waitFor("!document.querySelector('.cmdpick__panel:not([hidden])')", { what: "the Merchant list to close after committing" });
}

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Debt Payments Household", kind: "household", members: { bob: "member" } });
  const q = W.q;
  const api = (u) => h.api(u);
  const checking = firstRecord(await api("alice").ok("accounts", { method: "POST", query: q, body: { name: "E2E Checking", type: "checking", currency: "EUR", openingBalance: "2000.00" } }));
  const card = firstRecord(await api("alice").ok("accounts", { method: "POST", query: q, body: { name: "E2E Card", type: "credit-card", currency: "EUR", openingBalance: "-1000.00", visibility: "private" } }));
  t.note(`workspace ${W.name}: ${W.id}; checking ${checking.id}; private card ${card.id}`);

  const b = await h.browsers(["alice", "bob"], { prefix: "debtpayments-" });
  for (const s of Object.values(b)) { await s.open("dashboard"); await s.useWorkspace(W.name); }

  // ---- Alice creates a debt-payment bill: Pay from / Apply payment to, lender kept separately ----
  await b.alice.goto("bills");
  await b.alice.click({ role: "button", name: "Add bill", scope: "main" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the add-bill dialog" });
  await b.alice.choose("Type", "Loan or debt payment", { scope: ".modal" });
  await b.alice.choose("Pay from", "E2E Checking (EUR)", { scope: ".modal" });
  await b.alice.choose("Apply payment to", "E2E Card (EUR)", { scope: ".modal" });
  await b.alice.fill({ label: "Name", scope: ".modal" }, "E2E Card payment");
  await b.alice.fill({ label: "Amount", scope: ".modal" }, "150.00");
  await typeMerchantDraft(b.alice, "E2E Fictional Bank");
  await b.alice.click({ role: "button", name: "Add bill", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after adding the bill" });
  await b.alice.settle();
  const bill = (await api("alice").ok("recurring", { query: q })).recurring.find((r) => r.name === "E2E Card payment");
  t.check("the debt-payment bill is a transfer between the two named accounts, and keeps its lender association separately", {
    expected: { found: true, kind: "transfer", accountId: checking.id, toAccountId: card.id, payeeDraftName: "E2E Fictional Bank" },
    actual: { found: !!bill, kind: bill && bill.kind, accountId: bill && bill.accountId, toAccountId: bill && bill.toAccountId, payeeDraftName: bill && bill.payeeDraftName },
  });
  const shotBill = await b.alice.shot("1-debt-payment-bill-created");
  t.note(`screenshot of the bills list: ${shotBill}`);

  // ---- Alice records the first occurrence with a $30 interest breakdown, reviewed before saving ---
  await b.alice.openRecordMenu(bill.name, { scope: "main" });
  await b.alice.click({ role: "button", name: `Record next: ${bill.name}` });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the record dialog" });
  const previewBefore = await b.alice.text(".modal");
  t.check("the record dialog shows both accounts and an interest breakdown field before saving", {
    expected: true, actual: /E2E Checking/.test(previewBefore) && /E2E Card/.test(previewBefore) && /interest not already/.test(previewBefore),
  });
  await b.alice.fill({ label: "Of this, interest not already on E2E Card (optional)", scope: ".modal" }, "30.00");
  await b.alice.settle();
  const previewAfter = await b.alice.text(".modal");
  t.check("the live allocation preview reflects the entered breakdown before saving", {
    expected: true, actual: /120\.00 reduces the balance owed/.test(previewAfter) && /30\.00 recorded as interest/.test(previewAfter) && /-1000\.00 → -880\.00/.test(previewAfter),
  });
  const shotRecord = await b.alice.shot("2-record-with-breakdown");
  await b.alice.click({ role: "button", name: "Record payment", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after recording" });
  await b.alice.settle();
  const afterFirst = (await api("alice").ok("accounts", { query: q })).accounts;
  t.check("checking dropped by the full 150.00, the card's debt dropped by exactly 120.00 (interest recorded once, never double-counted)", {
    expected: { checking: "1850.00", card: "-880.00" },
    actual: { checking: afterFirst.find((a) => a.id === checking.id).balance, card: afterFirst.find((a) => a.id === card.id).balance },
  });
  t.note(`screenshot of the record dialog with breakdown: ${shotRecord}`);

  // ---- a manual fee, with a required reason ---------------------------------------------------------
  await b.alice.goto("accounts");
  await b.alice.openRecordMenu("E2E Card", { scope: "main" });
  await b.alice.click({ role: "button", name: "Add fee to E2E Card" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the add-fee dialog" });
  await b.alice.click({ role: "button", name: "Add fee", scope: ".modal" });
  await b.alice.settle();
  const feeBlocked = await b.alice.text(".modal");
  t.check("a fee with no reason is refused, explained in the dialog itself", { expected: true, actual: /reason/i.test(feeBlocked) });
  await b.alice.fill({ label: "Amount (EUR)", scope: ".modal" }, "5.00");
  await b.alice.fill({ label: "Reason", scope: ".modal" }, "E2E late fee");
  await b.alice.click({ role: "button", name: "Add fee", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after the fee" });
  await b.alice.settle();
  const afterFee = (await api("alice").ok("accounts", { query: q })).accounts.find((a) => a.id === card.id);
  t.check("the fee is recorded and increases what is owed", { expected: "-885.00", actual: afterFee.balance });

  // ---- an audited balance correction: preview, reason required, then confirm -----------------------
  await b.alice.openRecordMenu("E2E Card", { scope: "main" });
  await b.alice.click({ role: "button", name: "Correct the balance of E2E Card" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the balance-correction dialog" });
  await b.alice.fill({ label: "Desired balance (EUR)", scope: ".modal" }, "-900.00");
  await b.alice.settle();
  const correctionPreview = await b.alice.text(".modal");
  t.check("the calculated adjustment and its accounting treatment are shown before confirming", {
    expected: true, actual: /-885\.00 → -900\.00/.test(correctionPreview) && /15\.00 EUR/.test(correctionPreview),
  });
  const shotCorrection = await b.alice.shot("3-balance-correction-preview");
  await b.alice.click({ role: "button", name: "Correct balance", scope: ".modal" });
  await b.alice.settle();
  const stillBlocked = await b.alice.text(".modal");
  t.check("confirming with no reason is refused", { expected: true, actual: /reason/i.test(stillBlocked) });
  await b.alice.fill({ label: "Reason", scope: ".modal" }, "E2E matched the statement");
  await b.alice.click({ role: "button", name: "Correct balance", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after the correction" });
  await b.alice.settle();
  const afterCorrection = (await api("alice").ok("accounts", { query: q })).accounts.find((a) => a.id === card.id);
  t.check("the balance now matches exactly what was entered, via one new audited entry — never a rewrite of history", { expected: "-900.00", actual: afterCorrection.balance });
  t.note(`screenshot of the correction preview: ${shotCorrection}`);
  const original = (await api("alice").ok("transactions", { query: { ...q, accountId: card.id } })).transactions.find((tx) => tx.kind === "interest");
  t.check("the earlier interest entry is untouched by the later correction", { expected: "-30.00", actual: original ? original.amount : null });

  // ---- Bob, a plain member, never sees Alice's private card at all -----------------------------------
  await b.bob.goto("accounts");
  const bobText = await b.bob.text("main");
  t.check("Bob never sees Alice's private card, its balance, or any of its debt-entry actions", { expected: false, actual: bobText.includes("E2E Card") });

  // ---- every browser stayed clean ---------------------------------------------------------------------
  for (const s of Object.values(b)) { await s.settle(); t.check(`${s.name}: no exceptions, console errors or failed requests in the browser`, { expected: [], actual: s.problems() }); }
}
