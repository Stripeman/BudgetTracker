// SHARED EXPENSES, THREE BROWSERS (BT-009): Alice adds a 90.00 dinner split three ways in her
// browser; Bob and Carol see it after a reload with the balances computed by hand; Bob reports a
// payment of 30.00 to Alice; Alice confirms it in her browser; every browser shows the new balances.
//
// Hand-computed expectations (independent of the app's arithmetic):
//   dinner 90.00 paid by Alice, three equal shares of 30.00
//     Alice +90.00 - 30.00 = +60.00   Bob -30.00   Carol -30.00   (sum 0)
//   Bob pays Alice 30.00, only counted once Alice confirms it
//     Alice +60.00 - 30.00 = +30.00   Bob -30.00 + 30.00 = 0.00   Carol -30.00   (sum 0)
import { createWorkspace, DISPLAY } from "../harness/fixtures.mjs";

export const name = "shared";
export const title = "Shared expenses across three browsers: a 90.00 dinner split three ways, then a reported and confirmed repayment";
export const needsBrowser = true;

const DINNER = "E2E Fictional dinner";
const BALANCES = '[aria-labelledby="grp-balances"]';
const EXPENSES = '[aria-labelledby="grp-expenses"]';
const PAYMENTS = '[aria-labelledby="grp-payments"]';

// "gets back EUR 60.00" -> "+60.00", "owe EUR 30.00" -> "-30.00", "Settled up" -> "0.00".
function signedFrom(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (/settled up/i.test(t)) return "0.00";
  const m = /(gets back|get back|owes|owe)\D*?([\d,]+\.\d{2})/i.exec(t);
  if (!m) return `unreadable: ${t}`;
  const amount = m[2].replace(/,/g, "");
  return /back/i.test(m[1]) ? `+${amount}` : `-${amount}`;
}

async function uiBalances(s) {
  const rows = await s.evaluate(`[...document.querySelectorAll('${BALANCES} tbody tr')].map((tr) => ({
    person: ((tr.querySelector('th > span') || {}).textContent || '').trim(),
    balance: ((tr.querySelector('td[data-label="Balance"]') || {}).innerText || '').trim(),
    pending: ((tr.querySelector('td[data-label="Not counted yet"]') || {}).innerText || '').trim(),
  }))`);
  return Object.fromEntries(rows.map((r) => [r.person, signedFrom(r.balance)]));
}

async function apiNets(h, user, W) {
  const data = await h.api(user).ok("group", { query: W.q });
  const table = (data.balances || []).find((b) => b.currency === "EUR");
  return table ? Object.fromEntries(table.rows.map((r) => [r.name, r.net])) : null;
}

// As each person sees it: themselves as "You", the others by name.
const asSeenBy = (viewer, nets) => Object.fromEntries(Object.entries(nets).map(([user, v]) => [user === viewer ? "You" : DISPLAY[user], v]));
const byName = (nets) => Object.fromEntries(Object.entries(nets).map(([user, v]) => [DISPLAY[user], v]));

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Trio", kind: "group", members: { bob: "member", carol: "viewer" } });
  const b = await h.browsers(["alice", "bob", "carol"], { prefix: "shared-" });
  for (const s of Object.values(b)) {
    await s.open("group");
    await s.useWorkspace(W.name);
    await s.goto("group");
  }
  if (!(await b.alice.exists(BALANCES))) { t.skip("shared expenses in the browser", "the Shared expenses page is not present at this commit"); return; }

  // ---- 1. Alice adds the dinner in her browser --------------------------------------------------
  await b.alice.click({ role: "button", name: "Add expense", scope: ".page-head" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the Add shared expense dialog" });
  await b.alice.fill({ label: "Description", scope: ".modal" }, DINNER);
  await b.alice.fill({ label: "Amount (EUR)", scope: ".modal" }, "90.00");
  const split = await b.alice.evaluate(`(() => {
    const set = [...document.querySelectorAll('.modal fieldset')].find((f) => ((f.querySelector('legend') || {}).textContent || '') === 'Shared by');
    return set ? [...set.querySelectorAll('.split-row')].map((r) => ({ name: r.querySelector('label').textContent, checked: r.querySelector('input[type=checkbox]').checked, share: (((r.querySelector('.split-row__share') || {}).textContent || '').match(/[0-9][0-9,]*\\.[0-9]{2}/) || [''])[0] })) : null;
  })()`);
  t.check("alice: the dialog shares 90.00 with all three, 30.00 each", {
    expected: [{ name: "Alice Fictional (you)", checked: true, share: "30.00" }, { name: "Bob Fictional", checked: true, share: "30.00" }, { name: "Carol Fictional", checked: true, share: "30.00" }],
    actual: split,
  });
  await b.alice.shot("1-add-expense-dialog");
  await b.alice.click({ role: "button", name: "Save expense", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after saving" });
  await b.alice.waitForText(DINNER, { scope: EXPENSES });

  const afterDinner = { alice: "+60.00", bob: "-30.00", carol: "-30.00" };
  for (const user of ["alice", "bob", "carol"]) {
    const s = b[user];
    await s.reload();
    await s.goto("group");
    await s.waitForText(DINNER, { scope: EXPENSES });
    t.check(`${user}: after a reload the browser shows the dinner with balances Alice +60.00, Bob -30.00, Carol -30.00`, { expected: asSeenBy(user, afterDinner), actual: await uiBalances(s) });
    await s.shot("2-after-dinner");
  }
  t.check("API: balances after the dinner (Alice 60.00, Bob -30.00, Carol -30.00)", { expected: byName({ alice: "60.00", bob: "-30.00", carol: "-30.00" }), actual: await apiNets(h, "bob", W) });
  const carolText = await b.carol.text();
  t.check("carol (viewer): told she can only look, and offered no Add expense", {
    expected: { told: true, addExpense: false },
    actual: { told: carolText.includes("You can see this group's expenses but not add or change them."), addExpense: (await b.carol.text(".page-head")).includes("Add expense") },
  });

  // ---- 2. Bob reports paying Alice 30.00 ---------------------------------------------------------
  await b.bob.click({ role: "button", name: /^Record payment of .*30\.00 from You to Alice Fictional$/ });
  await b.bob.waitFor("!!document.querySelector('.modal')", { what: "the Record a payment dialog" });
  // The From and To triggers are comboboxes named by their labels; the person chosen is their value,
  // the visually hidden text a screen reader hears (picker review, BT-004-07).
  const pickerValue = (label) => b.bob.evaluate(`(() => { const l = [...document.querySelectorAll('.modal label')].find((x) => x.textContent === ${JSON.stringify(label)}); const t = l && document.getElementById(l.getAttribute('for')); const v = t && t.querySelector('.cmdpick__spoken'); return v ? v.textContent : null; })()`);
  const preset = {
    from: await pickerValue("From"),
    to: await pickerValue("To"),
    amount: (await b.bob.locate({ label: "Amount (EUR)", scope: ".modal" })).value,
  };
  t.check("bob: the suggested payment opens prefilled from Bob to Alice for 30.00", {
    expected: { from: true, to: true, amount: "30.00" },
    actual: { from: String(preset.from).startsWith("Bob Fictional (you)"), to: String(preset.to).startsWith("Alice Fictional"), amount: preset.amount },
  });
  await b.bob.shot("3-record-payment-dialog");
  await b.bob.click({ role: "button", name: "Record payment", scope: ".modal" });
  await b.bob.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after recording" });
  await b.bob.waitForText("You paid Alice Fictional", { scope: PAYMENTS });
  const bobPending = await b.bob.evaluate(`(() => { const tr = [...document.querySelectorAll('${BALANCES} tbody tr')].find((x) => ((x.querySelector('th > span') || {}).textContent || '') === 'You'); return tr ? tr.querySelector('td[data-label="Not counted yet"]').innerText : null; })()`);
  t.check("bob: the reported 30.00 is shown as not counted yet, and balances do not change before confirmation", {
    expected: { pending: true, balances: asSeenBy("bob", afterDinner) },
    actual: { pending: /30\.00 reported as paid/.test(String(bobPending)), balances: await uiBalances(b.bob) },
  });
  t.check("API: a reported payment leaves the balances unchanged", { expected: byName({ alice: "60.00", bob: "-30.00", carol: "-30.00" }), actual: await apiNets(h, "alice", W) });

  // ---- 3. Alice confirms it in her browser --------------------------------------------------------
  await b.alice.reload();
  await b.alice.goto("group");
  await b.alice.waitForText("Bob Fictional paid you", { scope: PAYMENTS });
  await b.alice.click({ role: "button", name: "Confirm Bob Fictional paid you" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the Confirm payment dialog" });
  await b.alice.shot("4-confirm-dialog");
  await b.alice.click({ role: "button", name: "Confirm", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after confirming" });

  const afterPayment = { alice: "+30.00", bob: "0.00", carol: "-30.00" };
  for (const user of ["alice", "bob", "carol"]) {
    const s = b[user];
    await s.reload();
    await s.goto("group");
    await s.waitForText(DINNER, { scope: EXPENSES });
    t.check(`${user}: after confirmation the browser shows Alice +30.00, Bob settled up, Carol -30.00`, { expected: asSeenBy(user, afterPayment), actual: await uiBalances(s) });
    await s.shot("5-after-confirmation");
  }
  t.check("API: balances after the confirmed payment (Alice 30.00, Bob 0.00, Carol -30.00)", { expected: byName({ alice: "30.00", bob: "0.00", carol: "-30.00" }), actual: await apiNets(h, "carol", W) });
  const status = await b.bob.evaluate(`(() => { const tr = [...document.querySelectorAll('${PAYMENTS} tbody tr')].find((x) => x.innerText.includes('You paid Alice Fictional')); return tr ? tr.querySelector('td[data-label="Status"]').innerText.split('\\n')[0].trim() : null; })()`);
  t.check("bob: his payment is shown as Confirmed", { expected: "Confirmed", actual: status });

  for (const user of ["alice", "bob", "carol"]) {
    t.check(`${user}: no exceptions, console errors or failed requests in the browser`, { expected: [], actual: b[user].problems() });
  }
}
