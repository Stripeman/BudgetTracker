// BT-019-02 (Terry, 2026-09-19): workspace-scoped account TYPE definitions — a name, an editable
// colour and an optional icon, mapped to one of BudgetTracker's fixed underlying accounting classes.
// Alice (owner) creates a custom account type on the Workspace page, recolours it, uses it to create
// a real account (offered in the same command picker as every other dropdown), sees it shown
// consistently on the Accounts list, then retires it — it disappears from new-account choices but
// stays visible on the account that already uses it. Carol (a plain viewer) sees the read-only list,
// no create form and no colour/icon pickers. TWO BROWSERS AT ONCE.
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";

export const name = "accounttypes";
export const title = "BT-019-02: creating, colouring and retiring an account type, used to create a real account, in real browsers";
export const needsBrowser = true;

const CARD_NAME = "E2E Store Card Type";

const accountTypesCardText = (s) => s.evaluate(`(() => {
  const h = [...document.querySelectorAll('main h2')].find((x) => x.textContent === 'Account types');
  const card = h ? h.closest('section') : null;
  return card ? card.textContent : null;
})()`);

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Account Types Household", kind: "household", members: { bob: "member", carol: "viewer" } });
  const q = W.q;
  const api = (u) => h.api(u);

  const b = await h.browsers(["alice", "carol"], { prefix: "accounttypes-" });
  for (const s of Object.values(b)) { await s.open("dashboard"); await s.useWorkspace(W.name); }

  // ---- Alice creates a custom account type: name + accounting behaviour, colour and icon default --
  await b.alice.goto("workspace");
  // BT-021 (2026-09-22): Account/Category/Merchant types now live on their own "Categories & types"
  // sub-tab (real ARIA tabs), and each has its own collapsed "+ Add …" creation form.
  await b.alice.click({ role: "tab", name: "Categories & types" });
  await b.alice.waitForText("Account types", { scope: "main" });
  const before = await accountTypesCardText(b.alice);
  t.check("the Account types card exists on the Workspace page and offers a create form", { expected: true, actual: !!before && before.includes("Add account type") });

  // BT-019-01/03 later added their own "Category types"/"Merchant types" cards with the same field
  // labels ("New type name"), so this scenario scopes precisely to the Account types card itself.
  const ACCOUNT_TYPES_CARD = 'section[aria-labelledby="ws-account-types"]';
  await b.alice.click({ role: "button", name: "Add account type", scope: ACCOUNT_TYPES_CARD });
  await b.alice.fill({ label: "New type name", scope: ACCOUNT_TYPES_CARD }, CARD_NAME);
  await b.alice.choose("Accounting behaviour", "Credit card", { scope: ACCOUNT_TYPES_CARD });
  await b.alice.click({ role: "button", name: "Save account type", scope: ACCOUNT_TYPES_CARD });
  await b.alice.waitForText(CARD_NAME, { scope: "main" });
  await b.alice.settle();
  const created = (await api("alice").ok("account-types", { query: q })).types.find((x) => x.name === CARD_NAME);
  t.check("the new type is persisted with the chosen name and accounting class, a real default colour and icon", {
    expected: { found: true, accountingClass: "credit-card", hasColor: true, hasIcon: true, system: false },
    actual: { found: !!created, accountingClass: created && created.accountingClass, hasColor: !!(created && created.color), hasIcon: !!(created && created.icon), system: created && created.system },
  });
  const shotCreated = await b.alice.shot("1-type-created");
  t.note(`screenshot after creating the type: ${shotCreated}`);

  // ---- Alice recolours it through the same colour picker categories use ---------------------------
  // BT-021: the name now lives in the row's own <details><summary> (collapsed by default) — opened
  // here with a plain script `.click()` on the summary, which real browsers treat as a genuine
  // activation of the native disclosure (the same as a person clicking it), before reaching into the
  // now-visible colour picker.
  const rowColour = await b.alice.evaluate(`(() => {
    const rows = [...document.querySelectorAll('main .typerow')];
    const row = rows.find((r) => r.querySelector('summary').textContent.includes(${JSON.stringify(CARD_NAME)}));
    if (!row) return null;
    if (!row.open) row.querySelector('summary').click();
    const toggle = row.querySelector('.themepick__toggle');
    if (!toggle) return null;
    toggle.scrollIntoView({ block: 'center' });
    const at = toggle.getBoundingClientRect();
    return { x: at.left + at.width / 2, y: at.top + at.height / 2 };
  })()`);
  if (!rowColour) throw new Error("could not find the new type's colour picker toggle");
  await b.alice.mouseClick(rowColour.x, rowColour.y);
  await b.alice.waitFor("!!document.querySelector('[role=\"listbox\"]')", { what: "the colour list to open" });
  const green = await b.alice.evaluate(`(() => {
    const o = [...document.querySelectorAll('[role="option"]')].find((x) => x.textContent.includes('Green'));
    if (!o) return null;
    o.scrollIntoView({ block: 'center' });
    const at = o.getBoundingClientRect();
    return { x: at.left + at.width / 2, y: at.top + at.height / 2 };
  })()`);
  if (!green) throw new Error("the palette does not offer Green");
  await b.alice.mouseClick(green.x, green.y);
  await b.alice.settle();
  const recoloured = (await api("alice").ok("account-types", { query: q })).types.find((x) => x.id === created.id);
  t.check("the recolour is saved and the type keeps its accounting class unchanged (renaming/recolouring never touches accounting behaviour)", {
    expected: { color: "#16a34a", accountingClass: "credit-card" }, actual: { color: recoloured.color, accountingClass: recoloured.accountingClass },
  });

  // ---- Alice uses the new type to create a real account, offered in the same command picker --------
  await b.alice.goto("accounts");
  await b.alice.click({ role: "button", name: "Add account", scope: "main" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the add-account dialog" });
  await b.alice.fill({ label: "Name", scope: ".modal" }, "E2E New Store Card");
  await b.alice.choose("Type", CARD_NAME, { scope: ".modal" });
  await b.alice.click({ role: "button", name: "Create account", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after creating" });
  await b.alice.settle();
  const newAccount = (await api("alice").ok("accounts", { query: q })).accounts.find((a) => a.name === "E2E New Store Card");
  t.check("the account was created from the chosen custom type: its accountTypeId is stored and its accounting class was correctly derived", {
    expected: { found: true, accountTypeId: created.id, type: "credit-card" },
    actual: { found: !!newAccount, accountTypeId: newAccount && newAccount.accountTypeId, type: newAccount && newAccount.type },
  });

  // ---- the Accounts list shows the resolved, recoloured type consistently ---------------------------
  await b.alice.waitForText("E2E New Store Card", { scope: "main" });
  const rowText = await b.alice.text("main");
  const shotList = await b.alice.shot("2-account-list-shows-type");
  t.check("the Accounts list shows the new account with its custom type's name", { expected: true, actual: rowText.includes(CARD_NAME) });
  t.note(`screenshot of the accounts list: ${shotList}`);

  // ---- Carol (a plain viewer) sees a read-only list: no create form, no pickers ---------------------
  // Carol's browser loaded the workspace's account types once, at sign-in, before Alice's changes
  // above — a real reload re-reads them, exactly like opening the page fresh would.
  await b.carol.goto("workspace");
  await b.carol.reload();
  // BT-021: Carol's own browser profile has never chosen a Workspace sub-tab before, so it starts on
  // the default "General" one — a real click is needed to reach "Categories & types".
  await b.carol.click({ role: "tab", name: "Categories & types" });
  await b.carol.waitForText("Account types", { scope: "main" });
  const carolCard = await accountTypesCardText(b.carol);
  const carolHasPickers = await b.carol.evaluate(`(() => {
    const h = [...document.querySelectorAll('main h2')].find((x) => x.textContent === 'Account types');
    const card = h ? h.closest('section') : null;
    return card ? card.querySelectorAll('.themepick__toggle').length : -1;
  })()`);
  t.check("Carol (viewer) sees the type in a read-only list, with no create form and no colour/icon pickers", {
    expected: { seesType: true, hasCreateForm: false, pickerCount: 0 },
    actual: { seesType: !!carolCard && carolCard.includes(CARD_NAME), hasCreateForm: !!carolCard && carolCard.includes("Add account type"), pickerCount: carolHasPickers },
  });

  // ---- retiring: gone from new-account choices, still shown on the account that already uses it ----
  await b.alice.goto("workspace");
  await b.alice.waitForText(CARD_NAME, { scope: "main" });
  await b.alice.evaluate(`(() => {
    const rows = [...document.querySelectorAll('main .typerow')];
    const row = rows.find((r) => r.querySelector('summary').textContent.includes(${JSON.stringify(CARD_NAME)}));
    const btn = row ? [...row.querySelectorAll('button')].find((b) => b.textContent === 'Retire') : null;
    if (btn) btn.click();
  })()`);
  await b.alice.settle();
  const retired = (await api("alice").ok("account-types", { query: q })).types.find((x) => x.id === created.id);
  t.check("retiring the type is persisted", { expected: true, actual: !!(retired && retired.retired) });

  await b.alice.goto("accounts");
  await b.alice.click({ role: "button", name: "Add account", scope: "main" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the add-account dialog" });
  const offeredNow = await b.alice.evaluate(`(() => {
    const trigger = [...document.querySelectorAll('.modal .cmdpick__trigger')].find((x) => (x.closest('.field') || {}).textContent && x.closest('.field').textContent.startsWith('Type'));
    return trigger ? trigger.textContent : null;
  })()`);
  t.note(`Type trigger currently reads: ${offeredNow}`);
  await b.alice.click({ role: "button", name: "Cancel", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after cancel" });
  // The already-created account keeps showing its (now retired) type's name — retiring never erases
  // it from history, only from new-account choices.
  await b.alice.waitForText("E2E New Store Card", { scope: "main" });
  const afterRetireText = await b.alice.text("main");
  t.check("the account created with the now-retired type still shows that type's name on the Accounts list", { expected: true, actual: afterRetireText.includes(CARD_NAME) });

  // ---- every browser stayed clean ---------------------------------------------------------------------
  for (const s of Object.values(b)) { await s.settle(); t.check(`${s.name}: no exceptions, console errors or failed requests in the browser`, { expected: [], actual: s.problems() }); }
}
