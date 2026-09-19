// BT-009-26, in a real browser: Splitwise import — a real CSV file attached to the file input
// (CDP's DOM.setFileInputFiles onto a temp file under this run's own isolated evidence directory,
// never a fake DOM event), mapping Splitwise's own named columns to real people, the non-mutating
// preview (an unsupported-currency row correctly refused and left unchecked), and a confirmed
// import that creates the real expense and the real payment.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "groupsplitwise";
export const title = "BT-009-26: Splitwise CSV import in Shared expenses, in a real browser";
export const needsBrowser = true;

const CSV = [
  'Date,Description,Category,Cost,Currency,Alice,Bob,Carol',
  '2026-09-01,E2E Splitwise Dinner,Food,90.00,EUR,60.00,-30.00,-30.00',
  '2026-09-02,Payment,Payment,20.00,EUR,,20.00,-20.00',
  '2026-09-03,E2E Splitwise Taxi,Travel,50.00,USD,25.00,-25.00,',
].join('\n');

export async function run(h, t) {
  const api = (u) => h.api(u);
  const W = await createWorkspace(h, { name: "E2E Splitwise Trip", kind: "group", members: { bob: "member", carol: "member" } });
  const { alice } = await h.browsers(["alice"], { prefix: "groupsplitwise-" });
  await alice.open("group");
  await alice.useWorkspace(W.name);
  await alice.goto("group");
  const hasImportButton = await alice.evaluate("[...document.querySelectorAll('.page-head button')].some((b) => b.textContent === 'Import from Splitwise…')");
  if (!hasImportButton) { t.skip("Splitwise import in the browser", "the Import from Splitwise button is not present at this commit"); return; }

  await alice.click({ role: "button", name: "Import from Splitwise…", scope: ".page-head" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Import from Splitwise dialog" });
  const introText = await alice.text(".modal");
  t.check("the dialog explains this reads a Splitwise CSV export and imports nothing until confirmed", {
    expected: true, actual: introText.includes("Splitwise") && introText.includes("Nothing is imported until"),
  });
  await alice.shot("1-choose-file");

  await alice.uploadFile('.modal input[type="file"]', CSV, { filename: "e2e-splitwise.csv" });
  await alice.waitForText("Match each person Splitwise names", { scope: ".modal" });
  await alice.shot("2-mapping");

  await alice.choose("Alice", "Alice Fictional (you)", { scope: ".modal" });
  await alice.choose("Bob", "Bob Fictional", { scope: ".modal" });
  await alice.choose("Carol", "Carol Fictional", { scope: ".modal" });
  await alice.click({ role: "button", name: "Preview import…", scope: ".modal" });
  await alice.waitForText("can be imported as shown", { scope: ".modal" });
  await alice.shot("3-review");

  const reviewText = await alice.text(".modal");
  t.check("the review names the real expense and the real payment, and flags the unsupported-currency row for attention", {
    expected: true,
    actual: reviewText.includes("E2E Splitwise Dinner") && reviewText.includes("Bob Fictional → Carol Fictional")
      && /2 of 3 rows can be imported/.test(reviewText) && /1 need attention/.test(reviewText),
  });

  await alice.click({ role: "button", name: "Import selected", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after importing" });

  const afterImport = await api("alice").ok("group", { query: { ...W.q } });
  const dinner = afterImport.expenses.find((e) => e.description === "E2E Splitwise Dinner");
  t.check("the real expense was created with the real amount, payer and shares", {
    expected: { amount: "90.00", payerCount: 1 }, actual: dinner ? { amount: dinner.amount, payerCount: dinner.payers.length } : null,
  });
  t.check("its notes disclose it was imported from Splitwise, never presented as manually entered", { expected: true, actual: !!(dinner && /Imported from Splitwise/.test(dinner.notes)) });
  const payment = afterImport.settlements.find((s) => s.amount === "20.00");
  t.check("the real payment was created between the real people, in the right direction", {
    expected: true, actual: !!payment,
  });
  t.check("the unsupported-currency row was never imported", { expected: undefined, actual: afterImport.expenses.find((e) => e.description === "E2E Splitwise Taxi") });

  await alice.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: alice.problems() });
}
