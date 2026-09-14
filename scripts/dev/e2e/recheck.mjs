// BT-009 RECHECK (branch fix/bt009-recheck), THREE BROWSERS AT ONCE: who may confirm a payment (the
// group setting "Anyone in the group can confirm payments" and each person's "Can confirm payments"),
// owed-to-others and repayment entries (the group setting and the quick-entry Type choices), entries
// recorded from Shared expenses locked on the Transactions page, the |==| no-money-moved mark, sharing
// an account that records a group (R1), a create-new restore that carries nobody else's identity (S4),
// and parallel requests against the file-backed dev server. Fictional data only.
//
// Hand-computed expectations (independent of the app's arithmetic):
//   dinner 90.00 paid by Alice, shared by Alice, Bob and Carol: 30.00 each.
//   Bob records his part on his wallet (100.00): share 30.00 is spending and owed; no money moves.
//   Alice's cash 500.00 + a hand-entered owed 12.00 (a pair: spending −12.00, owed +12.00) = 500.00.
import fs from "node:fs";
import path from "node:path";
import { createWorkspace, DISPLAY, firstRecord } from "../harness/fixtures.mjs";
import { newIdempotencyKey } from "../harness/api.mjs";

export const name = "recheck";
export const title = "BT-009 recheck: confirm-payments (group and per person) and owed-entries settings across users, locked group entries, the |==| mark, sharing a linked account, create-new identities, parallel requests";
export const needsBrowser = true;

const PAYMENTS = '[aria-labelledby="grp-payments"]';
const SETTINGS = 'section[aria-labelledby="grp-settings"]';
const eq = (...refs) => ({ method: "equal", lines: refs.map((ref) => ({ ref })) });
const confirmButtons = (s, label) => s.evaluate(`[...document.querySelectorAll('button')].filter((b) => (b.getAttribute('aria-label') || '') === ${JSON.stringify(label)}).length`);
// The quick-entry Type choices: the native select behind the command picker holds the offered options.
const typeChoices = (s) => s.evaluate(`(() => { const sel = [...document.querySelectorAll('.modal select')].find((x) => [...x.options].some((o) => o.text === 'Expense')); return sel ? [...sel.options].map((o) => o.text) : null; })()`);
// The value behind a person's "Can confirm payments" picker in the settings card.
const personValue = (s, person) => s.evaluate(`(() => { const sel = [...document.querySelectorAll('${SETTINGS} select')].find((x) => x.getAttribute('aria-label') === ${JSON.stringify(`Can confirm payments: ${person}`)}); return sel ? sel.value : null; })()`);
// A full reload only once the page is quiet: a request still running when the page reloads is
// cancelled and would otherwise stay counted as in flight in the harness.
const fresh = async (s, route) => { await s.settle(); await s.reload(); await s.goto(route); };

// Presses Save settings and waits for the app to say it saved (the polite live region), then for
// the re-read that follows.
async function saveSettings(s) {
  await s.evaluate("(() => { const r = document.getElementById('a11y-live'); if (r) r.textContent = ''; })()");
  await s.click({ role: "button", name: "Save settings", scope: SETTINGS });
  await s.waitFor("(() => { const r = document.getElementById('a11y-live'); return !!r && r.textContent.startsWith('Settings saved'); })()", { what: "the Settings saved announcement" });
  await s.settle();
}

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Recheck Club", kind: "group", members: { bob: "member", carol: "viewer" } });
  const q = W.q;
  const [A, B, C] = ["alice", "bob", "carol"].map((u) => W.ref(u));
  const api = (u) => h.api(u);
  const aliceCash = firstRecord(await api("alice").ok("accounts", { method: "POST", query: q, body: { name: "Alice Cash", type: "cash", currency: "EUR", openingBalance: "500.00" } }));
  const wallet = firstRecord(await api("bob").ok("accounts", { method: "POST", query: q, body: { name: "Bob Wallet", type: "cash", currency: "EUR", openingBalance: "100.00" } }));
  await api("bob").ok("group", { method: "POST", query: { ...q, action: "ledger" }, body: { currency: "EUR", accountId: wallet.id } });
  await api("alice").ok("group", { method: "POST", query: q, body: { description: "E2E dinner", amount: "90.00", payers: [{ ref: A }], split: eq(A, B, C) } });
  await api("bob").ok("group", { method: "POST", query: { ...q, action: "ledger" }, body: { currency: "EUR" } });
  const s1 = (await api("bob").ok("group", { method: "POST", query: { ...q, action: "settle" }, body: { from: B, to: A, amount: "30.00" } })).settlement;
  const s2 = (await api("bob").ok("group", { method: "POST", query: { ...q, action: "settle" }, body: { from: B, to: C, amount: "5.00" } })).settlement;
  t.note(`workspace ${W.name}: ${W.id}`);

  const b = await h.browsers(["alice", "bob", "carol"], { prefix: "recheck-" });
  for (const s of Object.values(b)) { await s.open("group"); await s.useWorkspace(W.name); await s.goto("group"); }
  if (!(await b.alice.exists(SETTINGS))) { t.skip("recheck in the browser", "the Shared expenses settings card is not present at this commit"); return; }

  // ---- B: Alice adds an expense in her browser while Bob confirms his own payment in his ----------
  await Promise.all([
    (async () => {
      await b.alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
      await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the Add shared expense dialog" });
      await b.alice.fill({ label: "Description", scope: ".modal" }, "E2E ferry");
      await b.alice.fill({ label: "Amount (EUR)", scope: ".modal" }, "45.00");
      await b.alice.click({ role: "button", name: "Save expense", scope: ".modal" });
      await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
    })(),
    (async () => {
      await b.bob.click({ role: "button", name: "Confirm You paid Alice Fictional", scope: PAYMENTS });
      await b.bob.waitFor("!!document.querySelector('.modal')", { what: "the Confirm payment dialog" });
      await b.bob.click({ role: "button", name: "Confirm", scope: ".modal" });
      await b.bob.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after confirming" });
    })(),
  ]);
  const afterB = await api("alice").ok("group", { query: q });
  t.check("B: both writes land — Alice's ferry and Bob's confirmation of his own payment (the setting is on by default)", {
    expected: { ferry: true, status: "confirmed", confirmation: { by: DISPLAY.bob, relation: "payer" } },
    actual: { ferry: afterB.expenses.some((e) => e.description === "E2E ferry"), status: afterB.settlements.find((s) => s.id === s1.id).status, confirmation: afterB.settlements.find((s) => s.id === s1.id).confirmation },
  });
  await Promise.all([fresh(b.alice, "group"), fresh(b.bob, "group")]);
  t.check("B: Alice and Bob each read 'Confirmed by Bob Fictional, who paid it.'", {
    expected: [true, true],
    actual: [(await b.alice.text(PAYMENTS)).includes("Confirmed by Bob Fictional, who paid it."), (await b.bob.text(PAYMENTS)).includes("Confirmed by Bob Fictional, who paid it.")],
  });

  // ---- S7: Carol (viewer) confirms the payment made to her; she has nothing to add -----------------
  const carolAdd = await b.carol.evaluate("[...document.querySelectorAll('.page-head button')].some((x) => x.textContent.trim() === 'Add expense')");
  await b.carol.click({ role: "button", name: "Confirm Bob Fictional paid you", scope: PAYMENTS });
  await b.carol.waitFor("!!document.querySelector('.modal')", { what: "Carol's Confirm payment dialog" });
  await b.carol.click({ role: "button", name: "Confirm", scope: ".modal" });
  await b.carol.waitFor("!document.querySelector('.modal')", { what: "Carol's dialog to close" });
  t.check("S7: Carol (viewer) confirms the payment to her in her browser and is offered no Add expense", {
    expected: { addExpense: false, status: "confirmed" },
    actual: { addExpense: carolAdd, status: (await api("carol").ok("group", { query: q })).settlements.find((s) => s.id === s2.id).status },
  });

  // ---- F1: a disputed payment is settled by its receiver only (the default), even with anyone able to confirm
  const sD = (await api("bob").ok("group", { method: "POST", query: { ...q, action: "settle" }, body: { from: B, to: A, amount: "9.00" } })).settlement;
  await api("alice").ok("group", { method: "POST", query: { ...q, action: "dispute" }, body: { settlementId: sD.id, revision: sD.revision, reason: "E2E never arrived" } });
  await Promise.all([fresh(b.alice, "group"), fresh(b.bob, "group")]);
  const disputedRow = `[...document.querySelectorAll('${PAYMENTS} tr')].find((x) => x.innerText.includes('Disputed: E2E never arrived'))`;
  const rowButtons = (s) => s.evaluate(`(() => { const r = ${disputedRow}; return r ? [...r.querySelectorAll('button')].map((x) => x.textContent.trim()) : null; })()`);
  const bobRowButtons = await rowButtons(b.bob);
  const aliceRowButtons = await rowButtons(b.alice);
  const bobOverDispute = (await api("bob").request("group", { method: "POST", query: { ...q, action: "confirm" }, body: { settlementId: sD.id, revision: sD.revision + 1 } })).status;
  // Alice confirms it over her own dispute, in her browser, with a real click in that row.
  const confirmAt = await b.alice.evaluate(`(() => { const r = ${disputedRow}; const c = r && [...r.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Confirm'); if (!c) return null; c.scrollIntoView({ block: 'center' }); const q = c.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`);
  if (confirmAt) {
    await b.alice.mouseClick(confirmAt.x, confirmAt.y);
    await b.alice.waitFor("!!document.querySelector('.modal')", { what: "Alice's Confirm payment dialog for the disputed payment" });
    await b.alice.click({ role: "button", name: "Confirm", scope: ".modal" });
    await b.alice.waitFor("!document.querySelector('.modal')", { what: "Alice's dialog to close" });
  }
  await fresh(b.bob, "group");
  t.check("F1: with anyone able to confirm, Bob's browser offers no Confirm on the payment Alice disputed and the API refuses him; Alice's does, and after she confirms it Bob reads 'Confirmed over a dispute by Alice Fictional.'", {
    expected: { bobOffered: false, aliceOffered: true, bobDirect: 403, bobReads: true },
    actual: { bobOffered: (bobRowButtons || []).includes("Confirm"), aliceOffered: (aliceRowButtons || []).includes("Confirm"), bobDirect: bobOverDispute, bobReads: (await b.bob.text(PAYMENTS)).includes("Confirmed over a dispute by Alice Fictional.") },
  });

  // ---- R3-2: Bob reports a payment again after Alice disputed it; under the default only Alice may confirm it
  const sE = (await api("bob").ok("group", { method: "POST", query: { ...q, action: "settle" }, body: { from: B, to: A, amount: "6.00" } })).settlement;
  await api("alice").ok("group", { method: "POST", query: { ...q, action: "dispute" }, body: { settlementId: sE.id, revision: sE.revision, reason: "E2E second dispute" } });
  const sF = (await api("bob").ok("group", { method: "POST", query: { ...q, action: "settle" }, body: { from: B, to: A, amount: "6.00" } })).settlement;
  await Promise.all([fresh(b.alice, "group"), fresh(b.bob, "group")]);
  const rowButtonsWith = (s, text) => s.evaluate(`(() => { const r = [...document.querySelectorAll('${PAYMENTS} tr')].find((x) => x.innerText.includes(${JSON.stringify(text)})); return r ? [...r.querySelectorAll('button')].map((x) => x.textContent.trim()) : null; })()`);
  const bobAgain = await rowButtonsWith(b.bob, "Reported again after a dispute");
  const aliceAgain = await rowButtonsWith(b.alice, "Reported again after a dispute");
  t.check("R3-2: Bob reports his payment again after Alice disputed it; both browsers show it as reported again after a dispute; Bob is offered no Confirm, Alice is", {
    expected: { linked: sE.id, bobSees: true, bobConfirm: false, aliceConfirm: true },
    actual: { linked: sF.reportedAgainOf, bobSees: !!bobAgain, bobConfirm: (bobAgain || []).includes("Confirm"), aliceConfirm: (aliceAgain || []).includes("Confirm") },
  });
  // Alice settles it: she confirms the payment reported again and voids the one she disputed, so no
  // dispute stays open between them for the rest of the scenario.
  await api("alice").ok("group", { method: "POST", query: { ...q, action: "confirm" }, body: { settlementId: sF.id, revision: sF.revision } });
  await api("alice").ok("group", { method: "POST", query: { ...q, action: "void" }, body: { settlementId: sE.id, revision: sE.revision + 1, reason: "E2E paid again instead" } });

  // ---- R3-1: with managers allowed to settle disputes, Alice (owner) cannot settle Bob's dispute of her own payment
  await api("alice").ok("group", { method: "POST", query: { ...q, action: "settings" }, body: { changes: { settleDisputes: "receiver-or-manager" } } });
  const sG = (await api("alice").ok("group", { method: "POST", query: { ...q, action: "settle" }, body: { from: A, to: B, amount: "7.00" } })).settlement;
  await api("bob").ok("group", { method: "POST", query: { ...q, action: "dispute" }, body: { settlementId: sG.id, revision: sG.revision, reason: "E2E not mine" } });
  await Promise.all([fresh(b.alice, "group"), fresh(b.bob, "group")]);
  const aliceNotMine = await rowButtonsWith(b.alice, "Disputed: E2E not mine");
  const bobNotMine = await rowButtonsWith(b.bob, "Disputed: E2E not mine");
  const aliceDirect = (await api("alice").request("group", { method: "POST", query: { ...q, action: "confirm" }, body: { settlementId: sG.id, revision: sG.revision + 1 } })).status;
  t.check("R3-1: with managers allowed to settle disputes, Alice's browser offers no Confirm on her own payment Bob disputed and the API refuses her; Bob's offers it", {
    expected: { aliceSees: true, aliceConfirm: false, aliceDirect: 403, bobConfirm: true },
    actual: { aliceSees: !!aliceNotMine, aliceConfirm: (aliceNotMine || []).includes("Confirm"), aliceDirect, bobConfirm: (bobNotMine || []).includes("Confirm") },
  });
  await api("alice").ok("group", { method: "POST", query: { ...q, action: "settings" }, body: { changes: { settleDisputes: "receiver" } } });

  // ---- B per person: the group setting is on; Alice sets Bob to No in her card ------------------
  // Bob loses Confirm on his own payment (the API refuses him too); Carol still confirms one made to her.
  const s3 = (await api("bob").ok("group", { method: "POST", query: { ...q, action: "settle" }, body: { from: B, to: A, amount: "10.00" } })).settlement;
  const s5 = (await api("bob").ok("group", { method: "POST", query: { ...q, action: "settle" }, body: { from: B, to: C, amount: "4.00" } })).settlement;
  await fresh(b.alice, "group");
  const listed = await b.alice.evaluate(`[...document.querySelectorAll('${SETTINGS} select')].map((x) => x.getAttribute('aria-label')).filter((l) => (l || '').startsWith('Can confirm payments: '))`);
  // Two people in ONE Save (security recheck of 47617b5, M1): both must be kept, not only the last.
  await b.alice.choose(DISPLAY.bob, "No", { scope: SETTINGS });
  await b.alice.choose(DISPLAY.carol, "No", { scope: SETTINGS });
  await saveSettings(b.alice);
  await fresh(b.alice, "group");
  const aliceCard = {
    bob: await personValue(b.alice, DISPLAY.bob), carol: await personValue(b.alice, DISPLAY.carol), text: await b.alice.text(SETTINGS),
    history: await b.alice.evaluate(`(document.querySelector('${SETTINGS}').textContent.match(/Can confirm payments for (Bob|Carol) Fictional: Use the group setting → No/g) || []).length`),
  };
  await fresh(b.bob, "group");
  const bobNo = {
    confirm: await confirmButtons(b.bob, "Confirm You paid Alice Fictional"),
    says: (await b.bob.text(PAYMENTS)).includes("You can confirm payments made to you."),
    card: await b.bob.evaluate(`!!document.querySelector('${SETTINGS}:not([hidden])')`),
    direct: (await api("bob").request("group", { method: "POST", query: { ...q, action: "confirm" }, body: { settlementId: s3.id, revision: s3.revision } })).status,
  };
  await fresh(b.carol, "group");
  await b.carol.click({ role: "button", name: "Confirm Bob Fictional paid you", scope: PAYMENTS });
  await b.carol.waitFor("!!document.querySelector('.modal')", { what: "Carol's second Confirm payment dialog" });
  await b.carol.click({ role: "button", name: "Confirm", scope: ".modal" });
  await b.carol.waitFor("!document.querySelector('.modal')", { what: "Carol's dialog to close again" });
  const carolGot = (await api("carol").ok("group", { query: q })).settlements.find((s) => s.id === s5.id);
  t.check("B per person and M1: Alice's card lists everyone with a picker; she sets Bob and Carol to No in one Save while the group setting is on, and after a reload both show No, each once in the history", {
    expected: { listed: [`Can confirm payments: ${DISPLAY.alice}`, `Can confirm payments: ${DISPLAY.bob}`, `Can confirm payments: ${DISPLAY.carol}`], bob: "no", carol: "no", bobHelp: true, carolHelp: true, history: 2 },
    actual: { listed, bob: aliceCard.bob, carol: aliceCard.carol, bobHelp: aliceCard.text.includes("Only payments made to them now"), carolHelp: aliceCard.text.includes("Only payments made to them (a viewer)"), history: aliceCard.history },
  });
  t.check("B per person: in Bob's browser there is no Confirm on his own payment, he is told he confirms payments made to him, sees no settings card, and the API refuses him", {
    expected: { confirm: 0, says: true, card: false, direct: 403 }, actual: bobNo,
  });
  t.check("B per person: Carol still confirms the payment made to her in her browser", {
    expected: { status: "confirmed", confirmation: { by: DISPLAY.carol, relation: "receiver" } }, actual: { status: carolGot.status, confirmation: carolGot.confirmation },
  });
  // Back to "Use the group setting": Bob follows the group (on) again.
  await b.alice.choose(DISPLAY.bob, "Use the group setting", { scope: SETTINGS });
  await b.alice.choose(DISPLAY.carol, "Use the group setting", { scope: SETTINGS });
  await saveSettings(b.alice);
  await fresh(b.bob, "group");
  const before = await confirmButtons(b.bob, "Confirm You paid Alice Fictional");

  // ---- B: Alice turns the group setting off; Bob's Confirm disappears and the API refuses him -------
  await b.alice.choose("Anyone in the group can confirm payments", "Off", { scope: SETTINGS });
  await saveSettings(b.alice);
  await fresh(b.bob, "group");
  const after = await confirmButtons(b.bob, "Confirm You paid Alice Fictional");
  const direct = await api("bob").request("group", { method: "POST", query: { ...q, action: "confirm" }, body: { settlementId: s3.id, revision: s3.revision } });
  t.check("B: back on 'Use the group setting' Bob sees Confirm on his own payment again; with the group setting off (by Alice) he does not and the API refuses him", {
    expected: { before: 1, after: 0, direct: 403 }, actual: { before, after, direct: direct.status },
  });

  // ---- N1 + C: quick entry's Type choices follow the owed-entries setting ------------------------
  await b.alice.goto("transactions");
  await b.alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "quick entry" });
  const kindsDefault = await typeChoices(b.alice);
  await b.alice.click({ role: "button", name: "Cancel", scope: ".modal" });
  await b.alice.goto("group");
  await b.alice.choose("Owed-to-others and repayment entries", "Also allow entering them by hand", { scope: SETTINGS });
  await saveSettings(b.alice);
  await fresh(b.alice, "transactions");
  await b.alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "quick entry again" });
  const kindsManual = await typeChoices(b.alice);
  await b.alice.click({ role: "button", name: "Cancel", scope: ".modal" });
  const MANUAL = ["Expense", "Income", "Transfer", "Refund", "Fee", "Reimbursement received", "Advance (lent)", "Adjustment", "Interest"];
  t.check("N1/C: quick entry leaves out Owed to others and Repayment made by default and offers them once Alice allows hand entry", {
    expected: { byDefault: MANUAL, allowed: [...MANUAL, "Owed to others", "Repayment made"] }, actual: { byDefault: kindsDefault, allowed: kindsManual },
  });
  const pair = await api("alice").request("transactions", { method: "POST", query: q, body: { accountId: aliceCash.id, kind: "payable", amount: "12.00", notes: "E2E lunch Bob paid" } });
  const cash = (await api("alice").ok("accounts", { query: q })).accounts.find((a) => a.id === aliceCash.id).balance;
  t.check("C: a hand-entered owed amount is a pair (spending and owed) and the balance stays 500.00", {
    expected: { status: 201, kinds: "expense,payable", balance: "500.00" }, actual: { status: pair.status, kinds: pair.data && pair.data.transactions ? pair.data.transactions.map((x) => x.kind).join(",") : pair.code, balance: cash },
  });

  // ---- N2 + D: Bob's entries from Shared expenses on his Transactions page ------------------------
  await b.bob.goto("transactions");
  const rows = await b.bob.evaluate(`(() => [...document.querySelectorAll('tbody tr')].filter((r) => r.innerText.includes('Owed to others')).map((r) => ({
    buttons: [...r.querySelectorAll('button')].map((x) => x.textContent.trim()),
    enabled: [...r.querySelectorAll('button')].filter((x) => !x.disabled).map((x) => x.textContent.trim()),
    moveTip: (() => { const m = [...r.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Move to another account'); const tip = m && m.closest('.tip'); return tip ? tip.getAttribute('data-tip') : null; })(),
    marks: [...r.querySelectorAll('svg[data-icon]')].map((s) => s.getAttribute('data-icon')).filter((i) => ['no-money-moved', 'money-in', 'money-out'].includes(i)),
    amount: ((r.querySelector('td[data-label="Amount"]') || {}).innerText || '').replace(/\\s+/g, ' ').trim(),
    size: (() => { const s = r.querySelector('svg[data-icon="no-money-moved"]'); if (!s) return null; const q = s.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height)]; })(),
  })))()`);
  // BT-006-05: an entry recorded from Shared expenses also offers "Move to another account" now, but
  // disabled and explained (N2 applies to a move too — change it in Shared expenses), never enabled.
  t.check("N2: Bob's owed entry offers only Edit as a working action; Move to another account is present but disabled and explains why (N2), never Reverse or Delete", {
    expected: { buttons: [["Edit", "Move to another account"]], enabled: [["Edit"]], tipMentionsShared: true },
    actual: { buttons: rows.map((r) => r.buttons), enabled: rows.map((r) => r.enabled), tipMentionsShared: rows.every((r) => /Shared expenses/.test(r.moveTip || "")) },
  });
  // L4 (Terry's arrow rule): his share of the dinner Alice paid shows the |==| mark and "Paid by someone
  // else"; each repayment he really made keeps one money-out arrow.
  // The list shows each row's account, amount and (for kinds other than a plain expense) its kind label.
  const walletRows = await b.bob.evaluate(`(() => [...document.querySelectorAll('tbody tr')].filter((r) => ((r.querySelector('td[data-label="Account"]') || {}).innerText || '').includes('Bob Wallet')).map((r) => ({
    amount: ((r.querySelector('td[data-label="Amount"]') || {}).innerText || '').replace(/\\s+/g, ' ').trim(),
    kind: ((r.querySelector('td[data-label="Status"]') || {}).innerText || ''),
    marks: [...r.querySelectorAll('svg[data-icon]')].map((s) => s.getAttribute('data-icon')).filter((i) => ['no-money-moved', 'money-in', 'money-out'].includes(i)),
  })))()`);
  const shareRows = walletRows.filter((r) => r.amount.includes("Paid by someone else"));
  const repaidRows = walletRows.filter((r) => r.kind.includes("Repayment made"));
  const outArrows = walletRows.filter((r) => r.marks.includes("money-out"));
  t.check("L4: on Bob Wallet his 30.00 share of the dinner Alice paid shows the |==| mark with 'Paid by someone else' and no arrow; every money-out arrow there is a repayment he really made", {
    expected: { share: [{ thirty: true, marks: ["no-money-moved"] }], arrowsAreRepayments: true, anyRepaid: true },
    actual: {
      share: shareRows.map((r) => ({ thirty: r.amount.includes("30.00"), marks: r.marks })),
      arrowsAreRepayments: outArrows.length === repaidRows.length && repaidRows.every((r) => r.marks.join() === "money-out"), anyRepaid: repaidRows.length > 0,
    },
  });
  t.check("D: it shows the |==| mark (and no arrow) beside 'EUR 30.00 No money moved'", {
    expected: [{ marks: ["no-money-moved"], amount: "EUR 30.00 No money moved", visible: true }],
    actual: rows.map((r) => ({ marks: r.marks, amount: r.amount, visible: !!r.size && r.size[0] > 0 && r.size[1] > 0 })),
  });
  // The Edit button in the "Owed to others" row (each row's button has the same name), pressed with a
  // real mouse click at its centre.
  const editAt = await b.bob.evaluate(`(() => { const r = [...document.querySelectorAll('tbody tr')].find((x) => x.innerText.includes('Owed to others'));
    const e = r && [...r.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Edit'); if (!e) return null;
    e.scrollIntoView({ block: 'center' }); const q = e.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`);
  if (!editAt) throw new Error("bob: the owed row has no Edit button");
  await b.bob.mouseClick(editAt.x, editAt.y);
  await b.bob.waitFor("!!document.querySelector('.modal')", { what: "the edit form" });
  const lock = await b.bob.evaluate(`(() => { const m = document.querySelector('.modal'); return { says: m.innerText.includes('follow the shared expense. Change it in Shared expenses'), amountLocked: m.querySelector('input[placeholder="0.00 or 12.50+3.20"]').disabled }; })()`);
  await b.bob.click({ role: "button", name: "Cancel", scope: ".modal" });
  t.check("N2: its edit form keeps the amount locked and says to change it in Shared expenses", { expected: { says: true, amountLocked: true }, actual: lock });
  const shots = [await b.bob.shot("owed-light")];
  await b.bob.cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }, { name: "prefers-reduced-motion", value: "reduce" }] });
  shots.push(await b.bob.shot("owed-dark"));
  await b.bob.cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  shots.push(await b.bob.shot("owed-390-dark"));
  await b.bob.cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }, { name: "prefers-reduced-motion", value: "reduce" }] });
  await b.bob.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  t.note(`screenshots of the |==| mark: ${shots.join(", ")}`);
  await fresh(b.alice, "group");
  t.note(`screenshot of Alice's settings card: ${await b.alice.shot("settings-card")}`);

  // ---- Settings b, c and e across browsers (Terry, 2026-09-14: "build all 10") -----------------------
  // (c) Alice lets any member who can add expenses correct them: Bob, who could not before, corrects the
  // ferry Alice added, in his browser, with a reason.
  const EXPENSES = '[aria-labelledby="grp-expenses"]';
  const ferryId = afterB.expenses.find((x) => x.description === "E2E ferry").id;
  const ferryEdit = (s) => s.evaluate(`(() => { const r = [...document.querySelectorAll('${EXPENSES} tr')].find((x) => x.innerText.includes('E2E ferry')); return !!r && [...r.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Edit'); })()`);
  await fresh(b.bob, "group");
  const bobCouldEdit = await ferryEdit(b.bob);
  await fresh(b.alice, "group");
  await b.alice.choose("Who may correct or void a shared expense", "Any member who can add expenses", { scope: SETTINGS });
  await saveSettings(b.alice);
  await fresh(b.bob, "group");
  const bobCanEdit = await ferryEdit(b.bob);
  if (bobCanEdit) {
    await b.bob.click({ role: "button", name: "Edit E2E ferry", scope: EXPENSES });
    await b.bob.waitFor("!!document.querySelector('.modal')", { what: "Bob's correction dialog" });
    await b.bob.fill({ label: "Description", scope: ".modal" }, "E2E ferry (Bob's correction)");
    await b.bob.fill({ label: "Reason for this correction", scope: ".modal" }, "Right name");
    await b.bob.click({ role: "button", name: "Save correction", scope: ".modal" });
    await b.bob.waitFor("!document.querySelector('.modal')", { what: "Bob's correction dialog to close" });
  }
  const ferryNow = (await api("alice").ok("group", { query: q })).expenses.find((e) => e.id === ferryId);
  t.check("Setting c: Bob has no Edit on the ferry Alice added until she chooses 'Any member who can add expenses' in her card; then he corrects it in his browser", {
    expected: { before: false, after: true, description: "E2E ferry (Bob's correction)" }, actual: { before: bobCouldEdit, after: bobCanEdit, description: ferryNow ? ferryNow.description : null },
  });

  // (b) and (e) Bob's own defaults: only him sharing a new expense, and balances as "Keep who owes whom".
  // Alice keeps the group's defaults: everyone shares, and the fewest payments.
  const MINE = '[aria-labelledby="grp-mine"]';
  await b.bob.choose("Who shares by default", "Only me", { scope: MINE });
  await b.bob.choose("Balances shown as", "Keep who owes whom", { scope: MINE });
  await b.bob.evaluate("(() => { const r = document.getElementById('a11y-live'); if (r) r.textContent = ''; })()");
  await b.bob.click({ role: "button", name: "Save my defaults", scope: MINE });
  await b.bob.waitFor("(() => { const r = document.getElementById('a11y-live'); return !!r && r.textContent.startsWith('Your defaults are saved'); })()", { what: "Bob's defaults to be saved" });
  await Promise.all([fresh(b.bob, "group"), fresh(b.alice, "group")]);
  // Who is ticked to share in a new expense: the split rows after the payer rows (one row per person each).
  const tickedToShare = async (s) => {
    await s.click({ role: "button", name: "Add expense", scope: ".page-head" });
    await s.waitFor("!!document.querySelector('.modal')", { what: "the Add shared expense dialog" });
    const names = await s.evaluate("(() => { const rows = [...document.querySelectorAll('.modal .split-row')]; return rows.slice(rows.length / 2).filter((r) => r.querySelector('input').checked).map((r) => r.querySelector('label').textContent); })()");
    await s.press("Escape");
    await s.waitFor("!document.querySelector('.modal')", { what: "the dialog to close" });
    return names;
  };
  const bobTicked = await tickedToShare(b.bob);
  const aliceTicked = await tickedToShare(b.alice);
  t.check("Settings b and e: Bob's own defaults apply only to him: his new expense has only him sharing and his balances show who owes whom; Alice's has everyone and the fewest payments", {
    expected: { bobTicked: ["Bob Fictional (you)"], aliceTicked: ["Alice Fictional (you)", "Bob Fictional", "Carol Fictional"], bobDirect: true, aliceFewest: true },
    actual: {
      bobTicked, aliceTicked,
      bobDirect: (await b.bob.text("body")).includes("Each person pays back the people who paid for them"), aliceFewest: (await b.alice.text("body")).includes("The fewest payments that settle everyone."),
    },
  });

  // ---- R1: Bob shares his wallet; recording on it stops, and his browser shows nothing to update -----
  // The Accounts page offers no way to make an existing account shared (only per-member grants), so the
  // share itself is Bob's API request, as the server's confirmation flow expects; the evidence in his
  // browser is what he sees afterwards.
  const w = (await api("bob").ok("accounts", { query: q })).accounts.find((a) => a.id === wallet.id);
  const shareAsked = await api("bob").request("accounts", { method: "PATCH", query: q, body: { accountId: w.id, revision: w.revision, visibility: "shared" } });
  const shared = (await api("bob").request("accounts", { method: "PATCH", query: q, body: { accountId: w.id, revision: w.revision, visibility: "shared", confirmShare: true } })).status;
  t.check("R1: asked to share without confirming, the server says recording on it for Shared expenses stops", {
    expected: { status: 400, code: "confirm_required", says: true }, actual: { status: shareAsked.status, code: shareAsked.code, says: /recording on this account stops/.test(shareAsked.message || "") },
  });
  const walletEntries = async () => (await api("bob").ok("transactions", { query: { ...q, accountId: wallet.id } })).transactions.length;
  const beforeShare = await walletEntries();
  await api("alice").ok("group", { method: "POST", query: q, body: { description: "E2E taxi", amount: "20.00", payers: [{ ref: A }], split: eq(A, B) } });
  await api("bob").ok("group", { method: "POST", query: { ...q, action: "ledger" }, body: { currency: "EUR" } });
  const bobGroup = await api("bob").ok("group", { query: q });
  await fresh(b.bob, "group");
  const bobBody = await b.bob.text("body");
  t.check("R1 and F2: after Bob shares his wallet, Alice's taxi and Bob's update write nothing there and no link remains; his browser says his part is on an account that is now shared and offers to choose another", {
    expected: { share: 200, entriesAfter: beforeShare, link: undefined, notice: true, says: true, choose: true },
    actual: {
      share: shared, entriesAfter: await walletEntries(), link: bobGroup.myLedgers, notice: bobBody.includes("Your account needs updating"), says: bobBody.includes("which is now shared"),
      choose: await b.bob.evaluate("[...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Choose my account')"),
    },
  });
  // F2 and N-1: Bob chooses a new private account. Only his parts that moved no cash (shares someone else
  // paid) move there; the repayments he really paid from the wallet stay on it, so no balance changes. His
  // page has nothing left to update, and his outstanding over all his accounts equals his group balance.
  const balanceNow = async (id) => (await api("bob").ok("accounts", { query: q })).accounts.find((a) => a.id === id).balance;
  const walletBefore = await balanceNow(wallet.id);
  const spare = firstRecord(await api("bob").ok("accounts", { method: "POST", query: q, body: { name: "E2E Bob Spare", type: "cash", currency: "EUR", openingBalance: "50.00" } }));
  await api("bob").ok("group", { method: "POST", query: { ...q, action: "ledger" }, body: { currency: "EUR", accountId: spare.id } });
  await fresh(b.bob, "group");
  const bobNet = (await api("bob").ok("group", { query: q })).balances.find((x) => x.currency === "EUR").rows.find((r) => r.ref === B).net;
  const bobAll = (await api("bob").ok("transactions", { query: q })).summary.find((s) => s.currency === "EUR");
  const liveShared = async (id) => (await api("bob").ok("transactions", { query: { ...q, accountId: id } })).transactions.filter((x) => x.fromSharedExpense && !x.reversedBy && !(x.links && x.links.reverses));
  const walletKinds = [...new Set((await liveShared(wallet.id)).map((x) => x.kind))];
  // Shares someone else paid arrive on the spare as pairs (share and amount owed) that net to 0.00; any
  // repayment not recorded anywhere before is recorded on the spare, the account he records on now.
  const onSpare = await liveShared(spare.id);
  const pairsNet = onSpare.filter((x) => x.kind === "expense" || x.kind === "payable").reduce((a, x) => a + x.amountMinor, 0);
  t.check("N-1 and F2: once Bob chooses E2E Bob Spare his browser shows nothing to update; the wallet keeps its balance and only the repayments he really paid from it; the shares others paid arrive on the spare as pairs netting 0.00; his outstanding over all his accounts equals his group balance", {
    expected: { notice: false, walletSame: true, walletKinds: ["repayment"], sparePairsNet: 0, spareKinds: true, outstanding: bobNet },
    actual: {
      notice: (await b.bob.text("body")).includes("Your account needs updating"), walletSame: (await balanceNow(wallet.id)) === walletBefore, walletKinds, sparePairsNet: pairsNet,
      spareKinds: onSpare.every((x) => ["expense", "payable", "repayment"].includes(x.kind)), outstanding: bobAll ? bobAll.receivable : null,
    },
  });

  // ---- E: parallel requests against the file-backed dev server ------------------------------------
  const s4 = (await api("bob").ok("group", { method: "POST", query: { ...q, action: "settle" }, body: { from: B, to: A, amount: "7.00" } })).settlement;
  const confirms = await Promise.all([1, 2].map(() => api("alice").request("group", { method: "POST", query: { ...q, action: "confirm" }, body: { settlementId: s4.id, revision: s4.revision } })));
  t.check("E: two confirmations of one payment at once — one 200, one 409", { expected: [200, 409], actual: confirms.map((r) => r.status).sort() });
  const body = { description: "E2E parallel", amount: "8.00", payers: [{ ref: A }], split: eq(A, B) };
  const key = newIdempotencyKey();
  const same = await Promise.all([1, 2].map(() => api("alice").request("group", { method: "POST", query: q, body, idempotencyKey: key })));
  const diff = await Promise.all([1, 2].map(() => api("alice").request("group", { method: "POST", query: q, body, idempotencyKey: newIdempotencyKey() })));
  const count = (await api("alice").ok("group", { query: q })).expenses.filter((e) => e.description === "E2E parallel").length;
  t.check("E: two creates with one key are one expense; two with different keys are two (three in all)", {
    expected: { sameId: true, differentIds: true, count: 3 }, actual: { sameId: same[0].data.expense.id === same[1].data.expense.id, differentIds: diff[0].data.expense.id !== diff[1].data.expense.id, count },
  });
  const target = same[0].data.expense;
  const edits = await Promise.all(["A", "B"].map((x) => api("alice").request("group", { method: "PATCH", query: q, body: { expenseId: target.id, revision: target.revision, description: `E2E parallel ${x}`, reason: "Race" } })));
  t.check("E: two corrections at one revision — one 200, one 409 stale_revision", { expected: [[200, null], [409, "stale_revision"]], actual: edits.map((r) => [r.status, r.code]).sort((x, y) => x[0] - y[0]) });
  const billLinks = await api("alice").request("recurring", { method: "POST", query: q, body: { name: "E2E internet", billType: "utilities", accountId: aliceCash.id, amount: "30.00", schedule: { freq: "monthly", startDate: "2026-09-01" }, links: { groupExpenseId: afterB.expenses[0].id } } });
  t.check("E: the bills route refuses client-supplied group links", { expected: 400, actual: billLinks.status });

  // ---- S4: a create-new restore carries nobody else's identity; Bob, invited later, owns nothing ---
  const R = await createWorkspace(h, { name: "E2E Restore Household", kind: "household", members: { bob: "member" } });
  const joint = firstRecord(await api("alice").ok("accounts", { method: "POST", query: R.q, body: { name: "E2E Joint", type: "checking", currency: "EUR", visibility: "shared", openingBalance: "1000.00" } }));
  const bobWallet = firstRecord(await api("bob").ok("accounts", { method: "POST", query: R.q, body: { name: "E2E Bob Wallet", type: "cash", currency: "EUR", openingBalance: "50.00" } }));
  const bobsEntry = firstRecord(await api("bob").ok("transactions", { method: "POST", query: R.q, body: { accountId: joint.id, kind: "expense", amount: "12.00", notes: "E2E milk" } }));
  await api("alice").ok("recurring", { method: "POST", query: R.q, body: { name: "E2E rent", billType: "housing", accountId: joint.id, amount: "800.00", schedule: { freq: "monthly", startDate: "2026-10-01" }, responsibleRef: R.ref("bob") } });
  // L3 (security recheck of 47617b5): Bob moves 5.00 from the Joint to his private wallet. Alice sees the
  // Joint's side as a transfer to "another account", and nothing in her page or her API answer names the
  // wallet; Bob sees his wallet's name.
  await api("bob").ok("transactions", { method: "POST", query: R.q, body: { accountId: joint.id, kind: "transfer", amount: "5.00", transfer: { toAccountId: bobWallet.id } } });
  const aliceList = await api("alice").ok("transactions", { query: R.q });
  await fresh(b.alice, "group"); await b.alice.useWorkspace(R.name); await b.alice.goto("transactions");
  await fresh(b.bob, "group"); await b.bob.useWorkspace(R.name); await b.bob.goto("transactions");
  const transferRow = (s) => s.evaluate(`(() => { const r = [...document.querySelectorAll('tbody tr')].find((x) => x.innerText.includes('Transfer to')); return r ? (r.innerText.match(/Transfer to [^\\n\\t]+/) || [''])[0].trim() : null; })()`);
  t.check("L3: Alice's browser shows the Joint's side as 'Transfer to another account' and her page and API answer hold no id of Bob's wallet; Bob's shows his wallet", {
    expected: { alice: "Transfer to another account", alicePage: false, aliceApi: false, bob: "Transfer to E2E Bob Wallet" },
    actual: { alice: await transferRow(b.alice), alicePage: await b.alice.evaluate(`document.documentElement.outerHTML.includes(${JSON.stringify(bobWallet.id)})`), aliceApi: JSON.stringify(aliceList).includes(bobWallet.id), bob: await transferRow(b.bob) },
  });
  // R3-3: Alice's private bill moves 25.00 into the Joint. Bob sees that entry, but nothing in his API
  // answer or his page names the bill.
  const aliceSavings = firstRecord(await api("alice").ok("accounts", { method: "POST", query: R.q, body: { name: "E2E Alice Savings", type: "savings", currency: "EUR", openingBalance: "300.00" } }));
  const fund = firstRecord(await api("alice").ok("recurring", { method: "POST", query: R.q, body: { name: "E2E house fund", billType: "savings", kind: "transfer", accountId: aliceSavings.id, toAccountId: joint.id, amount: "25.00", schedule: { freq: "monthly", startDate: "2026-09-01" } } }));
  await api("alice").ok("recurring", { method: "POST", query: { ...R.q, action: "record" }, body: { recurringId: fund.id, occurrence: "2026-09-01" } });
  const bobList = await api("bob").ok("transactions", { query: R.q });
  await fresh(b.bob, "transactions");
  t.check("R3-3: Alice's private bill moves 25.00 into the Joint; Bob sees the entry, but his API answer and his page hold no id of that bill", {
    expected: { seesEntry: true, api: false, page: false },
    actual: { seesEntry: bobList.transactions.some((x) => x.kind === "transfer" && x.amount === "25.00"), api: JSON.stringify(bobList).includes(fund.id), page: await b.bob.evaluate(`document.documentElement.outerHTML.includes(${JSON.stringify(fund.id)})`) },
  });
  // A per-person right for Bob is keyed by his member id: it must not come along either.
  await api("alice").ok("group", { method: "POST", query: { ...R.q, action: "settings" }, body: { changes: { confirmOverrides: { [R.memberOf("bob").id]: "no" } } } });
  const archiveId = (await api("alice").ok("backups", { method: "POST", query: R.q, body: {} })).archive.archiveId;
  const created = (await api("alice").ok("restore", { method: "POST", query: { action: "execute" }, body: { workspaceId: R.id, archiveId, mode: "create-new" } })).workspace;
  t.note(`workspace ${R.name}: ${R.id}; its create-new copy ${created.name}: ${created.id}`);
  // The isolated server keeps its storage in <dataRoot>/dev-data (scripts/dev/dataroot.mjs).
  const file = [path.join(h.server.dataRoot, "dev-data", "workspaces", created.id, "workspace.json"), path.join(h.server.dataRoot, "workspaces", created.id, "workspace.json")].find((p) => fs.existsSync(p)) || "";
  const text = file ? fs.readFileSync(file, "utf8") : "";
  // L2: every account id named in the new workspace is one of its own accounts.
  const carried = text ? new Set(JSON.parse(text).accounts.map((a) => a.id)) : new Set();
  const strayAccounts = [...new Set(text.match(/\bacc_[A-Za-z0-9]+/g) || [])].filter((id) => !carried.has(id));
  t.check("S4 and L2: the new workspace's stored document holds no subject, member id or private account of Bob (not even on the Joint's side of his transfer), and keeps Alice's own", {
    expected: { read: true, bobSubject: false, bobMemberId: false, bobWallet: false, strayAccounts: [], aliceSubject: true },
    actual: { read: !!text, bobSubject: text.includes("google:dev-bob"), bobMemberId: text.includes(R.memberOf("bob").id), bobWallet: text.includes(bobWallet.id), strayAccounts, aliceSubject: text.includes("google:dev-alice") },
  });
  const inv = await api("alice").ok("invitations", { method: "POST", query: { workspaceId: created.id }, body: { email: "bob@example.com", role: "member" } });
  await api("bob").ok("invitations", { method: "POST", query: { action: "accept" }, body: { workspaceId: created.id, token: inv.token } });
  const oldEntry = (await api("bob").ok("transactions", { query: { workspaceId: created.id } })).transactions.find((x) => x.id === bobsEntry.id);
  await b.bob.settle(); await b.bob.reload(); await b.bob.useWorkspace(created.name); await b.bob.goto("transactions");
  const bobRow = await b.bob.evaluate(`(() => { const r = [...document.querySelectorAll('tbody tr')].find((x) => x.innerText.includes('EUR 12.00')); return r ? [...r.querySelectorAll('button')].map((x) => x.textContent.trim()) : null; })()`);
  t.check("S4: invited into the restored workspace, Bob does not own his old entry — createdBySelf false and no Edit or Delete in his browser", {
    expected: { createdBySelf: false, buttons: [] }, actual: { createdBySelf: oldEntry ? oldEntry.createdBySelf : "missing", buttons: bobRow },
  });

  // ---- every browser stayed clean -----------------------------------------------------------------
  for (const s of Object.values(b)) { await s.settle(); t.check(`${s.name}: no exceptions, console errors or failed requests in the browser`, { expected: [], actual: s.problems() }); }
}
