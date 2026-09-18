// EDIT ACCOUNT (BT-006-06; Terry, 2026-09-14: "i should be able to edit account entries too… i
// need to be able to change values in the fields like account opening balance, opening date and
// institution name and account number, icon and type and currency"). TWO BROWSERS AT ONCE. Alice
// (owner) edits her own private account's institution, opening balance and icon and sees them
// updated; Bob (member, not a manager) sees no Edit button on a shared account he cannot manage.
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";

export const name = "accounts";
export const title = "Editing an account: Alice updates institution, opening balance and icon in her browser; Bob sees no Edit on a shared account he cannot manage";
export const needsBrowser = true;

// BT-015: a row's own buttons plus, if its compact actions menu is open, that menu's own items too
// (the panel is a floating overlay portaled OUT of the row once open, never a descendant of it).
const rowButtons = (s, text) => s.evaluate(`(() => {
  const r = [...document.querySelectorAll('tbody tr')].find((x) => x.innerText.includes(${JSON.stringify(text)}));
  if (!r) return null;
  const own = [...r.querySelectorAll('button')].map((x) => x.textContent.trim());
  const toggle = r.querySelector('.actionsmenu__toggle');
  const open = toggle && toggle.getAttribute('aria-expanded') === 'true';
  const menuItems = open ? [...document.querySelectorAll('.actionsmenu__panel:not([hidden]) .actionsmenu__item')].map((x) => x.textContent.trim()) : [];
  return [...own, ...menuItems];
})()`);

// Opens the icon picker inside the edit dialog and clicks the option with the given icon id (the
// same custom listbox as the theme picker: `.themepick__toggle` and `[role="option"][data-theme]`,
// not the command picker `choose()` is built for).
async function pickIcon(s, iconId) {
  const toggle = await s.locate({ css: ".themepick__toggle", scope: ".modal" });
  await s.mouseClick(toggle.x, toggle.y);
  await s.waitFor("!!document.querySelector('.modal [role=\"listbox\"]')", { what: "the icon list to open" });
  const at = await s.evaluate(`(() => { const o = document.querySelector('.modal [role="option"][data-theme=${JSON.stringify(iconId)}]'); if (!o) return null; o.scrollIntoView({ block: "center" }); const q = o.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`);
  if (!at) throw new Error(`${s.name}: the icon picker offers no icon ${JSON.stringify(iconId)}`);
  await s.mouseClick(at.x, at.y);
  await s.settle();
}

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Accounts Household", kind: "household", members: { bob: "member" } });
  const q = W.q;
  const api = (u) => h.api(u);
  const wallet = firstRecord(await api("alice").ok("accounts", { method: "POST", query: q, body: { name: "E2E Alice Wallet", type: "cash", currency: "EUR", institution: "E2E Old Bank", openingBalance: "10.00" } }));
  const joint = firstRecord(await api("alice").ok("accounts", { method: "POST", query: q, body: { name: "E2E Joint", type: "checking", currency: "EUR", visibility: "shared", openingBalance: "500.00" } }));
  const card = firstRecord(await api("alice").ok("accounts", { method: "POST", query: q, body: { name: "E2E Alice Card", type: "credit-card", currency: "EUR", openingBalance: "-50.00", terms: { creditLimit: "1000.00", apr: "19.99" } } }));
  const cardEntry = firstRecord(await api("alice").ok("transactions", { method: "POST", query: q, body: { accountId: card.id, kind: "expense", amount: "5.00" } }));
  await api("alice").ok("transactions", { method: "PATCH", query: q, body: { transactionId: cardEntry.id, revision: cardEntry.revision || 1, status: "reconciled" } });
  t.note(`workspace ${W.name}: ${W.id}; Alice's private account ${wallet.id}; shared account ${joint.id}; reconciled card ${card.id}`);

  const b = await h.browsers(["alice", "bob"], { prefix: "accounts-" });
  for (const s of Object.values(b)) { await s.open("dashboard"); await s.useWorkspace(W.name); }

  // ---- Alice edits her own private account: institution, opening balance and icon ------------------
  await b.alice.goto("accounts");
  await b.alice.waitForText(wallet.name, { scope: "main" });
  // BT-015: Edit is now inside the row's compact "::" actions menu.
  await b.alice.openRecordMenu(wallet.name, { scope: "main" });
  await b.alice.click({ role: "button", name: `Edit ${wallet.name}` });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the edit dialog" });
  await b.alice.fill({ label: "Institution", scope: ".modal" }, "E2E New Bank");
  await b.alice.fill({ label: "Opening balance", scope: ".modal" }, "42.50");
  await pickIcon(b.alice, "wallet");
  await b.alice.fill({ label: "Reason for this change", scope: ".modal" }, "E2E corrected the details");
  await b.alice.click({ role: "button", name: "Save changes", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the edit dialog to close after saving" });
  const updated = (await api("alice").ok("accounts", { query: q })).accounts.find((a) => a.id === wallet.id);
  await b.alice.settle();
  const row = await b.alice.text("main");
  const shot = await b.alice.shot("account-edited");
  t.check("Alice's edit (institution, opening balance, icon) is saved and shown on her Accounts page", {
    expected: { institution: "E2E New Bank", openingBalance: "42.50", icon: "wallet", rowShowsBank: true },
    actual: { institution: updated.institution, openingBalance: updated.openingBalance, icon: updated.icon, rowShowsBank: row.includes("E2E New Bank") },
  });
  t.note(`screenshot of Alice's edited account: ${shot}`);

  // ---- a reconciled credit card: Type/Currency read-only, opening fields locked, terms shown --------
  await b.alice.goto("accounts");
  await b.alice.waitForText(card.name, { scope: "main" });
  await b.alice.openRecordMenu(card.name, { scope: "main" });
  await b.alice.click({ role: "button", name: `Edit ${card.name}` });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the card's edit dialog" });
  const layout = await b.alice.evaluate(`(() => {
    const m = document.querySelector('.modal');
    const byLabel = (t) => { const l = [...m.querySelectorAll('label')].find((x) => x.textContent === t); return l && m.querySelector('#' + l.getAttribute('for')); };
    const type = byLabel('Type'); const currency = byLabel('Currency'); const opening = byLabel('Opening balance'); const openingDate = byLabel('Opening date');
    return {
      typeReadonly: type.hasAttribute('readonly'), typeValue: type.value, currencyReadonly: currency.hasAttribute('readonly'), currencyValue: currency.value,
      openingDisabled: opening.disabled, openingDateDisabled: openingDate.disabled,
      creditLimit: (byLabel('Credit limit') || {}).value || null, apr: (byLabel('APR') || {}).value || null,
      selects: m.querySelectorAll('select').length,
    };
  })()`);
  const shotCard = await b.alice.shot("account-edit-card-locked");
  t.check("a reconciled credit card's edit dialog: Type/Currency read-only text (no dropdown), opening balance/date disabled, credit terms shown", {
    expected: { typeReadonly: true, typeValue: "Credit card", currencyReadonly: true, currencyValue: "EUR", openingDisabled: true, openingDateDisabled: true, creditLimit: "1000.00", apr: "19.99", selects: 0 },
    actual: layout,
  });
  t.note(`screenshot of the reconciled card's edit dialog: ${shotCard}`);
  await b.alice.press("Escape");
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the edit dialog to close" });

  // ---- Bob (member, not a manager) sees no Edit on the shared account he cannot manage --------------
  await b.bob.goto("accounts");
  await b.bob.waitForText(joint.name, { scope: "main" });
  // BT-015: the row's actions are inside a compact "::" menu now — open it, then read its items.
  await b.bob.openRecordMenu(joint.name, { scope: "main" });
  const bobButtons = await rowButtons(b.bob, joint.name);
  t.check("Bob (a plain member) is offered no Edit on the shared account (only Who can see this)", {
    expected: { edit: false, whoCanSee: true },
    actual: { edit: (bobButtons || []).includes("Edit"), whoCanSee: (bobButtons || []).includes("Who can see this") },
  });

  // ---- every browser stayed clean --------------------------------------------------------------------
  for (const s of Object.values(b)) { await s.settle(); t.check(`${s.name}: no exceptions, console errors or failed requests in the browser`, { expected: [], actual: s.problems() }); }
}
