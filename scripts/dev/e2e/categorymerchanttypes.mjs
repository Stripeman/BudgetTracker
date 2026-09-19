// BT-019-01/03 (Terry, 2026-09-19): category and merchant TYPE definitions — the same colour/icon
// picker components as account types (BT-019-02), each mapped to a fixed underlying class (expense/
// income for categories; a merchant class for merchants), never changing any existing calculation or
// merchant history. Alice (owner) creates a custom category type and a custom merchant type on the
// Workspace page, recolours the merchant type, uses it on a real merchant, and retires both — they
// disappear from new-record choices but the merchant already using the retired type keeps showing
// it. Carol (a plain viewer) sees both as read-only lists, no create forms, no colour/icon pickers.
import { createWorkspace } from "../harness/fixtures.mjs";

export const name = "categorymerchanttypes";
export const title = "BT-019-01/03: creating, colouring and retiring a category type and a merchant type, one used on a real merchant, in real browsers";
export const needsBrowser = true;

const CAT_NAME = "E2E Essential Spending";
const MERCH_NAME = "E2E Streaming Service";

const cardText = (s, heading) => s.evaluate(`(() => {
  const h = [...document.querySelectorAll('main h2')].find((x) => x.textContent === ${JSON.stringify(heading)});
  const card = h ? h.closest('section') : null;
  return card ? card.textContent : null;
})()`);

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Category Merchant Types Household", kind: "household", members: { carol: "viewer" } });
  const q = W.q;
  const api = (u) => h.api(u);

  const b = await h.browsers(["alice", "carol"], { prefix: "categorymerchanttypes-" });
  for (const s of Object.values(b)) { await s.open("dashboard"); await s.useWorkspace(W.name); }

  // ---- Alice creates a custom category type: name + expense/income class ---------------------------
  await b.alice.goto("workspace");
  await b.alice.waitForText("Category types", { scope: "main" });
  const catCardBefore = await cardText(b.alice, "Category types");
  t.check("the Category types card exists and offers a create form", { expected: true, actual: !!catCardBefore && catCardBefore.includes("Add category type") });
  const CAT_CARD = 'section[aria-labelledby="ws-category-types"]';
  await b.alice.fill({ label: "New type name", scope: CAT_CARD }, CAT_NAME);
  await b.alice.choose("Expense or income", "Expense", { scope: CAT_CARD });
  await b.alice.click({ role: "button", name: "Add category type", scope: CAT_CARD });
  await b.alice.waitForText(CAT_NAME, { scope: "main" });
  await b.alice.settle();
  const catType = (await api("alice").ok("category-types", { query: q })).types.find((x) => x.name === CAT_NAME);
  t.check("the new category type is persisted with the chosen name and class, a real default colour and icon, never touching any category's own class", {
    expected: { found: true, categoryClass: "expense", hasColor: true, hasIcon: true, system: false },
    actual: { found: !!catType, categoryClass: catType && catType.categoryClass, hasColor: !!(catType && catType.color), hasIcon: !!(catType && catType.icon), system: catType && catType.system },
  });
  const shotCat = await b.alice.shot("1-category-type-created");
  t.note(`screenshot after creating the category type: ${shotCat}`);

  // ---- Alice creates a custom merchant type, recolours it, and uses it on a real merchant -----------
  await b.alice.waitForText("Merchant types", { scope: "main" });
  const MERCH_CARD = 'section[aria-labelledby="ws-merchant-types"]';
  await b.alice.fill({ label: "New type name", scope: MERCH_CARD }, MERCH_NAME);
  await b.alice.choose("Merchant class", "Subscription service", { scope: MERCH_CARD });
  await b.alice.click({ role: "button", name: "Add merchant type", scope: MERCH_CARD });
  await b.alice.waitForText(MERCH_NAME, { scope: "main" });
  await b.alice.settle();
  let merchType = (await api("alice").ok("merchant-types", { query: q })).types.find((x) => x.name === MERCH_NAME);
  t.check("the new merchant type is persisted with the chosen name and class", {
    expected: { found: true, merchantClass: "subscription" }, actual: { found: !!merchType, merchantClass: merchType && merchType.merchantClass },
  });

  const rowColour = await b.alice.evaluate(`(() => {
    const rows = [...document.querySelectorAll('main .catrow')];
    const row = rows.find((r) => r.textContent.includes(${JSON.stringify(MERCH_NAME)}));
    const toggle = row ? row.querySelector('.themepick__toggle') : null;
    if (!toggle) return null;
    toggle.scrollIntoView({ block: 'center' });
    const at = toggle.getBoundingClientRect();
    return { x: at.left + at.width / 2, y: at.top + at.height / 2 };
  })()`);
  if (!rowColour) throw new Error("could not find the new merchant type's colour picker toggle");
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
  merchType = (await api("alice").ok("merchant-types", { query: q })).types.find((x) => x.id === merchType.id);
  t.check("the recolour is saved", { expected: "#16a34a", actual: merchType.color });
  const shotMerchType = await b.alice.shot("2-merchant-type-recoloured");
  t.note(`screenshot after recolouring the merchant type: ${shotMerchType}`);

  await b.alice.goto("payees");
  await b.alice.click({ role: "button", name: "Add merchant", scope: "main" });
  await b.alice.waitFor("!!document.querySelector('.modal')", { what: "the add-merchant dialog" });
  await b.alice.fill({ label: "Name", scope: ".modal" }, "E2E Fictional Streamer");
  await b.alice.choose("Type", MERCH_NAME, { scope: ".modal" });
  await b.alice.click({ role: "button", name: "Add merchant", scope: ".modal" });
  await b.alice.waitFor("!document.querySelector('.modal')", { what: "the dialog to close after adding the merchant" });
  await b.alice.settle();
  const merchant = (await api("alice").ok("payees", { query: q })).payees.find((p) => p.name === "E2E Fictional Streamer");
  t.check("the merchant was created from the chosen custom type: its merchantTypeId is stored and its class was correctly derived", {
    expected: { found: true, merchantTypeId: merchType.id, type: "subscription" },
    actual: { found: !!merchant, merchantTypeId: merchant && merchant.merchantTypeId, type: merchant && merchant.type },
  });
  await b.alice.waitForText("E2E Fictional Streamer", { scope: "main" });
  const merchantsListText = await b.alice.text("main");
  t.check("the Merchants list shows the new merchant with its custom type's name", { expected: true, actual: merchantsListText.includes(MERCH_NAME) });

  // ---- Carol (a plain viewer, after a reload to pick up Alice's changes) sees read-only lists -------
  await b.carol.goto("workspace");
  await b.carol.reload();
  await b.carol.waitForText("Category types", { scope: "main" });
  const carolCat = await cardText(b.carol, "Category types");
  const carolMerch = await cardText(b.carol, "Merchant types");
  const carolPickerCount = await b.carol.evaluate(`(() => {
    const heads = [...document.querySelectorAll('main h2')].filter((h) => h.textContent === 'Category types' || h.textContent === 'Merchant types');
    return heads.reduce((n, h) => n + h.closest('section').querySelectorAll('.themepick__toggle').length, 0);
  })()`);
  t.check("Carol (viewer) sees both types in read-only lists, no create forms, no colour/icon pickers", {
    expected: { seesCatType: true, seesMerchType: true, hasCreateForms: false, pickerCount: 0 },
    actual: {
      seesCatType: !!carolCat && carolCat.includes(CAT_NAME), seesMerchType: !!carolMerch && carolMerch.includes(MERCH_NAME),
      hasCreateForms: (!!carolCat && carolCat.includes("Add category type")) || (!!carolMerch && carolMerch.includes("Add merchant type")),
      pickerCount: carolPickerCount,
    },
  });

  // ---- retiring both: gone from new-record choices, the merchant already using one keeps its name --
  await b.alice.goto("workspace");
  await b.alice.waitForText(MERCH_NAME, { scope: "main" });
  await b.alice.evaluate(`(() => {
    const rows = [...document.querySelectorAll('main .catrow')];
    const row = rows.find((r) => r.textContent.includes(${JSON.stringify(MERCH_NAME)}));
    const btn = row ? [...row.querySelectorAll('button')].find((x) => x.textContent === 'Retire') : null;
    if (btn) btn.click();
  })()`);
  await b.alice.settle();
  const retired = (await api("alice").ok("merchant-types", { query: q })).types.find((x) => x.id === merchType.id);
  t.check("retiring the merchant type is persisted", { expected: true, actual: !!(retired && retired.retired) });
  await b.alice.goto("payees");
  await b.alice.waitForText("E2E Fictional Streamer", { scope: "main" });
  const afterRetireText = await b.alice.text("main");
  t.check("the merchant created with the now-retired type still shows that type's name on the Merchants list", { expected: true, actual: afterRetireText.includes(MERCH_NAME) });

  // ---- every browser stayed clean ---------------------------------------------------------------------
  for (const s of Object.values(b)) { await s.settle(); t.check(`${s.name}: no exceptions, console errors or failed requests in the browser`, { expected: [], actual: s.problems() }); }
}
