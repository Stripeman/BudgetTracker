// BT-009-13, in a real browser: a shared expense entered in a currency other than the workspace's
// own keeps its original amount, currency and rate visible, converts correctly, and — the specific
// regression Terry found and asked to be reproduced through the real UI — a correction that does
// not touch the amount can NEVER silently convert an already-converted figure a second time.
//
// Hand-computed expectations (independent of the app's arithmetic):
//   100.00 USD at 0.92 = 92.00 EUR, split equally between Alice and Bob: 46.00 each
//     Alice +92.00 - 46.00 = +46.00   Bob -46.00
//   A description-only correction must leave the expense at exactly 92.00 EUR (NOT 92.00 * 0.92 =
//   84.64, the double-conversion this fix exists for).
//   110.00 USD at the same 0.92 rate = 101.20 EUR, once the amount is intentionally corrected.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "groupcurrency";
export const title = "BT-009-13: a foreign-currency shared expense converts correctly and a description-only correction never re-converts it, in a real browser";
export const needsBrowser = true;

const EXPENSES = '[aria-labelledby="grp-expenses"]';
const BALANCES = '[aria-labelledby="grp-balances"]';

async function expenseRow(s, description) {
  return s.evaluate(`(() => {
    const tr = [...document.querySelectorAll('${EXPENSES} tbody tr')].find((r) => r.textContent.includes(${JSON.stringify(description)}));
    if (!tr) return null;
    return {
      amount: (((tr.querySelector('td[data-label="Amount"] > span') || {}).textContent) || '').replace(/^EUR\\s*/, '').trim(),
      original: (((tr.querySelector('td[data-label="Amount"] .muted') || {}).textContent) || '').trim(),
    };
  })()`);
}

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Currency Trip", kind: "group", members: { bob: "member" } });
  const { alice } = await h.browsers(["alice"], { prefix: "groupcurrency-" });
  await alice.open("group");
  await alice.useWorkspace(W.name);
  await alice.goto("group");
  if (!(await alice.exists(BALANCES))) { t.skip("shared expenses in the browser", "the Shared expenses page is not present at this commit"); return; }

  // ---- 1. Alice adds a 100.00 USD expense, converted to 92.00 EUR at 0.92 -----------------------
  await alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Add shared expense dialog" });
  await alice.fill({ label: "Description", scope: ".modal" }, "E2E foreign hotel");
  await alice.choose("Currency", "USD", { scope: ".modal" });
  await alice.fill({ label: "Amount (USD)", scope: ".modal" }, "100.00");
  await alice.fill({ label: "Exchange rate", scope: ".modal" }, "0.92");
  await alice.shot("1-add-foreign-expense-dialog");
  await alice.click({ role: "button", name: "Save expense", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await alice.waitForText("E2E foreign hotel", { scope: EXPENSES });

  const afterAdd = await expenseRow(alice, "E2E foreign hotel");
  t.check("the new expense shows its converted EUR amount, with the original USD amount and rate alongside it", {
    expected: { amount: "92.00", original: "100.00 USD at 0.92" },
    actual: { amount: (afterAdd || {}).amount, original: (afterAdd || {}).original },
  });

  const balancesAfterAdd = await alice.evaluate(`(() => { const tr = [...document.querySelectorAll('${BALANCES} tbody tr')].find((x) => ((x.querySelector('th > span') || {}).textContent || '') === 'You'); return tr ? tr.innerText : null; })()`);
  t.check("Alice's balance reflects the CONVERTED 92.00, split into 46.00 shares (gets back 46.00)", { expected: true, actual: /46\.00/.test(String(balancesAfterAdd)) });

  // ---- 2. A description-only correction must NEVER re-convert the already-converted amount -------
  await alice.click({ role: "button", name: "Edit E2E foreign hotel" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Correct shared expense dialog" });
  const startingAmount = (await alice.locate({ label: "Amount (USD)", scope: ".modal" })).value;
  t.check("the correction dialog starts the Amount field from the ORIGINAL 100.00 USD, never the converted 92.00 EUR", { expected: "100.00", actual: startingAmount });
  await alice.fill({ label: "Description", scope: ".modal" }, "E2E foreign hotel (renamed)");
  await alice.fill({ label: "Reason for this correction", scope: ".modal" }, "Fixed the name only");
  await alice.click({ role: "button", name: "Save correction", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await alice.reload();
  await alice.goto("group");
  await alice.waitForText("E2E foreign hotel (renamed)", { scope: EXPENSES });

  const afterRename = await expenseRow(alice, "E2E foreign hotel (renamed)");
  t.check("after a description-only correction and a reload, the amount is STILL exactly 92.00 EUR — never re-converted (92.00 * 0.92 = 84.64 would be the regression)", {
    expected: { amount: "92.00", original: "100.00 USD at 0.92" },
    actual: { amount: (afterRename || {}).amount, original: (afterRename || {}).original },
  });

  // ---- 3. An intentional amount correction DOES convert, at the stored (reused) rate --------------
  await alice.click({ role: "button", name: "Edit E2E foreign hotel (renamed)" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Correct shared expense dialog" });
  await alice.fill({ label: "Amount (USD)", scope: ".modal" }, "110.00");
  await alice.fill({ label: "Reason for this correction", scope: ".modal" }, "Actually paid 110.00" );
  await alice.shot("2-correct-amount-dialog");
  await alice.click({ role: "button", name: "Save correction", scope: ".modal" });
  await alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await alice.reload();
  await alice.goto("group");
  await alice.waitForText("E2E foreign hotel (renamed)", { scope: EXPENSES });

  const afterAmountFix = await expenseRow(alice, "E2E foreign hotel (renamed)");
  t.check("correcting the amount to 110.00 USD converts at the reused 0.92 rate to 101.20 EUR", {
    expected: { amount: "101.20", original: "110.00 USD at 0.92" },
    actual: { amount: (afterAmountFix || {}).amount, original: (afterAmountFix || {}).original },
  });

  await alice.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: alice.problems() });
}
