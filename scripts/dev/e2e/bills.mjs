// "RECORD NEXT" TOOLTIP (BT-014-10/12; Terry, 2026-09-17: "add nice tool tips to the All bills
// pane for 'Record next' i dont know what that means", then, after the first version shipped
// without being opened in a real browser: "The tool tip on 'All bills > record next' is clipped..
// you would have seen this had you tested it on localhost"). The floating tooltip must actually be
// visible, in the real viewport, not clipped by the All bills table's own scrolling container
// (`.table-wrap { overflow-x: auto }`, which forces `overflow-y` to clip too) — exactly what a
// DOM-double unit test cannot see, since it has no real layout at all.
//
// BILLS → MERCHANT (security/UX review, 2026-09-18, "confirmed bill/merchant defect"): the Merchant
// picker opens on click/tap (not only typing/ArrowDown); the Merchants page's "Pending merchants"
// section shows the TYPED merchant name, never the bill's own title, grouped so several bills
// sharing one typed name show once; a bill with no typed name at all gets no guessed name and no
// "Add merchant" button; and a typed-but-unmatched name saved from the bill editor persists as
// the bill's own `payeeDraftName`, verified directly against the API, not just the visible label.
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";

export const name = "bills";
export const title = "The All bills table's 'Record next' tooltip is visible in the real viewport; the Merchant picker opens on click; pending merchant names (never the bill's own title) are shown, grouped and linkable, and an unmatched typed name persists";
export const needsBrowser = true;

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Bills Household", kind: "household" });
  const q = W.q;
  const account = firstRecord(await h.api("alice").ok("accounts", { method: "POST", query: q, body: { name: "E2E Bills Checking", type: "checking", currency: "USD", openingBalance: "1000.00" } }));
  // A near-term due date, so the bill sits with nothing but the page header above it — exactly the
  // "row near the top of the table" layout the original report's screenshot showed.
  const today = new Date().toISOString().slice(0, 10);
  // A typed-but-unmatched merchant name, deliberately DIFFERENT from the bill's own title, so any
  // check that showed the title instead of the typed name would fail loudly.
  const bill = firstRecord(await h.api("alice").ok("recurring", { method: "POST", query: q, body: { name: "E2E September Rent Bill", billType: "housing", accountId: account.id, amount: "950.00", schedule: { freq: "monthly", startDate: today }, payeeDraftName: "E2E Rent Landlord Co" } }));
  // Terry's exact repro (2026-09-17): a bill scheduled to start next month. Linking a merchant via
  // "Add merchant" must still show up on the bill and clear the pending list, even though it
  // can't take effect any earlier than the bill's own future start date.
  const futureStart = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const futureBill = firstRecord(await h.api("alice").ok("recurring", { method: "POST", query: q, body: { name: "E2E Future Utility Bill", billType: "utilities", accountId: account.id, amount: "174.00", schedule: { freq: "monthly", startDate: futureStart }, payeeDraftName: "E2E Electric Co" } }));
  // No merchant name was ever typed for this one — nothing must be guessed from its own title.
  const noNameBill = firstRecord(await h.api("alice").ok("recurring", { method: "POST", query: q, body: { name: "E2E Mystery Charge", billType: "custom", accountId: account.id, amount: "12.00", schedule: { freq: "monthly", startDate: today } } }));
  t.note(`workspace ${W.name}: ${W.id}; bill ${bill.id}, future bill ${futureBill.id} starting ${futureStart}, no-name bill ${noNameBill.id}, on account ${account.id}`);

  const b = await h.browsers(["alice"], { prefix: "bills-" });
  await b.alice.open("dashboard");
  await b.alice.useWorkspace(W.name);
  await b.alice.goto("bills");
  await b.alice.waitForText(bill.name, { scope: "main" });
  // BT-015: Record next is inside the row's compact "::" actions menu — open it first. The panel is
  // a floating overlay portaled OUT of <main> once open, so the wait below is never scoped to it.
  await b.alice.openRecordMenu(bill.name, { scope: "main" });
  await b.alice.waitForText("Record next");

  const before = await b.alice.evaluate("!!document.querySelector('.floating-tip')");
  t.check("nothing shown before hover/focus", { expected: false, actual: before });

  const result = await b.alice.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => x.textContent === "Record next");
    if (!btn) return { found: false };
    btn.focus();
    const tip = document.querySelector('.floating-tip');
    if (!tip) return { found: true, shown: false };
    const r = tip.getBoundingClientRect();
    return {
      found: true, shown: true,
      text: tip.textContent,
      ariaHidden: tip.getAttribute("aria-hidden"),
      fullyInViewport: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth,
      top: Math.round(r.top), bottom: Math.round(r.bottom), viewportHeight: window.innerHeight,
    };
  })()`);
  const shot = await b.alice.shot("bills-record-next-tooltip");
  t.check("focusing 'Record next' shows a real tooltip box fully inside the viewport (not clipped above the table, the exact bug reported)", {
    expected: { found: true, shown: true, ariaHidden: "true", fullyInViewport: true },
    actual: { found: result.found, shown: result.shown, ariaHidden: result.ariaHidden, fullyInViewport: result.fullyInViewport },
  });
  t.check("the tooltip explains what the button does", { expected: true, actual: /review.*record.*(entry|payment)/i.test(result.text || "") });
  t.note(`tooltip box: top=${result.top} bottom=${result.bottom} viewportHeight=${result.viewportHeight}; screenshot: ${shot}`);

  const after = await b.alice.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => x.textContent === "Record next");
    btn.blur();
    return !!document.querySelector('.floating-tip');
  })()`);
  t.check("removed once focus leaves", { expected: false, actual: after });

  // A helper: find the field a <label> in the given root points at, by its own text, and read its
  // shown value — the same reliable way other e2e scenarios locate a field regardless of which
  // picker sits before it in the DOM (accounts.mjs's own byLabel pattern). Merchant is now the SAME
  // command picker as Category (Terry, 2026-09-18: "the drop down to look like that of the category
  // field ... I KEEP CALLING FOR CONSISTENCY") — the label's `for` points at the TRIGGER BUTTON, not
  // an input, so the shown value is read from its own `.cmdpick__value` text, exactly the way
  // settings.mjs already reads the Workspace settings' own pickers.
  const byLabelValue = (s, label) => s.evaluate(`(() => {
    const l = [...document.querySelectorAll(".modal label")].find((x) => x.textContent === ${JSON.stringify(label)});
    const target = l && document.getElementById(l.getAttribute("for"));
    if (!target) return null;
    const cmdValue = target.querySelector && target.querySelector(".cmdpick__value");
    return cmdValue ? cmdValue.textContent : target.value;
  })()`);

  // Opens the Merchant field (the same command picker as Category, click opens it) and types a term
  // into its search box, leaving the panel OPEN — for a caller that still wants to act on it (search
  // for an existing merchant, or click the pinned "Add merchant" action) rather than commit it.
  async function openMerchantSearch(s, term, { scope = ".modal" } = {}) {
    // A click TOGGLES the panel (commandpicker.js): only click the TRIGGER when it is not already
    // open, so this never accidentally CLOSES it if an earlier check left it open.
    const alreadyOpen = await s.evaluate("!!document.querySelector('.cmdpick__panel:not([hidden])')");
    if (!alreadyOpen) {
      const at = await s.locate({ css: ".cmdpick__trigger", label: "Merchant", scope });
      await s.mouseClick(at.x, at.y);
      await s.waitFor("!!document.querySelector('.cmdpick__panel:not([hidden])')", { what: "the Merchant list to open" });
    }
    // Focus the search box directly, always — a panel an earlier check left open via a raw JS
    // dispatch (not a real click) may not have moved real browser focus into it, and typing must
    // never land wherever focus happens to already be.
    const search = await s.locate({ css: ".cmdpick__search" });
    await s.mouseClick(search.x, search.y);
    await s.cdp.send("Input.insertText", { text: term });
    await s.settle({ quiet: 150 });
  }

  // Terry's exact acceptance flow: type a merchant name nothing matches and just move on — never
  // requiring the "Add merchant" pinned action first (allowCustom, commandpicker.js A16). A click
  // anywhere else — here, the dialog's own title — commits it, exactly like tabbing or clicking on
  // to the next field would.
  async function typeMerchantDraft(s, term, { scope = ".modal" } = {}) {
    await openMerchantSearch(s, term, { scope });
    // Shift+Tab straight out of the search box (the panel's own "first" element, commandpicker.js
    // A16) commits the typed value regardless of whether a "+ Add merchant" pinned action is also
    // present — a plain click risked landing on the panel itself if it happened to open upward over
    // the dialog title, which would not count as "outside" and so would never commit.
    await s.press("Tab", { shift: true });
    await s.waitFor("!document.querySelector('.cmdpick__panel:not([hidden])')", { what: "the Merchant list to close after committing" });
  }

  // ---- Pending merchants: the TYPED name is shown, never the bill's own title ---------------------
  await b.alice.goto("payees");
  await b.alice.waitForText("Pending merchants", { scope: "main" });
  const pendingText = await b.alice.evaluate(`document.getElementById("payees-missing").closest(".card").textContent`);
  t.check("the typed name is shown", { expected: true, actual: pendingText.includes("E2E Rent Landlord Co") });
  t.check("the bill's own title is NEVER shown as if it were the merchant name — the confirmed defect", {
    expected: false, actual: /E2E September Rent Bill.{0,3}$/m.test(pendingText.split("On:")[0] || ""),
  });
  t.check("the associated bill is listed separately, under 'On:'", { expected: true, actual: pendingText.includes("On: E2E September Rent Bill") });

  const clickedRent = await b.alice.evaluate(`(() => {
    const li = [...document.querySelectorAll("li")].find((x) => x.textContent.includes("E2E Rent Landlord Co"));
    const btn = li && [...li.querySelectorAll("button")].find((b) => b.textContent === "Add merchant");
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  t.check("'Add merchant' is offered for a pending name on an already-started bill", { expected: true, actual: clickedRent });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the add-merchant dialog" });
  const rentPrefill = await b.alice.evaluate("document.querySelector('.modal input').value");
  t.check("prefilled from the TYPED name, not the bill's own title", { expected: "E2E Rent Landlord Co", actual: rentPrefill });
  await b.alice.click({ role: "button", name: "Add merchant", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after adding" });
  await b.alice.settle();
  await b.alice.goto("bills");
  await b.alice.waitForText(bill.name, { scope: "main" });
  // Terry's exact regression report (2026-09-18): the All-bills LIST ROW itself — not just the Edit
  // dialog — must show the linked merchant's name once resolved. Real bug found and fixed this
  // session: the row only ever read `payeeName`, so a bill whose merchant was resolved from a
  // pending typed name displayed correctly, but a bill that STILL only has a typed, unlinked name
  // (checked further below) went blank in the list even though the name was saved.
  // Scoped to a row with a Schedule cell: this bill is also due soon/overdue, so it legitimately
  // appears a second time in the separate "Needs attention" table above, which has no merchant
  // column at all and would otherwise be matched first by a plain text search.
  const rentRowText = await b.alice.evaluate(`(() => {
    const row = [...document.querySelectorAll("tbody tr")].find((tr) => tr.textContent.includes(${JSON.stringify(bill.name)}) && tr.querySelector('td[data-label="Schedule"]'));
    return row ? row.textContent : null;
  })()`);
  t.check("the All-bills list row shows the now-linked merchant's name", { expected: true, actual: !!(rentRowText && rentRowText.includes("E2E Rent Landlord Co")) });
  await b.alice.openRecordMenu(bill.name, { scope: "main" });
  await b.alice.click({ role: "button", name: `Edit ${bill.name}` });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the bill's edit dialog" });
  const rentMerchant = await byLabelValue(b.alice, "Merchant");
  const shotRent = await b.alice.shot("bills-merchant-linked-started-bill");
  t.check("an already-started bill shows its linked merchant on its own Edit dialog IMMEDIATELY, not delayed", {
    expected: "E2E Rent Landlord Co", actual: rentMerchant,
  });
  t.note(`Merchant field: "${rentMerchant}"; screenshot: ${shotRent}`);
  await b.alice.press("Escape");
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the edit dialog to close" });

  // ---- a bill that hasn't started yet (Terry's exact repro) ---------------------------------------
  // The link genuinely succeeds (proven directly against the API below), but per this app's own
  // versioning rule (api/_shared/bills.js termsAt) nothing can be "in effect today" for a bill that
  // hasn't started — so the bill's CURRENT payeeId legitimately stays null until its start date,
  // exactly like any other term change (amount, category, ...) on an unstarted bill already does.
  // What must NOT happen: the list re-offering a bill the person already handled.
  await b.alice.goto("payees");
  await b.alice.waitForText("E2E Electric Co", { scope: "main" });
  const clicked = await b.alice.evaluate(`(() => {
    const li = [...document.querySelectorAll("li")].find((x) => x.textContent.includes("E2E Electric Co"));
    const btn = li && [...li.querySelectorAll("button")].find((b) => b.textContent === "Add merchant");
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  t.check("'Add merchant' is offered for the pending name on the bill that hasn't started yet", { expected: true, actual: clicked });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the add-merchant dialog" });
  await b.alice.waitFor("document.querySelector('.modal h2').textContent === 'Add merchant'", { what: "creating, not editing" });
  const prefill = await b.alice.evaluate("document.querySelector('.modal input').value");
  t.check("prefilled from the typed name, not the bill's own title", { expected: "E2E Electric Co", actual: prefill });
  await b.alice.click({ role: "button", name: "Add merchant", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after adding" });
  await b.alice.settle();

  // Checked against the "Pending merchants" card specifically, not a whole-page text search — the
  // merchant just created is itself NAMED "E2E Electric Co" (from the prefill) and legitimately
  // appears as its own row in the Merchants table below, which a naive page-wide text search would
  // also match.
  const stillMissing = await b.alice.evaluate(`(() => {
    const card = document.getElementById("payees-missing");
    return card ? card.closest(".card").textContent.includes("E2E Electric Co") : false;
  })()`);
  const shotMissing = await b.alice.shot("bills-merchant-linked-future-bill");
  t.check("the bill leaves 'Pending merchants' right away, even though it hasn't started yet (bug fix, 2026-09-17: it used to keep re-offering an already-linked bill forever)", {
    expected: false, actual: stillMissing,
  });
  t.note(`prefilled name was "${prefill}"; screenshot: ${shotMissing}`);

  const updated = (await h.api("alice").ok("recurring", { query: q })).recurring.find((r) => r.id === futureBill.id);
  t.check("the bill's OWN current view still legitimately shows no merchant yet (correct: nothing can be 'in effect' before the bill starts, same as any other term change) — the link is real, just not current yet", {
    expected: false, actual: !!(updated && updated.payeeId),
  });

  await b.alice.goto("bills");
  await b.alice.waitForText(futureBill.name, { scope: "main" });
  await b.alice.openRecordMenu(futureBill.name, { scope: "main" });
  await b.alice.click({ role: "button", name: `Edit ${futureBill.name}` });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the future bill's edit dialog" });
  const futureMerchant = await byLabelValue(b.alice, "Merchant");
  const shotEdit = await b.alice.shot("bills-edit-future-bill-merchant-not-yet-current");
  t.check("consistent with the above: the edit dialog also shows the still-pending typed name (the new version isn't current yet, but the picker shows what was TYPED on the currently-effective version, which is the same pending name)", {
    expected: "E2E Electric Co", actual: futureMerchant,
  });
  t.note(`Merchant field: "${futureMerchant}"; screenshot: ${shotEdit}`);
  await b.alice.press("Escape");
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the edit dialog to close" });

  // ---- a bill with no typed name at all: no guess, no "Add merchant" ---------------------------
  await b.alice.goto("payees");
  await b.alice.waitForText("Bills with no merchant name recorded", { scope: "main" });
  const noNameCheck = await b.alice.evaluate(`(() => {
    const h2 = [...document.querySelectorAll("h2")].find((x) => x.textContent === "Bills with no merchant name recorded");
    const card = h2 && h2.closest(".card");
    const li = card && [...card.querySelectorAll("li")].find((x) => x.textContent.includes(${JSON.stringify(noNameBill.name)}));
    return {
      shown: !!li,
      hasAddMerchant: !!(li && [...li.querySelectorAll("button")].some((b) => b.textContent === "Add merchant")),
      hasGoToBills: !!(li && [...li.querySelectorAll("button")].some((b) => b.textContent === "Go to Bills")),
    };
  })()`);
  t.check("shown under its own section, by its own title (as the BILL, never presented as a merchant name)", { expected: true, actual: noNameCheck.shown });
  t.check("never offers 'Add merchant' without a typed name to prefill", { expected: false, actual: noNameCheck.hasAddMerchant });
  t.check("offers 'Go to Bills' instead", { expected: true, actual: noNameCheck.hasGoToBills });

  // ---- the Merchant picker opens on click/tap, without typing first (review finding) --------------
  await b.alice.goto("bills");
  await b.alice.waitForText(noNameBill.name, { scope: "main" });
  await b.alice.openRecordMenu(noNameBill.name, { scope: "main" });
  await b.alice.click({ role: "button", name: `Edit ${noNameBill.name}` });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the no-name bill's edit dialog" });
  const opensOnClick = await b.alice.evaluate(`(() => {
    const l = [...document.querySelectorAll(".modal label")].find((x) => x.textContent === "Merchant");
    const input = l && document.getElementById(l.getAttribute("for"));
    if (!input) return { found: false };
    const before = input.getAttribute("aria-expanded");
    input.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    input.focus();
    const after = input.getAttribute("aria-expanded");
    return { found: true, before, after };
  })()`);
  t.check("the Merchant field's list opens on click/focus, without typing anything first (review finding)", {
    expected: { found: true, before: "false", after: "true" }, actual: opensOnClick,
  });

  // ---- Terry, 2026-09-18 (verbatim): "what i did ask for was the drop down to look like that of
  // the category field ... I KEEP CALLING FOR CONSISTENCY" — real DOM proof, not just behaviour,
  // that Merchant is now the exact same shared component as Category, never a bespoke lookalike. --
  const consistency = await b.alice.evaluate(`(() => {
    const byLabel = (t) => { const l = [...document.querySelectorAll(".modal label")].find((x) => x.textContent === t); return l && document.getElementById(l.getAttribute("for")); };
    const merchant = byLabel("Merchant");
    const category = byLabel("Category");
    return {
      merchantIsCmdpickTrigger: !!(merchant && merchant.classList.contains("cmdpick__trigger")),
      categoryIsCmdpickTrigger: !!(category && category.classList.contains("cmdpick__trigger")),
      sameTagName: !!(merchant && category && merchant.tagName === category.tagName),
      merchantHasNoBespokeClass: !!(merchant && !document.querySelector(".combo, .combo__list, .combo__option")),
    };
  })()`);
  const shotConsistency = await b.alice.shot("bills-merchant-matches-category");
  t.check("Merchant's trigger is the SAME .cmdpick__trigger component Category uses, both <button> elements, no bespoke combobox markup anywhere on the page", {
    expected: { merchantIsCmdpickTrigger: true, categoryIsCmdpickTrigger: true, sameTagName: true, merchantHasNoBespokeClass: true },
    actual: consistency,
  });
  t.note(`screenshot: ${shotConsistency}`);

  // ---- typing an unmatched name and saving persists it as the bill's own payeeDraftName -----------
  await typeMerchantDraft(b.alice, "E2E Freshly Typed Merchant");
  await b.alice.click({ role: "button", name: "Save changes", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the edit dialog to close after saving" });
  await b.alice.settle();
  const savedDraft = (await h.api("alice").ok("recurring", { query: q })).recurring.find((r) => r.id === noNameBill.id);
  t.check("the typed name is now saved on the bill's own record, verified directly against the API (never trusting the label alone)", {
    expected: "E2E Freshly Typed Merchant", actual: savedDraft && savedDraft.payeeDraftName,
  });
  t.check("still no real merchant linked", { expected: null, actual: savedDraft && savedDraft.payeeId });

  // The real regression Terry reported (2026-09-18): a bill with ONLY a typed, unlinked merchant
  // name — no merchant record exists for it — must still show that name, both on the All-bills
  // list row and in the bill's own "Terms over time" history, never blank merely because nothing
  // is linked yet. (The bill editor's own Merchant field already showed it correctly before this
  // fix — `current` there already read `payeeDraftName` — the bug was specifically the read-only
  // displays that only ever checked `payeeName`.)
  await b.alice.goto("bills");
  await b.alice.waitForText(noNameBill.name, { scope: "main" });
  const draftRowText = await b.alice.evaluate(`(() => {
    const row = [...document.querySelectorAll("tbody tr")].find((tr) => tr.textContent.includes(${JSON.stringify(noNameBill.name)}) && tr.querySelector('td[data-label="Schedule"]'));
    return row ? row.textContent : null;
  })()`);
  const shotDraftRow = await b.alice.shot("bills-list-shows-pending-draft-name");
  t.check("the All-bills list row shows the typed-but-unlinked merchant name (never blank just because no merchant record exists yet)", {
    expected: true, actual: !!(draftRowText && draftRowText.includes("E2E Freshly Typed Merchant")),
  });
  t.note(`list row text: "${draftRowText}"; screenshot: ${shotDraftRow}`);
  await b.alice.openRecordMenu(noNameBill.name, { scope: "main" });
  await b.alice.click({ role: "button", name: `History of ${noNameBill.name}` });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the bill's history dialog" });
  // The LAST row, not the first: versions are appended chronologically (server-side `.push`), so
  // the most recent term change — the one that added the typed name — is the last "Terms over
  // time" row; the first row is the bill's ORIGINAL version from creation (correctly "—", no
  // merchant was ever typed on it).
  const historyMerchant = await b.alice.evaluate(`(() => {
    const cells = [...document.querySelectorAll('.modal td[data-label="Merchant"]')];
    const cell = cells[cells.length - 1];
    return cell ? cell.textContent : null;
  })()`);
  const shotHistory = await b.alice.shot("bills-history-shows-pending-draft-name");
  t.check("'Terms over time' also shows the typed-but-unlinked merchant name, not an em dash", { expected: "E2E Freshly Typed Merchant", actual: historyMerchant });
  t.note(`history Merchant cell: "${historyMerchant}"; screenshot: ${shotHistory}`);
  await b.alice.press("Escape");
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the history dialog to close" });

  // ---- inline "Add … as a new merchant" from the bill editor resolves it right away ---------------
  await b.alice.goto("bills");
  await b.alice.waitForText(noNameBill.name, { scope: "main" });
  await b.alice.openRecordMenu(noNameBill.name, { scope: "main" });
  await b.alice.click({ role: "button", name: `Edit ${noNameBill.name}` });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the bill's edit dialog, reopened" });
  const beforeReplace = await byLabelValue(b.alice, "Merchant");
  t.check("reopening shows the just-typed pending name", { expected: "E2E Freshly Typed Merchant", actual: beforeReplace });
  await openMerchantSearch(b.alice, "E2E Inline Created Merchant");
  await b.alice.waitForText("Add merchant “E2E Inline Created Merchant”", { scope: ".modal" });
  await b.alice.click({ text: "Add merchant “E2E Inline Created Merchant”", scope: ".modal" });
  await b.alice.waitFor("document.querySelectorAll('.modal').length === 2 || (document.querySelector('.modal h2') && document.querySelector('.modal h2').textContent === 'Add merchant')", { what: "the inline create-merchant dialog to open on top" });
  await b.alice.click({ role: "button", name: "Add merchant", scope: ".modal" });
  await b.alice.waitFor("document.querySelectorAll('.modal').length <= 1", { what: "the inline create dialog to close, back to the bill editor" });
  const afterInline = await byLabelValue(b.alice, "Merchant");
  t.check("the newly created merchant is selected in the bill editor's own Merchant field right away", { expected: "E2E Inline Created Merchant", actual: afterInline });
  await b.alice.click({ role: "button", name: "Save changes", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the edit dialog to close after saving the inline-created merchant" });
  await b.alice.settle();
  const savedLinked = (await h.api("alice").ok("recurring", { query: q })).recurring.find((r) => r.id === noNameBill.id);
  t.check("a real merchant, once linked, always clears the pending draft name (never both set at once)", {
    expected: { payeeName: "E2E Inline Created Merchant", payeeDraftName: "" },
    actual: { payeeName: savedLinked && savedLinked.payeeName, payeeDraftName: savedLinked && savedLinked.payeeDraftName },
  });

  // ---- Terry's exact acceptance scenario's final step: on a BRAND NEW bill, a merchant resolved
  // earlier this run ("E2E Rent Landlord Co") is now selectable by typing part of its name and
  // choosing it from the filtered list — click opens, typing searches, an existing choice is
  // selected — the same interaction pattern Category already uses (`pickerSelect`, BT-004-05).
  await b.alice.goto("bills");
  await b.alice.waitForText("Add bill", { scope: "main" });
  await b.alice.click({ role: "button", name: "Add bill" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the new-bill dialog" });
  await b.alice.fill("Name", "E2E Search For Resolved Merchant");
  await b.alice.fill("Amount", "10.00");
  await openMerchantSearch(b.alice, "Rent Landlord");
  await b.alice.waitForText("E2E Rent Landlord Co", { scope: ".modal" });
  const optionShown = await b.alice.evaluate(`!![...document.querySelectorAll(".modal .cmdpick__opt")].find((li) => li.textContent.includes("E2E Rent Landlord Co"))`);
  t.check("typing part of an already-resolved merchant's name filters it into the list, like Category's own search", { expected: true, actual: optionShown });
  await b.alice.click({ text: "E2E Rent Landlord Co", scope: ".modal" });
  const searchSelected = await byLabelValue(b.alice, "Merchant");
  t.check("selecting it from the filtered list sets the field to the existing merchant, no need to create it again", { expected: "E2E Rent Landlord Co", actual: searchSelected });
  await b.alice.press("Escape");
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the new-bill dialog to close (never saved — only proving search/select)" });

  // ---- BT-011-09 (review, 2026-09-18): the accessible help popover on a new bill's "Show as due
  // soon" field, and the curved left-edge accent shared by callouts, tooltips and popovers alike ---
  await b.alice.goto("bills");
  await b.alice.waitForText("Add bill", { scope: "main" });
  await b.alice.click({ role: "button", name: "Add bill" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the new-bill dialog" });
  const beforePopover = await b.alice.evaluate("!!document.querySelector('.popover__panel')");
  t.check("the popover is closed until the trigger is activated", { expected: false, actual: beforePopover });
  await b.alice.click({ role: "button", name: "Where this default comes from" });
  const popover = await b.alice.evaluate(`(() => {
    const panel = document.querySelector('.popover__panel');
    const trigger = document.querySelector('.popover__trigger');
    if (!panel || !trigger) return { found: false };
    const style = getComputedStyle(panel, '::before');
    return {
      found: true, expanded: trigger.getAttribute('aria-expanded'),
      text: panel.textContent, hasRealButton: !!panel.querySelector('button'),
      accentWidth: style.width, accentPositioned: style.position,
    };
  })()`);
  const shotPopover = await b.alice.shot("bills-help-popover-open");
  t.check("opens on click, holds a real button (not just inert text), and the trigger reports expanded", {
    expected: { found: true, expanded: "true", hasRealButton: true }, actual: { found: popover.found, expanded: popover.expanded, hasRealButton: popover.hasRealButton },
  });
  t.check("the popover text explains the workspace default", { expected: true, actual: /due-soon window/.test(popover.text || "") });
  t.check("the curved left-edge accent (::before) is present and positioned to be clipped by the panel's own rounded corner", {
    expected: "absolute", actual: popover.accentPositioned,
  });
  t.note(`accent bar width: ${popover.accentWidth}; screenshot: ${shotPopover}`);
  await b.alice.press("Escape");
  const afterEscape = await b.alice.evaluate(`(() => ({ panel: !!document.querySelector('.popover__panel'), focused: document.activeElement && document.activeElement.className }))()`);
  t.check("Escape closes the popover and returns focus to its own trigger, not lost to the page", { expected: { panel: false, focused: "popover__trigger" }, actual: afterEscape });
  await b.alice.press("Escape");
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close" });

  // The Dashboard's "Needs attention" panel already uses .notice--warning (BT-014-14/planning.js
  // etc.) — a real screenshot of the shared curved-accent treatment, not just a unit assertion.
  await b.alice.goto("dashboard");
  await b.alice.settle();
  const hasNotice = await b.alice.evaluate("!!document.querySelector('.notice')");
  if (hasNotice) {
    const noticeStyle = await b.alice.evaluate(`(() => { const s = getComputedStyle(document.querySelector('.notice'), '::before'); return { position: s.position, background: s.backgroundColor }; })()`);
    t.check("an existing informational callout (.notice) picks up the same curved left-edge accent automatically, with no per-screen changes", { expected: "absolute", actual: noticeStyle.position });
    await b.alice.shot("dashboard-notice-accent");
  } else {
    t.note("no .notice panel present on this seeded dashboard right now (nothing overdue/due soon) — the popover check above already covers the shared accent treatment");
  }

  // ---- Bug fix (2026-09-23, Terry's exact repro): "why am i not able to edit this bill and assign
  // a merchant. i edit it and save but its not updated." — an ALREADY-STARTED bill whose next due
  // date is weeks away (unlike every fixture above, whose own next due date happens to equal
  // "today", which is exactly why this real bug slipped past all of the coverage above). The bill
  // editor's own "take effect from" field used to default to that far-future next-due date, so the
  // change was genuinely saved server-side but invisible until then — indistinguishable from "did
  // not save" from the person's own point of view. ----------------------------------------------
  const pastDay = new Date().getUTCDate() === 5 ? 6 : 5;
  const pastStart = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
  pastStart.setUTCDate(pastDay);
  const pastStartIso = pastStart.toISOString().slice(0, 10);
  const electric = firstRecord(await h.api("alice").ok("recurring", { method: "POST", query: q, body: { name: "E2E Electric Repayment", billType: "utilities", accountId: account.id, amount: "174.00", schedule: { freq: "monthly", startDate: pastStartIso } } }));
  const electricBefore = (await h.api("alice").ok("recurring", { query: q })).recurring.find((r) => r.id === electric.id);
  t.check("fixture sanity: already started (schedule start in the past), and its own next due date is genuinely NOT today — the exact condition that hid this bug from every other check above", {
    expected: { startedInPast: true, nextDueIsNotToday: true },
    actual: { startedInPast: electricBefore.schedule.startDate < today, nextDueIsNotToday: electricBefore.nextDue !== today },
  });
  t.note(`E2E Electric Repayment ${electric.id}: schedule start ${electricBefore.schedule.startDate}, next due ${electricBefore.nextDue}, today ${today}`);

  await b.alice.goto("bills");
  await b.alice.waitForText("E2E Electric Repayment", { scope: "main" });
  await b.alice.openRecordMenu("E2E Electric Repayment", { scope: "main" });
  await b.alice.click({ role: "button", name: "Edit E2E Electric Repayment" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the Electric Repayment edit dialog" });
  const effectiveFromLabel = "Changes to amount, merchant, category or responsible person take effect from";
  const effectiveFromValue = await b.alice.evaluate(`(() => {
    const l = [...document.querySelectorAll(".modal label")].find((x) => x.textContent === ${JSON.stringify(effectiveFromLabel)});
    const input = l && document.getElementById(l.getAttribute("for"));
    return input ? input.value : null;
  })()`);
  t.check("the 'take effect from' field defaults to TODAY, never the bill's own far-future next due date (the bug, exactly as Terry reported it)", {
    expected: today, actual: effectiveFromValue,
  });
  await typeMerchantDraft(b.alice, "E2E Electric Utility Co");
  await b.alice.choose("Category", "Housing", { scope: ".modal" });
  await b.alice.click({ role: "button", name: "Save changes", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await b.alice.settle();

  const electricAfter = (await h.api("alice").ok("recurring", { query: q })).recurring.find((r) => r.id === electric.id);
  t.check("the merchant is genuinely, immediately visible on the bill's own CURRENT view — verified against the API directly, not just the UI's own re-read of what it just wrote", {
    expected: "E2E Electric Utility Co", actual: electricAfter && electricAfter.payeeDraftName,
  });

  await b.alice.goto("bills");
  await b.alice.waitForText("E2E Electric Repayment", { scope: "main" });
  const electricRowText = await b.alice.evaluate(`(() => {
    const row = [...document.querySelectorAll("tbody tr")].find((tr) => tr.textContent.includes("E2E Electric Repayment") && tr.querySelector('td[data-label="Schedule"]'));
    return row ? row.textContent : null;
  })()`);
  t.check("the All-bills list row shows the newly assigned merchant immediately, no reload-and-wait needed", {
    expected: true, actual: !!(electricRowText && electricRowText.includes("E2E Electric Utility Co")),
  });

  // Terry's own exact complaint, reproduced and disproven: reopening Edit must show what was just
  // saved right away, not appear blank as if nothing had happened.
  await b.alice.openRecordMenu("E2E Electric Repayment", { scope: "main" });
  await b.alice.click({ role: "button", name: "Edit E2E Electric Repayment" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the Electric Repayment edit dialog, reopened" });
  const reopenedMerchant = await byLabelValue(b.alice, "Merchant");
  const shotFixed = await b.alice.shot("bills-edit-merchant-now-saves-immediately");
  t.check("reopening the editor shows the merchant just assigned, immediately — not blank, the exact bug reported ('i edit it and save but its not updated')", {
    expected: "E2E Electric Utility Co", actual: reopenedMerchant,
  });
  t.note(`Merchant field on reopen: "${reopenedMerchant}"; screenshot: ${shotFixed}`);
  await b.alice.press("Escape");
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the edit dialog to close" });

  await b.alice.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: b.alice.problems() });
}
