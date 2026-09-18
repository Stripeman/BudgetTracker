// "ADD PERSON" (BT-016, Terry, 2026-09-18: "I figured you would add a button that opened the
// existing modal to add a person"). From the Add/Edit shared-expense dialog, "Add person…" opens a
// small dialog that creates a real workspace-shared CONTACT (never an application account — a
// contact is never signed in, never granted access, only recorded as who was involved) and adds
// them straight into BOTH the "Paid by" and "Shared by" lists of the still-open expense dialog,
// without losing anything already typed there. A viewer never sees the button at all.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "addperson";
export const title = "BT-016 \"Add person\": creates a real workspace contact from the shared-expense dialog, added to both Paid by and Shared by without losing what was already typed; never offered to a viewer";
export const needsBrowser = true;

const splitRows = (fieldsetLegend) => `(() => {
  const fs = [...document.querySelectorAll('.modal fieldset')].find((f) => ((f.querySelector('legend') || {}).textContent || '') === ${JSON.stringify(fieldsetLegend)});
  return fs ? [...fs.querySelectorAll('.split-row')].map((r) => ({ name: r.querySelector('label').textContent, checked: r.querySelector('input[type=checkbox]').checked })) : null;
})()`;

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Add-Person Group", kind: "group", members: { carol: "viewer" } });
  t.note(`workspace ${W.name}: ${W.id}`);

  const b = await h.browsers(["alice", "carol"], { prefix: "addperson-" });
  await b.alice.open("dashboard");
  await b.alice.useWorkspace(W.name);
  await b.alice.goto("group");
  if (!(await b.alice.exists('[aria-labelledby="grp-balances"]'))) { t.skip("add person in the browser", "the Shared expenses page is not present at this commit"); return; }

  await b.alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the Add shared expense dialog" });
  await b.alice.fill({ label: "Description", scope: ".modal" }, "E2E carried description");

  await b.alice.click({ role: "button", name: "Add person…", scope: ".modal" });
  await b.alice.waitFor("(() => document.querySelectorAll('.modal').length === 2)()", { what: "the Add person dialog to open on top" });
  await b.alice.fill({ label: "Name", scope: ".modal:last-of-type" }, "E2E New Person");
  await b.alice.click({ role: "button", name: "Add person", scope: ".modal:last-of-type" });
  await b.alice.waitFor("(() => document.querySelectorAll('.modal').length === 1)()", { what: "the Add person dialog to close, back to the expense dialog" });

  const description = await b.alice.evaluate("document.querySelector('.modal input[required]').value");
  t.check("nothing already typed in the expense dialog was lost while adding the person", { expected: "E2E carried description", actual: description });

  const paidBy = await b.alice.evaluate(splitRows("Paid by"));
  const sharedBy = await b.alice.evaluate(splitRows("Shared by"));
  t.check("the new person appears under Paid by, not marked as having paid by default", {
    expected: true, actual: (paidBy || []).some((r) => r.name === "E2E New Person" && r.checked === false),
  });
  t.check("the new person appears under Shared by, already checked — the reason to add someone here is that they took part", {
    expected: true, actual: (sharedBy || []).some((r) => r.name === "E2E New Person" && r.checked === true),
  });

  // Carol (a viewer, added above) is also an active participant by default, so the exact split
  // fraction depends on how many people end up checked under "Shared by" — not asserted here; only
  // that the newly added person genuinely has a live, computed share once an amount is entered
  // (proof the new row is really wired into the same preview as every other row, not just visually
  // present).
  await b.alice.fill({ label: "Amount (EUR)", scope: ".modal" }, "50.00");
  await b.alice.waitFor(`(() => {
    const fs = [...document.querySelectorAll(".modal fieldset")].find((f) => ((f.querySelector("legend") || {}).textContent || "") === "Shared by");
    const row = fs && [...fs.querySelectorAll(".split-row")].find((r) => r.querySelector("label").textContent === "E2E New Person");
    const share = row && row.querySelector(".split-row__share");
    return !!(share && /[0-9]+\\.[0-9]{2}/.test(share.textContent));
  })()`, { what: "the newly added person's own live share to be computed" });
  await b.alice.click({ role: "button", name: "Save expense", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await b.alice.settle();

  const group = await h.api("alice").ok("group", { query: W.q });
  const created = group.expenses.find((e) => e.description === "E2E carried description");
  const newContact = group.participants.find((p) => p.name === "E2E New Person");
  t.check("a real workspace contact was created and the expense was saved with the new person's real share", {
    expected: { contactFound: true, contactType: "contact", expenseFound: true, splitIncludesNewPerson: true },
    actual: {
      contactFound: !!newContact, contactType: newContact ? newContact.type : null, expenseFound: !!created,
      splitIncludesNewPerson: !!(created && created.split.lines.some((l) => l.ref === (newContact || {}).ref)),
    },
  });

  // A viewer never sees the button at all — carol cannot add expenses, let alone people.
  await b.carol.open("dashboard");
  await b.carol.useWorkspace(W.name);
  await b.carol.goto("group");
  const carolOffered = await b.carol.evaluate("[...document.querySelectorAll('button')].some((b) => b.textContent === 'Add person…')");
  t.check("a viewer is never offered \"Add person…\" anywhere on the page", { expected: false, actual: carolOffered });

  await b.alice.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: b.alice.problems() });
}
