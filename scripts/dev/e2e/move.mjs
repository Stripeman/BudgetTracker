// MOVE TO ANOTHER ACCOUNT (BT-006-05; Terry, 2026-09-14: "on a transaction i should be able to move
// a transaction from one account to the next if i accidently choose the wrong account in the first
// place"). Alice records a 40.00 expense on the wrong private account and moves it to the right one
// in her browser; both balances update on her Accounts page and the History dialog shows the move.
// Bob cannot move Alice's private entry (API refusal). Alice then moves the same entry from her
// private account onto the shared account, and it appears in Bob's browser.
//
// Hand-computed expectations (independent of the app's arithmetic):
//   Alice Checking 500.00, Alice Wallet 200.00; a 40.00 expense recorded on Checking by mistake
//     before the move: Checking 460.00, Wallet 200.00
//     after moving it to Wallet: Checking 500.00, Wallet 160.00
//   E2E Joint 800.00; moving the entry from Wallet to Joint
//     after: Wallet 200.00, Joint 760.00
//
// Runs inside the SEEDED "Fictional Household" (Alice owner, Bob member already) rather than
// creating a new workspace: workspace creation is rate-limited per person per day (SEC-T4), and the
// full `npm run e2e` suite already creates several on Alice's behalf across the other scenarios.

export const name = "move";
export const title = "Move an entry to another account: balances follow in Alice's browser, the history records it, Bob cannot move her private entry, moving to the shared account makes it appear for Bob";
export const needsBrowser = true;

const CHECKING = "E2E Move Checking";
const WALLET = "E2E Move Wallet";
const JOINT = "E2E Move Joint";
// A tag, not notes: the Transactions row shows each entry's tags directly, but never its notes.
const TAG = "e2e-move-fictional-groceries";

const accountBalances = async (s) => s.evaluate(`(() => { const rows = [...document.querySelectorAll('tbody tr')];
  const of = (name) => { const r = rows.find((x) => x.textContent.includes(name)); return r ? (r.querySelector('td[data-label="Balance"]') || {}).innerText || null : null; }; return { checking: of(${JSON.stringify(CHECKING)}), wallet: of(${JSON.stringify(WALLET)}), joint: of(${JSON.stringify(JOINT)}) }; })()`);

// BT-015: "Move" (renamed from "Move to another account") and "History" are inside the row's own
// compact "::" actions menu now, never an inline row button. The seeded "Fictional Household" this
// run's other scenarios also use already has many rows, so a plain text/role match alone would be
// ambiguous — open the ONE row's own menu first (found by `rowText`), then click the item by its
// exact visible text, scoped to that now-open panel.
async function clickInRow(s, rowText, buttonText) {
  await s.openRecordMenu(rowText, { scope: "main" });
  await s.click({ text: buttonText, scope: ".actionsmenu__panel:not([hidden])" });
}

export async function run(h, t) {
  const alice = h.api("alice");
  const seeded = ((await alice.ok("workspaces")).workspaces || []).find((w) => w.name === "Fictional Household");
  if (!seeded) { t.skip("move in the browser", "the seeded Fictional Household workspace was not found"); return; }
  const W = { id: seeded.id, name: seeded.name, q: { workspaceId: seeded.id } };
  const checking = (await alice.ok("accounts", { method: "POST", query: W.q, body: { name: CHECKING, type: "checking", currency: "EUR", openingBalance: "500.00" } })).account;
  const wallet = (await alice.ok("accounts", { method: "POST", query: W.q, body: { name: WALLET, type: "cash", currency: "EUR", openingBalance: "200.00" } })).account;
  const joint = (await alice.ok("accounts", { method: "POST", query: W.q, body: { name: JOINT, type: "checking", currency: "EUR", visibility: "shared", openingBalance: "800.00" } })).account;

  const b = await h.browsers(["alice", "bob"], { prefix: "move-" });
  await b.alice.open("transactions");
  await b.alice.useWorkspace(W.name);
  await b.alice.goto("transactions");
  if (!(await b.alice.exists(".page-head"))) { t.skip("move in the browser", "the Transactions page is not present at this commit"); return; }

  // ---- 1. Alice records the expense on the WRONG account (Checking, meant for Wallet) --------------
  await b.alice.click({ role: "button", name: "Add expense" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the Add expense dialog" });
  await b.alice.choose("Account", `${CHECKING} (EUR)`, { scope: ".modal" });
  await b.alice.fill({ css: 'input[placeholder="0.00 or 12.50+3.20"]', scope: ".modal" }, "40.00");
  await b.alice.click({ css: ".more summary", scope: ".modal" });
  await b.alice.fill({ label: "Tags", scope: ".modal" }, TAG);
  await b.alice.click({ role: "button", name: "Save expense", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await b.alice.waitForText(TAG);
  await b.alice.shot("1-wrong-account");

  await b.alice.goto("accounts");
  await b.alice.waitForText(CHECKING);
  const before = await accountBalances(b.alice);
  t.check("alice: before the move, Checking 460.00 (500.00 − 40.00) and Wallet unchanged at 200.00", { expected: { checking: "EUR 460.00", wallet: "EUR 200.00" }, actual: { checking: before.checking, wallet: before.wallet } });

  // ---- 2. Alice moves it to the right account (Wallet) in her browser -------------------------------
  await b.alice.goto("transactions");
  await b.alice.waitForText(TAG);
  await clickInRow(b.alice, TAG, "Move");
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the Move to another account dialog" });
  const reasonPrefill = (await b.alice.locate({ label: "Reason", scope: ".modal" })).value;
  t.check("alice: the reason is pre-filled “Wrong account”", { expected: "Wrong account", actual: reasonPrefill });
  await b.alice.choose("Move to", `${WALLET} (EUR)`, { scope: ".modal" });
  const impactText = await b.alice.text(".modal");
  t.check("alice: the dialog names both accounts and the balances they would go to", {
    expected: true, actual: /460\.00.*500\.00.*Wallet/s.test(impactText) || (impactText.includes(CHECKING) && impactText.includes(WALLET) && impactText.includes("500.00") && impactText.includes("160.00")),
  });
  await b.alice.shot("2-move-dialog");
  await b.alice.click({ role: "button", name: "Move entry", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after moving" });

  await b.alice.goto("accounts");
  await b.alice.waitForText(CHECKING);
  const after = await accountBalances(b.alice);
  t.check("alice: after the move, Checking is back to 500.00 and Wallet is 160.00 (200.00 − 40.00)", { expected: { checking: "EUR 500.00", wallet: "EUR 160.00" }, actual: { checking: after.checking, wallet: after.wallet } });
  await b.alice.shot("3-after-move-accounts");

  // ---- 3. The history shows the move ----------------------------------------------------------------
  await b.alice.goto("transactions");
  await b.alice.waitForText(TAG);
  await clickInRow(b.alice, TAG, "History");
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the History dialog" });
  await b.alice.waitForText("Wrong account", { scope: ".modal" });
  const historyText = await b.alice.text(".modal");
  t.check("alice: the History dialog records the move from Checking to Wallet with her reason", {
    expected: true, actual: /Account:\s*E2E Move Checking\s*→\s*E2E Move Wallet/.test(historyText.replace(/\s+/g, " ")) && historyText.includes("Wrong account"),
  });
  await b.alice.shot("4-history");
  await b.alice.click({ role: "button", name: "Close", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the History dialog to close" });

  const entryId = ((await alice.ok("transactions", { query: { ...W.q, accountId: wallet.id } })).transactions || []).find((x) => (x.tags || []).includes(TAG));
  t.check("API (control): the entry is now on the Wallet account", { expected: wallet.id, actual: entryId && entryId.accountId });

  // ---- 4. Bob cannot move Alice's private entry ------------------------------------------------------
  const bob = h.api("bob");
  const bobAttempt = await bob.request("transactions", { method: "POST", query: { ...W.q, action: "move" }, body: { transactionId: entryId.id, revision: entryId.revision, toAccountId: checking.id, reason: "Trying anyway" } });
  t.check("bob: cannot move Alice's private entry through the API (not found, no id or account name of hers revealed)", {
    expected: { status: 404, leaked: [] },
    actual: { status: bobAttempt.status, leaked: [CHECKING, WALLET, checking.id, wallet.id, entryId.id].filter((s) => bobAttempt.text.includes(s)) },
  });
  await b.bob.open("transactions");
  await b.bob.useWorkspace(W.name);
  await b.bob.goto("transactions");
  const bobText = await b.bob.text();
  t.check("bob: sees nothing of Alice's private entry or accounts in his browser", { expected: [], actual: [TAG, CHECKING, WALLET].filter((x) => bobText.includes(x)) });

  // ---- 5. Alice moves the entry onto the shared account; it appears for Bob ---------------------------
  await b.alice.goto("transactions");
  await b.alice.waitForText(TAG);
  await clickInRow(b.alice, TAG, "Move");
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the Move to another account dialog" });
  await b.alice.choose("Move to", `${JOINT} (EUR)`, { scope: ".modal" });
  const visibilityNote = await b.alice.text(".modal");
  t.check("alice: told that moving to the shared account makes the entry visible to everyone who can see it", {
    expected: true, actual: visibilityNote.includes("Moving to a shared account makes this entry visible to everyone who can see that account."),
  });
  await b.alice.shot("5-move-to-shared-dialog");
  await b.alice.click({ role: "button", name: "Move entry", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after moving" });

  await b.bob.goto("dashboard");
  await b.bob.goto("transactions");
  await b.bob.waitForText(TAG);
  t.check("bob: after the move to the shared account, he sees the entry in his own browser", { expected: true, actual: (await b.bob.text()).includes(TAG) });
  await b.bob.shot("6-bob-sees-it-after-move-to-shared");
  const bobJoint = await bob.ok("accounts", { query: W.q });
  const jointRow = (bobJoint.accounts || []).find((a) => a.name === JOINT);
  t.check("API: the shared Joint account now shows 760.00 (800.00 − 40.00)", { expected: "760.00", actual: jointRow && jointRow.balance });

  for (const user of ["alice", "bob"]) {
    t.check(`${user}: no exceptions, console errors or failed requests in the browser`, { expected: [], actual: b[user].problems() });
  }
}
