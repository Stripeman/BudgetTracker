// BT-009-25, in a real browser: itemized receipt allocation — "Itemize a receipt…", adding item
// lines with a shared line, tax/tip/discount, the live reconciling preview, and the resulting
// per-person shares matching docs/BT-009-25-WORKED-EXAMPLES.md §2's worked example exactly.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "groupitemized";
export const title = "BT-009-25: itemized receipt allocation in Shared expenses, in a real browser";
export const needsBrowser = true;

const EXPENSES = '[aria-labelledby="grp-expenses"]';

export async function run(h, t) {
  const api = (u) => h.api(u);
  // Three people, matching the worked example exactly (Burger→Alice, Salad→Bob, shared appetizer
  // →all three, tax/tip/discount allocated proportionally).
  const W = await createWorkspace(h, { name: "E2E Itemized Trip", kind: "group", members: { bob: "member", carol: "member" } });
  const { alice } = await h.browsers(["alice"], { prefix: "groupitemized-" });
  await alice.open("group");
  await alice.useWorkspace(W.name);
  await alice.goto("group");
  if (!(await alice.exists(EXPENSES))) { t.skip("shared expenses in the browser", "the Shared expenses page is not present at this commit"); return; }
  const hasItemizeButton = await alice.evaluate("[...document.querySelectorAll('.page-head button')].some((b) => b.textContent === 'Itemize a receipt…')");
  if (!hasItemizeButton) { t.skip("itemized receipts in the browser", "the Itemize a receipt action is not present at this commit"); return; }

  await alice.click({ role: "button", name: "Itemize a receipt…", scope: ".page-head" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Itemize a receipt dialog" });
  await alice.fill({ label: "Description", scope: ".modal" }, "E2E dinner receipt");
  await alice.fill({ label: "Receipt total", scope: ".modal" }, "35.40");

  const lineCard = (i) => `[...document.querySelectorAll('.modal .item-line')][${i}]`;
  // Line 1: Burger, Alice only (checked by default).
  await alice.evaluate(`(() => { const c = ${lineCard(0)}; c.querySelector('input[placeholder="Item"]').value = 'Burger'; c.querySelector('input[placeholder="Item"]').dispatchEvent(new Event('input', { bubbles: true })); c.querySelector('input[placeholder="0.00"]').value = '12.00'; c.querySelector('input[placeholder="0.00"]').dispatchEvent(new Event('input', { bubbles: true })); })()`);

  await alice.click({ role: "button", name: "Add item line", scope: ".modal" });
  // Line 2: Salad, Bob only — uncheck Alice (checkbox 0), check Bob (checkbox 1).
  await alice.evaluate(`(() => {
    const c = ${lineCard(1)};
    c.querySelector('input[placeholder="Item"]').value = 'Salad'; c.querySelector('input[placeholder="Item"]').dispatchEvent(new Event('input', { bubbles: true }));
    c.querySelector('input[placeholder="0.00"]').value = '10.00'; c.querySelector('input[placeholder="0.00"]').dispatchEvent(new Event('input', { bubbles: true }));
    const boxes = c.querySelectorAll('input[type="checkbox"]');
    boxes[0].checked = false; boxes[0].dispatchEvent(new Event('change', { bubbles: true }));
    boxes[1].checked = true; boxes[1].dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

  await alice.click({ role: "button", name: "Add item line", scope: ".modal" });
  // Line 3: Shared appetizer, Bob + Carol (Alice already checked by default on new lines; uncheck Alice, check Bob+Carol).
  await alice.evaluate(`(() => {
    const c = ${lineCard(2)};
    c.querySelector('input[placeholder="Item"]').value = 'Shared appetizer'; c.querySelector('input[placeholder="Item"]').dispatchEvent(new Event('input', { bubbles: true }));
    c.querySelector('input[placeholder="0.00"]').value = '8.00'; c.querySelector('input[placeholder="0.00"]').dispatchEvent(new Event('input', { bubbles: true }));
    const boxes = c.querySelectorAll('input[type="checkbox"]');
    boxes[1].checked = true; boxes[1].dispatchEvent(new Event('change', { bubbles: true }));
    boxes[2].checked = true; boxes[2].dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

  await alice.evaluate(`(() => {
    const grid = document.querySelector('.modal .itemized-fees');
    const inputs = grid.querySelectorAll('input');
    inputs[0].value = '2.40'; inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].value = '6.00'; inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[2].value = '3.00'; inputs[2].dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  await alice.waitForText("Reconciles exactly to 35.40 EUR", { scope: ".modal" });
  await alice.shot("1-itemized-reconciled");
  await alice.click({ role: "button", name: "Save expense", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await alice.waitForText("E2E dinner receipt", { scope: EXPENSES });
  await alice.waitForText("Itemized", { scope: EXPENSES });

  const view = await api("alice").ok("group", { query: W.q });
  const e = view.expenses.find((x) => x.description === "E2E dinner receipt");
  const refs = await api("alice").ok("members", { query: W.q });
  const shareOf = (name) => e.shares.find((s) => s.ref === `member:${refs.members.find((m) => m.name.startsWith(name)).id}`).amountMinor;
  t.check("the real per-person shares match the hand-computed worked example exactly (Alice 17.31, Bob 14.95, Carol 3.14)", {
    expected: { alice: 1731, bob: 1495, carol: 314 },
    actual: { alice: shareOf("Alice"), bob: shareOf("Bob"), carol: shareOf("Carol") },
  });

  await alice.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: alice.problems() });
}
