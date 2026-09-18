// TRANSACTIONS → MERCHANT (Terry, 2026-09-18, following the same Bills → Merchant consistency fix,
// BT-014-11/BT-007-01): the quick-entry "Add expense" form's own Merchant field must be the SAME
// shared command picker every other dropdown in the app uses (`.cmdpick__trigger`, BT-004-05) —
// never a bespoke lookalike — proven here with real DOM/screenshot evidence exactly like
// scripts/dev/e2e/bills.mjs already does for the bill editor's own Merchant field.
//
// Unlike a bill's own term, a real transaction always needs a REAL merchant (BT-007-01: managed
// directory records, never free text) — so `allowCustom` (commandpicker.js A16) is OFF here. What
// this scenario proves instead: searching for and selecting an EXISTING merchant still works
// exactly as before; typing a brand-new name offers the same "+ Add merchant" pinned action the
// Account picker's own "+ New account" already uses, opening the form's EXISTING inline "New
// merchant" fieldset (unchanged by this fix — only the dropdown above it is now the shared
// component); the existing duplicate-merchant "Use X" / "Add as a separate merchant" recovery path
// still works; and switching to an account that cannot use the chosen merchant still clears it with
// the same accessible announcement as before.
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";

export const name = "transactions";
export const title = "Transactions quick-entry Merchant field: same command picker as Category, existing-merchant search, inline new-merchant creation, duplicate handling, and the account-change clear, all in a real browser";
export const needsBrowser = true;

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Transactions Household", kind: "household" });
  const q = W.q;
  const alice = h.api("alice");
  // A shared and a private account: the merchant filter (choosableMerchants) depends on which one
  // is currently selected, exactly the distinction the account-change-clears-the-merchant check needs.
  const sharedAccount = firstRecord(await alice.ok("accounts", { method: "POST", query: q, body: { name: "E2E Shared Checking", type: "checking", currency: "USD", visibility: "shared", openingBalance: "1000.00" } }));
  const privateAccount = firstRecord(await alice.ok("accounts", { method: "POST", query: q, body: { name: "E2E Private Checking", type: "checking", currency: "USD", visibility: "private", openingBalance: "500.00" } }));
  // A shared merchant (choosable on either account) and a private one owned by alice (choosable
  // only on HER OWN account, never the shared one).
  const sharedMerchant = firstRecord(await alice.ok("payees", { method: "POST", query: q, body: { name: "E2E Shared Merchant", visibility: "shared" } }));
  const privateMerchant = firstRecord(await alice.ok("payees", { method: "POST", query: q, body: { name: "E2E Private Merchant", visibility: "private" } }));
  t.note(`workspace ${W.name}: ${W.id}; shared account ${sharedAccount.id}, private account ${privateAccount.id}; shared merchant ${sharedMerchant.id}, private merchant ${privateMerchant.id}`);

  const b = await h.browsers(["alice"], { prefix: "transactions-" });
  await b.alice.open("dashboard");
  await b.alice.useWorkspace(W.name);
  await b.alice.goto("transactions");
  await b.alice.waitForText("Add expense", { scope: "main" });

  const byLabelValue = (s, label, scope = ".modal") => s.evaluate(`(() => {
    const l = [...document.querySelectorAll(${JSON.stringify(scope)} + " label")].find((x) => x.textContent === ${JSON.stringify(label)});
    const target = l && document.getElementById(l.getAttribute("for"));
    if (!target) return null;
    const cmdValue = target.querySelector && target.querySelector(".cmdpick__value");
    return cmdValue ? cmdValue.textContent : target.value;
  })()`);

  // ---- Terry, 2026-09-18 (verbatim): "what i did ask for was the drop down to look like that of
  // the category field ... I KEEP CALLING FOR CONSISTENCY" — real DOM proof, not just behaviour. ---
  await b.alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the Add expense dialog" });
  const consistency = await b.alice.evaluate(`(() => {
    const byLabel = (t) => { const l = [...document.querySelectorAll(".modal label")].find((x) => x.textContent === t); return l && document.getElementById(l.getAttribute("for")); };
    const merchant = byLabel("Merchant");
    const category = byLabel("Category");
    return {
      merchantIsCmdpickTrigger: !!(merchant && merchant.classList.contains("cmdpick__trigger")),
      categoryIsCmdpickTrigger: !!(category && category.classList.contains("cmdpick__trigger")),
      sameTagName: !!(merchant && category && merchant.tagName === category.tagName),
      noBespokeMarkup: !document.querySelector(".combo, .combo__list, .combo__option"),
    };
  })()`);
  const shotConsistency = await b.alice.shot("transactions-merchant-matches-category");
  t.check("Merchant's trigger is the SAME .cmdpick__trigger component Category uses, both <button> elements, no bespoke combobox markup anywhere on the page", {
    expected: { merchantIsCmdpickTrigger: true, categoryIsCmdpickTrigger: true, sameTagName: true, noBespokeMarkup: true },
    actual: consistency,
  });
  t.note(`screenshot: ${shotConsistency}`);

  // ---- searching for and selecting an EXISTING merchant still works exactly as before -------------
  await b.alice.choose("Account", "E2E Shared Checking (USD)", { scope: ".modal" });
  await b.alice.choose("Merchant", "E2E Shared Merchant", { scope: ".modal" });
  const sharedSelected = await byLabelValue(b.alice, "Merchant");
  t.check("selecting an existing merchant from the search-filtered list sets the field, exactly like Category's own search", { expected: "E2E Shared Merchant", actual: sharedSelected });

  // ---- a merchant no longer choosable on a different account is cleared, with the same
  // accessible announcement as before (the logic moved when the dropdown was rebuilt; this proves
  // the behaviour survived the move, not just the look) -------------------------------------------
  await b.alice.choose("Account", "E2E Private Checking (USD)", { scope: ".modal" });
  await b.alice.choose("Merchant", "E2E Private Merchant", { scope: ".modal" });
  const privateSelected = await byLabelValue(b.alice, "Merchant");
  t.check("a private merchant is choosable on its owner's own private account", { expected: "E2E Private Merchant", actual: privateSelected });
  await b.alice.choose("Account", "E2E Shared Checking (USD)", { scope: ".modal" });
  const afterAccountSwitch = await byLabelValue(b.alice, "Merchant");
  t.check("switching to a shared account clears a private merchant that account cannot use", { expected: "Choose a merchant…", actual: afterAccountSwitch });
  await b.alice.waitFor("document.getElementById('a11y-live') && document.getElementById('a11y-live').textContent.includes('The merchant was cleared')", { what: "the merchant-cleared announcement" });

  // ---- typing a brand-new name offers the SAME "+ Add merchant" pinned action the Account
  // picker's own "+ New account" already uses, opening the EXISTING inline "New merchant" fieldset
  // (unchanged by this fix) rather than a left-as-typed draft (a real entry always needs a real
  // merchant, BT-007-01 — unlike a bill's own term, BT-014-11) ---------------------------------------
  const merchantTrigger = await b.alice.locate({ css: ".cmdpick__trigger", label: "Merchant", scope: ".modal" });
  await b.alice.mouseClick(merchantTrigger.x, merchantTrigger.y);
  await b.alice.waitFor("!!document.querySelector('.cmdpick__panel:not([hidden])')", { what: "the Merchant list to open" });
  const search = await b.alice.locate({ css: ".cmdpick__search" });
  await b.alice.mouseClick(search.x, search.y);
  await b.alice.cdp.send("Input.insertText", { text: "E2E Brand New Merchant" });
  await b.alice.settle({ quiet: 150 });
  const noMatch = await b.alice.evaluate("(() => { const p = document.querySelector('.cmdpick__none'); return p ? p.textContent : null; })()");
  t.check("a brand-new name matches nothing in the real merchant list", { expected: true, actual: /Nothing matches/.test(noMatch || "") });
  await b.alice.waitForText("Add merchant “E2E Brand New Merchant”", { scope: ".modal" });
  await b.alice.click({ text: "Add merchant “E2E Brand New Merchant”", scope: ".modal" });
  await b.alice.waitFor("(() => { const f = document.querySelector('.modal .inline-create'); return !!f && !f.hidden; })()", { what: "the inline New merchant fieldset to open" });
  const inlineState = await b.alice.evaluate(`(() => {
    const f = document.querySelector(".modal .inline-create");
    const legend = f.querySelector("legend");
    const nameInput = f.querySelector('input[maxlength="80"]');
    return { legend: legend ? legend.textContent : null, prefill: nameInput ? nameInput.value : null, focused: document.activeElement === nameInput, scopeNote: f.querySelector(".field__help") ? f.querySelector(".field__help").textContent : null };
  })()`);
  t.check("the inline 'New merchant' fieldset opens prefilled with the typed name, focused, and explains it will be shared (a shared account is selected)", {
    expected: { legend: "New merchant", prefill: "E2E Brand New Merchant", focused: true, scopeNote: "It will be shared with the workspace, because this account is shared." },
    actual: inlineState,
  });
  const shotInline = await b.alice.shot("transactions-inline-new-merchant");
  await b.alice.click({ role: "button", name: "Add merchant", scope: ".modal .inline-create" });
  await b.alice.waitFor("(() => { const f = document.querySelector('.modal .inline-create'); return !f || f.hidden; })()", { what: "the inline fieldset to close after creating" });
  const afterCreate = await byLabelValue(b.alice, "Merchant");
  t.check("the newly created merchant is selected in the Merchant field right away", { expected: "E2E Brand New Merchant", actual: afterCreate });
  t.note(`screenshot: ${shotInline}`);
  await b.alice.fill("Amount (USD)", "42.00");
  await b.alice.click({ role: "button", name: "Save expense", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the Add expense dialog to close after saving" });
  await b.alice.settle();
  const created = (await alice.ok("transactions", { query: q })).transactions.find((x) => x.amount === "-42.00");
  const newMerchant = created ? (await alice.ok("payees", { query: q })).payees.find((p) => p.id === created.payeeId) : null;
  t.check("the saved entry really links the newly created merchant, verified directly against the API (never trusting the label alone)", {
    expected: { found: true, merchantName: "E2E Brand New Merchant", visibility: "shared" },
    actual: { found: !!created, merchantName: newMerchant && newMerchant.name, visibility: newMerchant && newMerchant.visibility },
  });

  // ---- the existing duplicate-merchant recovery path still works: typing the EXACT name of a
  // real merchant and using "+ Add merchant" anyway offers "Use X" instead of creating a duplicate.
  // This exercises the SAME pinned action this fix rewired, so it is real regression coverage, not
  // an unrelated feature check. ------------------------------------------------------------------
  await b.alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "a second Add expense dialog" });
  const merchantTrigger2 = await b.alice.locate({ css: ".cmdpick__trigger", label: "Merchant", scope: ".modal" });
  await b.alice.mouseClick(merchantTrigger2.x, merchantTrigger2.y);
  await b.alice.waitFor("!!document.querySelector('.cmdpick__panel:not([hidden])')", { what: "the Merchant list to open" });
  const search2 = await b.alice.locate({ css: ".cmdpick__search" });
  await b.alice.mouseClick(search2.x, search2.y);
  await b.alice.cdp.send("Input.insertText", { text: "E2E Shared Merchant" });
  await b.alice.settle({ quiet: 150 });
  await b.alice.waitForText("Add merchant “E2E Shared Merchant”", { scope: ".modal" });
  await b.alice.click({ text: "Add merchant “E2E Shared Merchant”", scope: ".modal" });
  await b.alice.waitFor("(() => { const f = document.querySelector('.modal .inline-create'); return !!f && !f.hidden; })()", { what: "the inline fieldset to open" });
  await b.alice.click({ role: "button", name: "Add merchant", scope: ".modal .inline-create" });
  await b.alice.waitFor("(() => { const box = document.querySelector('.modal .inline-create'); return !!box && [...box.querySelectorAll('button')].some((b) => b.textContent.startsWith('Use E2E Shared Merchant')); })()", { what: "the duplicate-merchant recovery buttons" });
  const duplicateOffer = await b.alice.evaluate(`(() => {
    const box = document.querySelector(".modal .inline-create");
    return [...box.querySelectorAll("button")].map((b) => b.textContent);
  })()`);
  t.check("creating a merchant with an EXISTING name offers 'Use it' instead of silently creating a duplicate", {
    expected: true, actual: duplicateOffer.some((x) => x.startsWith("Use E2E Shared Merchant")),
  });
  t.check("also offers creating a genuinely separate merchant with the same name, never forced either way", {
    expected: true, actual: duplicateOffer.includes("Add as a separate merchant"),
  });
  const useExistingLabel = duplicateOffer.find((x) => x.startsWith("Use E2E Shared Merchant"));
  await b.alice.click({ text: useExistingLabel, scope: ".modal .inline-create" });
  await b.alice.waitFor("(() => { const f = document.querySelector('.modal .inline-create'); return !f || f.hidden; })()", { what: "the inline fieldset to close after using the existing merchant" });
  const usedExisting = await byLabelValue(b.alice, "Merchant");
  t.check("'Use E2E Shared Merchant' resolves to the real existing merchant, not a new one", { expected: "E2E Shared Merchant", actual: usedExisting });
  await b.alice.press("Escape");
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close (never saved — only proving the duplicate-recovery path)" });

  const merchantsAfter = (await alice.ok("payees", { query: q })).payees.filter((p) => p.name === "E2E Shared Merchant");
  t.check("no duplicate 'E2E Shared Merchant' was created by any of this", { expected: 1, actual: merchantsAfter.length });

  // The one expected non-2xx response: the server's own deliberate 409 when the duplicate-name
  // check fires (the "Use X" recovery path just proven above handles it correctly) — everything
  // else must still be clean.
  t.check("alice: no exceptions, console errors or failed requests in the browser", {
    expected: [], actual: b.alice.problems({ allowHttp: [{ status: 409, path: /\/api\/payees(\?|$)/ }] }),
  });
}
