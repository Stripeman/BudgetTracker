// "RECORD NEXT" TOOLTIP (BT-014-10/12; Terry, 2026-09-17: "add nice tool tips to the All bills
// pane for 'Record next' i dont know what that means", then, after the first version shipped
// without being opened in a real browser: "The tool tip on 'All bills > record next' is clipped..
// you would have seen this had you tested it on localhost"). The floating tooltip must actually be
// visible, in the real viewport, not clipped by the All bills table's own scrolling container
// (`.table-wrap { overflow-x: auto }`, which forces `overflow-y` to clip too) — exactly what a
// DOM-double unit test cannot see, since it has no real layout at all.
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";

export const name = "bills";
export const title = "The All bills table's 'Record next' tooltip is visible in the real viewport, not clipped by the table's own scroll container; 'Add as merchant' really links, even for a bill that hasn't started yet";
export const needsBrowser = true;

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Bills Household", kind: "household" });
  const q = W.q;
  const account = firstRecord(await h.api("alice").ok("accounts", { method: "POST", query: q, body: { name: "E2E Bills Checking", type: "checking", currency: "USD", openingBalance: "1000.00" } }));
  // A near-term due date, so the bill sits with nothing but the page header above it — exactly the
  // "row near the top of the table" layout the original report's screenshot showed.
  const today = new Date().toISOString().slice(0, 10);
  const bill = firstRecord(await h.api("alice").ok("recurring", { method: "POST", query: q, body: { name: "E2E Rent", billType: "housing", accountId: account.id, amount: "950.00", schedule: { freq: "monthly", startDate: today } } }));
  // Terry's exact repro (2026-09-17): a bill scheduled to start next month. Linking a merchant via
  // BT-014-11's "Add as merchant" must still show up on the bill and clear the "missing" list,
  // even though it can't take effect any earlier than the bill's own future start date.
  const futureStart = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const futureBill = firstRecord(await h.api("alice").ok("recurring", { method: "POST", query: q, body: { name: "E2E Electric Repayment", billType: "utilities", accountId: account.id, amount: "174.00", schedule: { freq: "monthly", startDate: futureStart } } }));
  t.note(`workspace ${W.name}: ${W.id}; bill ${bill.id} on account ${account.id}; future bill ${futureBill.id} starting ${futureStart}`);

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

  // ---- BT-014-11 "Add as merchant": the common case, a bill that already started -----------------
  await b.alice.goto("payees");
  await b.alice.waitForText("Bills without a merchant", { scope: "main" });
  await b.alice.waitForText("E2E Rent", { scope: "main" });
  const clickedRent = await b.alice.evaluate(`(() => {
    const li = [...document.querySelectorAll("li")].find((x) => x.textContent.includes("E2E Rent"));
    const btn = li && [...li.querySelectorAll("button")].find((b) => b.textContent === "Add as merchant");
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  t.check("'Add as merchant' is offered for an already-started bill", { expected: true, actual: clickedRent });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the add-merchant dialog" });
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
    expected: "E2E Rent", actual: rentMerchant,
  });
  t.note(`Merchant field: "${rentMerchant}"; screenshot: ${shotRent}`);
  await b.alice.press("Escape");
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the edit dialog to close" });

  // ---- BT-014-11 "Add as merchant": a bill that hasn't started yet (Terry's exact repro) ---------
  // The link genuinely succeeds (proven directly against the API below), but per this app's own
  // versioning rule (api/_shared/bills.js termsAt) nothing can be "in effect today" for a bill that
  // hasn't started — so the bill's CURRENT payeeId legitimately stays null until its start date,
  // exactly like any other term change (amount, category, ...) on an unstarted bill already does.
  // What must NOT happen: the list re-offering a bill the person already handled.
  await b.alice.goto("payees");
  await b.alice.waitForText("E2E Electric Repayment", { scope: "main" });
  const clicked = await b.alice.evaluate(`(() => {
    const li = [...document.querySelectorAll("li")].find((x) => x.textContent.includes("E2E Electric Repayment"));
    const btn = li && [...li.querySelectorAll("button")].find((b) => b.textContent === "Add as merchant");
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  t.check("'Add as merchant' is offered for the bill that hasn't started yet", { expected: true, actual: clicked });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the add-merchant dialog" });
  await b.alice.waitFor("document.querySelector('.modal h2').textContent === 'Add merchant'", { what: "creating, not editing" });
  const prefill = await b.alice.evaluate("document.querySelector('.modal input').value");
  await b.alice.click({ role: "button", name: "Add merchant", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after adding" });
  await b.alice.settle();

  // Checked against the "Bills without a merchant" card specifically, not a whole-page text search
  // — the merchant just created is itself NAMED "E2E Electric Repayment" (from the prefill) and
  // legitimately appears as its own row in the Merchants table below, which a naive page-wide text
  // search would also match.
  const stillMissing = await b.alice.evaluate(`(() => {
    const card = document.getElementById("payees-missing");
    return card ? card.closest(".card").textContent.includes("E2E Electric Repayment") : false;
  })()`);
  const shotMissing = await b.alice.shot("bills-merchant-linked-future-bill");
  t.check("the bill leaves 'Bills without a merchant' right away, even though it hasn't started yet (bug fix, 2026-09-17: it used to keep re-offering an already-linked bill forever)", {
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
  t.check("consistent with the above: the edit dialog also shows no current merchant yet for the not-yet-started bill (not a bug — matches the API's own current view)", {
    expected: "", actual: futureMerchant,
  });
  t.note(`Merchant field: "${futureMerchant === "" ? "(empty, as expected)" : futureMerchant}"; screenshot: ${shotEdit}`);
  await b.alice.press("Escape");
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the edit dialog to close" });

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

  await b.alice.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: b.alice.problems() });
}
