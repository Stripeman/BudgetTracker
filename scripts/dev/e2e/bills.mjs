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
// "Add as merchant" button; and a typed-but-unmatched name saved from the bill editor persists as
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
  // "Add as merchant" must still show up on the bill and clear the pending list, even though it
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
  await b.alice.waitForText("Record next", { scope: "main" });

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

  // A helper: find the input a <label> in the given root points at, by its own text — the same
  // reliable way other e2e scenarios locate a field regardless of which picker sits before it in
  // the DOM (accounts.mjs's own byLabel pattern) — `document.querySelector('[role="combobox"]')`
  // alone is not enough here, since every pickerSelect trigger in this form ALSO has that role and
  // the Merchant field is not first among them.
  const byLabelValue = (s, label) => s.evaluate(`(() => {
    const l = [...document.querySelectorAll(".modal label")].find((x) => x.textContent === ${JSON.stringify(label)});
    const el = l && document.getElementById(l.getAttribute("for"));
    return el ? el.value : null;
  })()`);

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
    const btn = li && [...li.querySelectorAll("button")].find((b) => b.textContent === "Add as merchant");
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  t.check("'Add as merchant' is offered for a pending name on an already-started bill", { expected: true, actual: clickedRent });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the add-merchant dialog" });
  const rentPrefill = await b.alice.evaluate("document.querySelector('.modal input').value");
  t.check("prefilled from the TYPED name, not the bill's own title", { expected: "E2E Rent Landlord Co", actual: rentPrefill });
  await b.alice.click({ role: "button", name: "Add merchant", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after adding" });
  await b.alice.settle();
  await b.alice.goto("bills");
  await b.alice.waitForText(bill.name, { scope: "main" });
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
    const btn = li && [...li.querySelectorAll("button")].find((b) => b.textContent === "Add as merchant");
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  t.check("'Add as merchant' is offered for the pending name on the bill that hasn't started yet", { expected: true, actual: clicked });
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

  // ---- a bill with no typed name at all: no guess, no "Add as merchant" ---------------------------
  await b.alice.goto("payees");
  await b.alice.waitForText("Bills with no merchant name recorded", { scope: "main" });
  const noNameCheck = await b.alice.evaluate(`(() => {
    const h2 = [...document.querySelectorAll("h2")].find((x) => x.textContent === "Bills with no merchant name recorded");
    const card = h2 && h2.closest(".card");
    const li = card && [...card.querySelectorAll("li")].find((x) => x.textContent.includes(${JSON.stringify(noNameBill.name)}));
    return {
      shown: !!li,
      hasAddAsMerchant: !!(li && [...li.querySelectorAll("button")].some((b) => b.textContent === "Add as merchant")),
      hasGoToBills: !!(li && [...li.querySelectorAll("button")].some((b) => b.textContent === "Go to Bills")),
    };
  })()`);
  t.check("shown under its own section, by its own title (as the BILL, never presented as a merchant name)", { expected: true, actual: noNameCheck.shown });
  t.check("never offers 'Add as merchant' without a typed name to prefill", { expected: false, actual: noNameCheck.hasAddAsMerchant });
  t.check("offers 'Go to Bills' instead", { expected: true, actual: noNameCheck.hasGoToBills });

  // ---- the Merchant picker opens on click/tap, without typing first (review finding) --------------
  await b.alice.goto("bills");
  await b.alice.waitForText(noNameBill.name, { scope: "main" });
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

  // ---- typing an unmatched name and saving persists it as the bill's own payeeDraftName -----------
  await b.alice.fill("Merchant", "E2E Freshly Typed Merchant");
  await b.alice.click({ role: "button", name: "Save changes", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the edit dialog to close after saving" });
  await b.alice.settle();
  const savedDraft = (await h.api("alice").ok("recurring", { query: q })).recurring.find((r) => r.id === noNameBill.id);
  t.check("the typed name is now saved on the bill's own record, verified directly against the API (never trusting the label alone)", {
    expected: "E2E Freshly Typed Merchant", actual: savedDraft && savedDraft.payeeDraftName,
  });
  t.check("still no real merchant linked", { expected: null, actual: savedDraft && savedDraft.payeeId });

  // ---- inline "Add … as a new merchant" from the bill editor resolves it right away ---------------
  await b.alice.goto("bills");
  await b.alice.waitForText(noNameBill.name, { scope: "main" });
  await b.alice.click({ role: "button", name: `Edit ${noNameBill.name}` });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the bill's edit dialog, reopened" });
  const beforeReplace = await byLabelValue(b.alice, "Merchant");
  t.check("reopening shows the just-typed pending name", { expected: "E2E Freshly Typed Merchant", actual: beforeReplace });
  await b.alice.fill("Merchant", "E2E Inline Created Merchant");
  await b.alice.waitForText("Add “E2E Inline Created Merchant” as a new merchant", { scope: ".modal" });
  await b.alice.click({ text: "Add “E2E Inline Created Merchant” as a new merchant", scope: ".modal" });
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

  await b.alice.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: b.alice.problems() });
}
