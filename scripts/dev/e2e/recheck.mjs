// BT-009 RECHECK (branch fix/bt009-recheck), THREE BROWSERS AT ONCE: who may confirm a payment (the
// group setting "Anyone in the group can confirm payments"), owed-to-others and repayment entries (the
// group setting and the quick-entry Type choices), entries recorded from Shared expenses locked on the
// Transactions page, the |==| no-money-moved mark, sharing an account that records a group (R1), a
// create-new restore that carries nobody else's identity (S4), and parallel requests against the
// file-backed dev server. Fictional data only.
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
export const title = "BT-009 recheck: confirm-payments and owed-entries settings across users, locked group entries, the |==| mark, sharing a linked account, create-new identities, parallel requests";
export const needsBrowser = true;

const PAYMENTS = '[aria-labelledby="grp-payments"]';
const SETTINGS = 'section[aria-labelledby="grp-settings"]';
const eq = (...refs) => ({ method: "equal", lines: refs.map((ref) => ({ ref })) });
const confirmButtons = (s, label) => s.evaluate(`[...document.querySelectorAll('button')].filter((b) => (b.getAttribute('aria-label') || '') === ${JSON.stringify(label)}).length`);
// The quick-entry Type choices: the native select behind the command picker holds the offered options.
const typeChoices = (s) => s.evaluate(`(() => { const sel = [...document.querySelectorAll('.modal select')].find((x) => [...x.options].some((o) => o.text === 'Expense')); return sel ? [...sel.options].map((o) => o.text) : null; })()`);

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
  // Diagnostic trail: how many waits have timed out in each browser so far (a request still counted
  // as in flight makes every later wait time out), noted after each step.
  const trail = (step) => t.note(`after ${step}: timed-out waits alice ${b.alice.log.failed.length}, bob ${b.bob.log.failed.length}, carol ${b.carol.log.failed.length}`);
  for (const s of Object.values(b)) { await s.open("group"); await s.useWorkspace(W.name); await s.goto("group"); }
  trail("opening the group");
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
  await Promise.all([b.alice.reload(), b.bob.reload()]);
  await Promise.all([b.alice.goto("group"), b.bob.goto("group")]);
  t.check("B: Alice and Bob each read 'Confirmed by Bob Fictional, who paid it.'", {
    expected: [true, true],
    actual: [(await b.alice.text(PAYMENTS)).includes("Confirmed by Bob Fictional, who paid it."), (await b.bob.text(PAYMENTS)).includes("Confirmed by Bob Fictional, who paid it.")],
  });
  trail("B (add while confirming, reloads)");

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
  trail("S7 (Carol confirms)");

  // ---- B: Alice turns the setting off in her card; Bob's Confirm disappears and the API refuses him -
  const s3 = (await api("bob").ok("group", { method: "POST", query: { ...q, action: "settle" }, body: { from: B, to: A, amount: "10.00" } })).settlement;
  await b.bob.reload(); await b.bob.goto("group");
  const before = await confirmButtons(b.bob, "Confirm You paid Alice Fictional");
  await b.alice.click({ label: "Anyone in the group can confirm payments", scope: SETTINGS });
  await b.alice.click({ role: "button", name: "Save settings", scope: SETTINGS });
  await b.alice.waitFor(`(() => { const box = document.querySelector('${SETTINGS} input[type="checkbox"]'); return !!box && box.checked === false; })()`, { what: "the setting to show off after saving" });
  await b.bob.reload(); await b.bob.goto("group");
  const after = await confirmButtons(b.bob, "Confirm You paid Alice Fictional");
  const bobSeesCard = await b.bob.evaluate(`!!document.querySelector('${SETTINGS}:not([hidden])')`);
  const direct = await api("bob").request("group", { method: "POST", query: { ...q, action: "confirm" }, body: { settlementId: s3.id, revision: s3.revision } });
  t.check("B: with the setting off (by Alice, in her card) Bob no longer sees Confirm on his own payment and the API refuses him; Bob sees no settings card", {
    expected: { before: 1, after: 0, bobSeesCard: false, direct: 403 }, actual: { before, after, bobSeesCard, direct: direct.status },
  });
  trail("B (setting off)");

  // ---- N1 + C: quick entry's Type choices follow the owed-entries setting ------------------------
  await b.alice.goto("transactions");
  await b.alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "quick entry" });
  const kindsDefault = await typeChoices(b.alice);
  await b.alice.click({ role: "button", name: "Cancel", scope: ".modal" });
  await b.alice.goto("group");
  await b.alice.click({ label: "Also allow entering them by hand", scope: SETTINGS });
  await b.alice.click({ role: "button", name: "Save settings", scope: SETTINGS });
  await b.alice.waitFor(`(() => { const r = [...document.querySelectorAll('${SETTINGS} input[type="radio"]')].find((x) => x.value === 'manual'); return !!r && r.checked; })()`, { what: "hand entry to show allowed" });
  await b.alice.reload(); await b.alice.goto("transactions");
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
  trail("N1/C (Type choices)");

  // ---- N2 + D: Bob's entries from Shared expenses on his Transactions page ------------------------
  await b.bob.goto("transactions");
  const rows = await b.bob.evaluate(`(() => [...document.querySelectorAll('tbody tr')].filter((r) => r.innerText.includes('Owed to others')).map((r) => ({
    buttons: [...r.querySelectorAll('button')].map((x) => x.textContent.trim()),
    marks: [...r.querySelectorAll('svg[data-icon]')].map((s) => s.getAttribute('data-icon')).filter((i) => ['no-money-moved', 'money-in', 'money-out'].includes(i)),
    amount: ((r.querySelector('td[data-label="Amount"]') || {}).innerText || '').replace(/\\s+/g, ' ').trim(),
    size: (() => { const s = r.querySelector('svg[data-icon="no-money-moved"]'); if (!s) return null; const q = s.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height)]; })(),
  })))()`);
  t.check("N2: Bob's owed entry offers Edit, but no Reverse or Delete", { expected: [["Edit"]], actual: rows.map((r) => r.buttons) });
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
  trail("N2/D (Bob's Transactions page)");
  const shots = [await b.bob.shot("owed-light")];
  await b.bob.cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }, { name: "prefers-reduced-motion", value: "reduce" }] });
  shots.push(await b.bob.shot("owed-dark"));
  await b.bob.cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  shots.push(await b.bob.shot("owed-390-dark"));
  await b.bob.cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }, { name: "prefers-reduced-motion", value: "reduce" }] });
  await b.bob.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  t.note(`screenshots of the |==| mark: ${shots.join(", ")}`);
  trail("screenshots");

  // ---- R1: Bob shares his wallet from his browser; recording on it stops --------------------------
  await b.bob.goto("group");
  const shared = await b.bob.evaluate(`(async () => {
    const accs = await (await fetch('/api/accounts?workspaceId=${W.id}')).json(); const w = accs.accounts.find((a) => a.id === '${wallet.id}');
    const r = await fetch('/api/accounts?workspaceId=${W.id}', { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-bt-request': '1' }, body: JSON.stringify({ accountId: w.id, revision: w.revision, visibility: 'shared', confirmShare: true }) });
    return r.status; })()`);
  trail("R1 (Bob's in-page share requests)");
  const walletEntries = async () => (await api("bob").ok("transactions", { query: { ...q, accountId: wallet.id } })).transactions.length;
  const beforeShare = await walletEntries();
  await api("alice").ok("group", { method: "POST", query: q, body: { description: "E2E taxi", amount: "20.00", payers: [{ ref: A }], split: eq(A, B) } });
  await api("bob").ok("group", { method: "POST", query: { ...q, action: "ledger" }, body: { currency: "EUR" } });
  const bobGroup = await api("bob").ok("group", { query: q });
  await b.bob.reload(); await b.bob.goto("group");
  t.check("R1: after Bob shares his wallet in his browser, Alice's taxi and Bob's update write nothing there and no link remains", {
    expected: { share: 200, entriesAfter: beforeShare, link: undefined, notice: false },
    actual: { share: shared, entriesAfter: await walletEntries(), link: bobGroup.myLedgers, notice: (await b.bob.text("body")).includes("Your account needs updating") },
  });
  trail("R1 (after reload)");

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
  const archiveId = (await api("alice").ok("backups", { method: "POST", query: R.q, body: {} })).archive.archiveId;
  const created = (await api("alice").ok("restore", { method: "POST", query: { action: "execute" }, body: { workspaceId: R.id, archiveId, mode: "create-new" } })).workspace;
  t.note(`workspace ${R.name}: ${R.id}; its create-new copy ${created.name}: ${created.id}`);
  // The isolated server keeps its storage in <dataRoot>/dev-data (scripts/dev/dataroot.mjs).
  const file = [path.join(h.server.dataRoot, "dev-data", "workspaces", created.id, "workspace.json"), path.join(h.server.dataRoot, "workspaces", created.id, "workspace.json")].find((p) => fs.existsSync(p)) || "";
  const text = file ? fs.readFileSync(file, "utf8") : "";
  t.check("S4: the new workspace's stored document holds no subject, member id or private account of Bob, and keeps Alice's own", {
    expected: { read: true, bobSubject: false, bobMemberId: false, bobWallet: false, aliceSubject: true },
    actual: { read: !!text, bobSubject: text.includes("google:dev-bob"), bobMemberId: text.includes(R.memberOf("bob").id), bobWallet: text.includes(bobWallet.id), aliceSubject: text.includes("google:dev-alice") },
  });
  const inv = await api("alice").ok("invitations", { method: "POST", query: { workspaceId: created.id }, body: { email: "bob@example.com", role: "member" } });
  await api("bob").ok("invitations", { method: "POST", query: { action: "accept" }, body: { workspaceId: created.id, token: inv.token } });
  const oldEntry = (await api("bob").ok("transactions", { query: { workspaceId: created.id } })).transactions.find((x) => x.id === bobsEntry.id);
  await b.bob.reload(); await b.bob.useWorkspace(created.name); await b.bob.goto("transactions");
  const bobRow = await b.bob.evaluate(`(() => { const r = [...document.querySelectorAll('tbody tr')].find((x) => x.innerText.includes('EUR 12.00')); return r ? [...r.querySelectorAll('button')].map((x) => x.textContent.trim()) : null; })()`);
  t.check("S4: invited into the restored workspace, Bob does not own his old entry — createdBySelf false and no Edit or Delete in his browser", {
    expected: { createdBySelf: false, buttons: [] }, actual: { createdBySelf: oldEntry ? oldEntry.createdBySelf : "missing", buttons: bobRow },
  });
  trail("S4 (Bob in the restored workspace)");

  // ---- every browser stayed clean -----------------------------------------------------------------
  for (const s of Object.values(b)) t.check(`${s.name}: no exceptions, console errors or failed requests in the browser`, { expected: [], actual: s.problems() });
}
