// PERMANENT DELETION, RENAME AND CASCADE UI (BT-014-04, Terry 2026-09-17: "Users must have
// meaningful control over their own data... including permanently deleting records when needed").
// Real browser, fictional data only. Carol (owner — alice and bob already own or co-own several
// throwaway workspaces in other scenarios, and workspace creation is bounded to 10 a day per
// person, SEC-R5) permanently deletes an account with one entry (the impact dialog, wrong-then-
// right confirmation phrase); a branching account (transactions AND a bill) shows a blocked dialog
// with no enabled delete action and no confirmation field; an account linked to a solely-owned
// Shared expense shows the "Download before continuing" / "Continue without downloading" offer
// before the confirmation step, and the shared expense survives with its amount unchanged; Carol
// sees the PERMANENT workspace-deletion card as unmistakably distinct from the existing recoverable
// "Delete workspace" card and permanently deletes her own throwaway workspace, after which Bob (a
// member) loses access entirely; Dave (site administrator) reaches the new Workspaces directory
// (counts only, never a name) and administratively permanently deletes a second throwaway
// workspace he was never a member of, after which its owner (Bob) loses access too.
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";

export const name = "permanentdelete";
export const title = "BT-014-04: permanent deletion (impact dialog, blocked case, Shared-expenses download offer), the distinct PERMANENT workspace-delete card, and the site-admin Workspaces directory";
export const needsBrowser = true;

const MODAL = ".modal";
const modalGone = (s, what) => s.waitFor("!document.querySelector('.modal')", { what });
const modalText = (s) => s.evaluate("(() => { const m = document.querySelector('.modal'); return m ? m.innerText : ''; })()");
const footButtons = (s) => s.evaluate("[...document.querySelectorAll('.modal .modal__foot button')].map((b) => b.textContent)");
const modalButtons = (s) => s.evaluate("[...document.querySelectorAll('.modal button')].map((b) => b.textContent)");

export async function run(h, t) {
  const api = (u) => h.api(u);

  // ---- fixtures --------------------------------------------------------------------------------
  const W = await createWorkspace(h, { owner: "carol", name: "E2E Permanent Delete Household", kind: "household", members: { bob: "member" } });
  const q = W.q;
  const wallet = firstRecord(await api("carol").ok("accounts", { method: "POST", query: q, body: { name: "E2E Perm Wallet", type: "cash", currency: "EUR", openingBalance: "20.00" } }));
  await api("carol").ok("transactions", { method: "POST", query: q, body: { accountId: wallet.id, kind: "expense", amount: "5.00", notes: "E2E one entry" } });

  const branching = firstRecord(await api("carol").ok("accounts", { method: "POST", query: q, body: { name: "E2E Perm Branching", type: "checking", currency: "EUR", openingBalance: "100.00" } }));
  await api("carol").ok("transactions", { method: "POST", query: q, body: { accountId: branching.id, kind: "expense", amount: "3.00" } });
  await api("carol").ok("recurring", { method: "POST", query: q, body: { name: "E2E Perm Bill", accountId: branching.id, amount: "9.00", schedule: { freq: "monthly", startDate: "2026-10-01" } } });

  const shared = firstRecord(await api("carol").ok("accounts", { method: "POST", query: q, body: { name: "E2E Perm Shared Link", type: "savings", currency: "EUR", openingBalance: "0.00" } }));
  const members = (await api("carol").ok("members", { query: q })).members;
  const carolRef = `member:${members.find((m) => m.name.startsWith("Carol")).id}`;
  const expense = (await api("carol").ok("group", {
    method: "POST", query: q,
    body: { description: "E2E solo grocery run", amount: "40.00", payers: [{ ref: carolRef }], split: { method: "equal", lines: [{ ref: carolRef }] }, ledger: { accountId: shared.id } },
  })).expense;
  t.note(`workspace ${W.name}: ${W.id}`);

  const b = await h.browsers(["carol", "bob", "dave"], { prefix: "permdel-" });
  await b.carol.open("accounts");
  await b.carol.useWorkspace(W.name);
  await b.bob.open("dashboard");
  await b.bob.useWorkspace(W.name);

  // ---- 1. an account with one entry: impact, wrong phrase refused, right phrase deletes it -------
  await b.carol.goto("accounts");
  await b.carol.waitForText("E2E Perm Wallet", { scope: "main" });
  await b.carol.click({ role: "button", name: "Permanently delete E2E Perm Wallet" });
  await b.carol.waitFor("!!document.querySelector('.modal')", { what: "the impact dialog" });
  await b.carol.waitForText("1 entry will be permanently deleted with it.", { scope: MODAL });
  await b.carol.click({ role: "button", name: "Continue", scope: MODAL });
  await b.carol.waitForText('Type "E2E Perm Wallet" to confirm', { scope: MODAL });
  await b.carol.fill({ label: 'Type "E2E Perm Wallet" to confirm', scope: MODAL }, "not the right name");
  await b.carol.click({ role: "button", name: "Permanently delete", scope: MODAL });
  await b.carol.waitForText('Type "E2E Perm Wallet" exactly to confirm.', { scope: MODAL });
  const stillOpen1 = await b.carol.exists(MODAL);
  t.note(`screenshot of the wrong-phrase refusal: ${await b.carol.shot("permdel-wrong-phrase")}`);
  await b.carol.fill({ label: 'Type "E2E Perm Wallet" to confirm', scope: MODAL }, "E2E Perm Wallet");
  await b.carol.click({ role: "button", name: "Permanently delete", scope: MODAL });
  await modalGone(b.carol, "the dialog to close after deleting");
  await b.carol.settle();
  const walletGone = !(await api("carol").ok("accounts", { query: q })).accounts.some((a) => a.id === wallet.id);
  t.check("a wrong phrase is refused inside the dialog; the exact name permanently deletes it and closes the dialog", { expected: { stillOpen: true, gone: true }, actual: { stillOpen: stillOpen1, gone: walletGone } });

  // ---- 2. a branching account (its own transactions AND its own bill): blocked, no way forward ---
  await b.carol.goto("accounts");
  await b.carol.waitForText("E2E Perm Branching", { scope: "main" });
  await b.carol.click({ role: "button", name: "Permanently delete E2E Perm Branching" });
  await b.carol.waitFor("!!document.querySelector('.modal')", { what: "the blocked impact dialog" });
  await b.carol.waitForText("This cannot be permanently deleted yet.", { scope: MODAL });
  const blockedText = await modalText(b.carol);
  const blockedButtons = await footButtons(b.carol);
  t.note(`screenshot of the blocked dialog: ${await b.carol.shot("permdel-blocked")}`);
  // Keyboard: Escape closes it (nothing was ever enabled to confirm).
  await b.carol.press("Escape");
  await modalGone(b.carol, "Escape to close the blocked dialog");
  const stillThere = (await api("carol").ok("accounts", { query: q })).accounts.some((a) => a.id === branching.id);
  t.check("a blocked operation explains why and offers no enabled delete action (no Continue, no confirmation field); Escape closes it and nothing changed", {
    expected: { explains: true, buttons: ["Cancel"], stillThere: true },
    actual: { explains: blockedText.includes("more than one kind of related record"), buttons: blockedButtons, stillThere },
  });

  // ---- 3. an account linked to a solely-owned Shared expense: the download offer, then confirm ---
  await b.carol.goto("accounts");
  await b.carol.waitForText("E2E Perm Shared Link", { scope: "main" });
  await b.carol.click({ role: "button", name: "Permanently delete E2E Perm Shared Link" });
  await b.carol.waitFor("!!document.querySelector('.modal')", { what: "the impact dialog for the shared-linked account" });
  await b.carol.waitForText("Its Shared-expenses link will be disconnected.", { scope: MODAL });
  await b.carol.click({ role: "button", name: "Continue", scope: MODAL });
  await b.carol.waitForText("linked to Shared expenses", { scope: MODAL });
  const offerButtons = await modalButtons(b.carol);
  t.note(`screenshot of the download-before-continuing offer: ${await b.carol.shot("permdel-group-offer")}`);
  // BT-014-06: a real click on "Download as XLSX" in the real browser, not just a button-presence
  // check. offerGroupDownload() only calls onDone() (which advances the dialog to the typed-name
  // confirmation step) once the download's fetch/Blob/anchor-click path resolves without throwing;
  // if it had failed, the dialog would show the inline retry error and stay on the offer step
  // instead. Reaching the confirmation step is therefore itself real-browser proof the XLSX
  // download completed. The same authorized export is independently re-fetched here (a plain API
  // call, not through the browser) to inspect the actual bytes the button just downloaded.
  await b.carol.click({ role: "button", name: "Download as XLSX", scope: MODAL });
  await b.carol.waitForText('Type "E2E Perm Shared Link" to confirm', { scope: MODAL });
  const xlsxCheck = await api("carol").ok("group", { query: { ...q, action: "export", format: "xlsx" } });
  const xlsxBytes = Buffer.from(xlsxCheck.content, "base64");
  await b.carol.fill({ label: 'Type "E2E Perm Shared Link" to confirm', scope: MODAL }, "E2E Perm Shared Link");
  await b.carol.click({ role: "button", name: "Permanently delete", scope: MODAL });
  await modalGone(b.carol, "the dialog to close after deleting the shared-linked account");
  await b.carol.settle();
  const sharedAfter = await api("carol").ok("accounts", { query: q });
  const groupAfter = await api("carol").ok("group", { query: q });
  const survivor = groupAfter.expenses.find((e) => e.id === expense.id);
  t.check("downloading before continuing is offered in all four formats (never deleting by itself); a real XLSX download (clicked in the browser) is a well-formed ZIP/OOXML file with the correct mime and base64 encoding; after it, and confirming, the account is gone and the shared expense survives unchanged", {
    expected: {
      offered: true, xlsxMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsxEncoding: "base64", xlsxIsZip: true,
      accountGone: true, expenseSurvives: true, amount: "40.00",
    },
    actual: {
      offered: ["Download as CSV", "Download as JSON", "Download as XLSX", "Download as PDF", "Continue without downloading"].every((x) => offerButtons.includes(x)),
      xlsxMime: xlsxCheck.mime, xlsxEncoding: xlsxCheck.encoding, xlsxIsZip: xlsxBytes.subarray(0, 2).toString("latin1") === "PK",
      accountGone: !sharedAfter.accounts.some((a) => a.id === shared.id), expenseSurvives: !!survivor, amount: survivor && survivor.amount,
    },
  });

  // ---- 4. the PERMANENT workspace-deletion card: unmistakably distinct, owner only ----------------
  await b.carol.goto("workspace");
  await b.carol.waitForText("Permanently delete workspace (cannot be undone)", { scope: "main" });
  const cardHeadings = await b.carol.evaluate("[...document.querySelectorAll('section.card h2')].map((h) => h.textContent)");
  const permCardClass = await b.carol.evaluate("(() => { const s = document.querySelector('section[aria-labelledby=\"ws-delete-permanent\"]'); return s ? s.className : ''; })()");
  t.note(`screenshot of both workspace-deletion cards: ${await b.carol.shot("permdel-workspace-cards")}`);
  t.check("both the recoverable 'Delete workspace' card and the new PERMANENT one are present, with different headings and an extra style class on the permanent one", {
    expected: { hasRecoverable: true, hasPermanent: true, extraClass: true },
    actual: { hasRecoverable: cardHeadings.includes("Delete workspace"), hasPermanent: cardHeadings.includes("Permanently delete workspace (cannot be undone)"), extraClass: permCardClass.includes("card--danger-permanent") },
  });
  // Bob, a plain member, sees neither the recoverable nor the PERMANENT card.
  await b.bob.goto("workspace");
  const bobHeadings = await b.bob.evaluate("[...document.querySelectorAll('section.card h2')].map((h) => h.textContent)");
  t.check("a member sees neither the recoverable nor the PERMANENT deletion card", {
    expected: { hasRecoverable: false, hasPermanent: false },
    actual: { hasRecoverable: bobHeadings.includes("Delete workspace"), hasPermanent: bobHeadings.includes("Permanently delete workspace (cannot be undone)") },
  });

  await b.carol.click({ role: "button", name: "Permanently delete workspace…" });
  await b.carol.waitFor("!!document.querySelector('.modal')", { what: "the permanent workspace-deletion dialog" });
  await b.carol.waitForText("Everything in this workspace will be permanently deleted:", { scope: MODAL });
  await b.carol.click({ role: "button", name: "Continue", scope: MODAL });
  await b.carol.waitForText("This cannot be undone.", { scope: MODAL });
  await b.carol.waitForText("Take a backup first", { scope: MODAL });
  // Terry's own repro (2026-09-17): taking a backup writes its own audit entry into the workspace
  // document, which used to leave the dialog holding a now-stale impact token — confirming after a
  // backup always failed as stale and bounced the whole dialog back to its first step, forever.
  // Exercising the backup path for real here is exactly what would have caught that.
  await b.carol.click({ role: "button", name: "Take a backup first", scope: MODAL });
  await b.carol.waitForText("Backup taken.", { scope: MODAL });
  await b.carol.click({ role: "button", name: "Continue", scope: MODAL });
  // The workspace still has one surviving Shared expense (from step 3, deliberately left in place),
  // so the Shared-expenses download offer appears here too, exactly as it did for the single account.
  // Real-browser coverage of the other new binary format (PDF, BT-014-06): the same reasoning as
  // step 3's XLSX check — reaching the next step is proof the click-driven download succeeded — plus
  // an independent re-fetch of the same export to inspect the actual PDF bytes.
  await b.carol.waitForText("linked to Shared expenses", { scope: MODAL });
  await b.carol.click({ role: "button", name: "Download as PDF", scope: MODAL });
  await b.carol.waitForText(`Type "${W.name}" to confirm`, { scope: MODAL });
  const pdfCheck = await api("carol").ok("group", { query: { ...q, action: "export", format: "pdf" } });
  const pdfBytes = Buffer.from(pdfCheck.content, "base64");
  t.check("a real PDF download (clicked in the browser) is a well-formed PDF file with the correct mime and base64 encoding", {
    expected: { mime: "application/pdf", encoding: "base64", startsPdf: true, endsEof: true },
    actual: {
      mime: pdfCheck.mime, encoding: pdfCheck.encoding,
      startsPdf: pdfBytes.subarray(0, 5).toString("latin1") === "%PDF-",
      endsEof: /%%EOF\s*$/.test(pdfBytes.toString("latin1")),
    },
  });
  await b.carol.fill({ label: `Type "${W.name}" to confirm`, scope: MODAL }, W.name);
  await b.carol.click({ role: "button", name: "Permanently delete workspace", scope: MODAL });
  await modalGone(b.carol, "the dialog to close after permanently deleting the workspace");
  await b.carol.settle();

  const carolAfter = await api("carol").request("accounts", { query: q });
  const bobBefore = await api("bob").request("accounts", { query: q });
  t.check("after permanent deletion, the workspace is gone for the owner too, and for a member with no reload needed on the API", {
    expected: { carol: 404, bob: 404 }, actual: { carol: carolAfter.status, bob: bobBefore.status },
  });

  // ---- 5. site-admin Workspaces directory and administrative permanent deletion ------------------
  const W2 = await createWorkspace(h, { owner: "bob", name: "E2E Admin Permanent Delete", kind: "household" });
  await b.dave.open("dashboard");
  t.check("dave: an 'Workspaces' entry pointing at #/admin-workspaces exists in the DOM (account menu or nav)", { expected: true, actual: await b.dave.exists('a[href="#/admin-workspaces"]') });
  await b.dave.goto("admin-workspaces");
  await b.dave.waitForText("Workspaces", { scope: "main" });
  await b.dave.waitForText(W2.id, { scope: "main" });
  const directoryText = await b.dave.text("main");
  t.note(`screenshot of the site-admin Workspaces directory: ${await b.dave.shot("permdel-admin-directory")}`);
  t.check("the directory lists the throwaway workspace by id (counts only) and never shows its name", {
    expected: { hasId: true, hasName: false }, actual: { hasId: directoryText.includes(W2.id), hasName: directoryText.includes(W2.name) },
  });
  // Deliberate exception (Terry, 2026-09-17: "the workspace listing needs to have the real persons
  // email address shown"): bob's real email, not just a member count.
  t.check("the directory shows the workspace owner's real email address", { expected: true, actual: directoryText.includes("bob@example.com") });

  await b.dave.click({ role: "button", name: `Permanently delete workspace ${W2.id}` });
  await b.dave.waitFor("!!document.querySelector('.modal')", { what: "the admin permanent-delete dialog" });
  await b.dave.waitForText("Everything in this workspace will be permanently deleted:", { scope: MODAL });
  await b.dave.click({ role: "button", name: "Continue", scope: MODAL });
  // A site administrator confirms by the workspace's ID, never its name (security fix,
  // 2026-09-17: adminSafe mode omits `label` and sets `confirmPhrase` to the id, which the admin
  // already legitimately has from the directory) — unlike the owner's own flow, which confirms by
  // name. Confirming this in a real browser is the whole point of this step.
  await b.dave.waitForText(`Type "${W2.id}" to confirm`, { scope: MODAL });
  t.check("the site administrator is asked to confirm by the workspace's id, never its name", {
    expected: false, actual: (await b.dave.text(MODAL)).includes(W2.name),
  });
  await b.dave.fill({ label: `Type "${W2.id}" to confirm`, scope: MODAL }, W2.id);
  await b.dave.click({ role: "button", name: "Permanently delete workspace", scope: MODAL });
  await modalGone(b.dave, "the dialog to close after the administrative permanent deletion");
  await b.dave.settle();
  const bobAfter = await api("bob").request("accounts", { query: W2.q });
  t.check("a site administrator can permanently delete a workspace they were never a member of, reusing the exact same flow; its owner then loses access entirely", { expected: 404, actual: bobAfter.status });

  // Bug fix (Terry, 2026-09-17: "i deleted the workspace permanently and while it removed the data..
  // it didnt remove the workspace"): the directory row itself must be gone now, not just its data —
  // and with it, the button that used to offer to "delete" an already-empty workspace again. The
  // view already reloads itself after a successful delete (adminworkspaces.js's onDeleted), so no
  // extra navigation is needed here.
  const directoryAfterText = await b.dave.text("main");
  await b.dave.shot("permdel-admin-directory-after-delete");
  t.check("the permanently-deleted workspace no longer appears in the directory at all", { expected: false, actual: directoryAfterText.includes(W2.id) });
  t.check("its 'Delete permanently' button is gone with it (nothing left to click)", {
    expected: false, actual: await b.dave.exists(`button[aria-label="Permanently delete workspace ${W2.id}"]`),
  });

  for (const s of Object.values(b)) { await s.settle(); t.check(`${s.name}: no exceptions, console errors or failed requests in the browser`, { expected: [], actual: s.problems({ allowHttp: [{ status: 404, path: /\/api\/accounts/ }] }) }); }
}
