// BT-022 (Terry, 2026-09-22): real CATEGORY management on the Workspace page's own "Categories &
// types" tab — genuinely distinct from category TYPES (BT-019-01, app/test/categorymerchanttypes-
// ui.test.js). A category is what is actually chosen when labelling a bill or transaction (e.g.
// "Web Development", "Groceries"); a category type is an OPTIONAL grouping label a category may
// carry, never required to add an ordinary category. Reuses the existing `POST/PATCH /api/categories`
// route exactly (never a second mutation path). Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { chooseOption, pickerNamed, offeredOptions } from "./pickerassert.js";
import { setCatalog } from "../js/ui/icons.js";
import { createView as createWorkspace } from "../js/ui/views/workspace.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const server = require("../../api/_shared/icons.js");

let dom;
beforeEach(() => { dom = installDom(); setCatalog(server.catalogView({ disabled: [], custom: [] })); });
afterEach(() => { setCatalog(null); dom.teardown(); });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 5; i += 1) await tick(); };
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);

const PALETTE = [{ id: "violet", label: "Violet", hex: "#8b5cf6" }, { id: "green", label: "Green", hex: "#16a34a" }];
const GROCERIES = { id: "cat_groceries", name: "Groceries", type: "expense", parentId: null, archived: false, color: "#16a34a", colorSource: "workspace", defaultColor: "#16a34a", icon: null, iconSource: "default", defaultIcon: "cart", categoryTypeId: null, categoryType: null };
const SALARY = { id: "cat_salary", name: "Salary", type: "income", parentId: null, archived: false, color: "#2563eb", colorSource: "default", defaultColor: "#2563eb", icon: "wallet", iconSource: "default", defaultIcon: "wallet", categoryTypeId: null, categoryType: null };
const ESSENTIAL = { id: "ctype_essential", name: "Essential spending", categoryClass: "expense", color: "#dc2626", icon: "tag", defaultIcon: "tag", system: false, retired: false, usageCount: 0 };
const INCOME_TYPE = { id: "ctype_income_only", name: "Recurring income", categoryClass: "income", color: "#2563eb", icon: "wallet", defaultIcon: "wallet", system: false, retired: false, usageCount: 0 };

function categoryPage({ role = "owner", categories = [GROCERIES, SALARY], categoryTypes = [ESSENTIAL, INCOME_TYPE] } = {}) {
  const calls = { created: [], patched: [] };
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  const state = {
    selectedWorkspaceId: "ws_1", preferences: null,
    workspaces: [{ id: "ws_1", name: "Fictional household", role }],
    members: ready({ members: [{ id: "m_me", name: "Me Fictional", role, self: true }] }),
    categories: ready({ categories, palette: PALETTE }),
    categoryTypes: ready({ types: categoryTypes, categoryClasses: ["expense", "income"], palette: PALETTE }),
    accountTypes: ready({ types: [], accountingClasses: [], palette: PALETTE }),
    merchantTypes: ready({ types: [], merchantClasses: [], palette: PALETTE }),
    icons: ready({ typeIcons: {}, canEditTypeIcons: false, catalog: null }),
  };
  const api = {
    invitations: async () => ({ invitations: [] }), backups: async () => ({ archives: [], policy: "" }), audit: async () => ({ entries: [] }),
    request: async (name, opts = {}) => {
      if (name === "workspaces") return { workspace: { history: [], lifecycle: [], settingsList: [], settingsHistory: [] } };
      if (name === "members") return { former: [] };
      if (name === "categories" && opts.method === "POST") { calls.created.push(opts.body); return { category: { ...GROCERIES, ...opts.body, id: "cat_new" } }; }
      if (name === "categories" && opts.method === "PATCH") { calls.patched.push(opts.body); return { category: { ...GROCERIES, ...opts.body } }; }
      return {};
    },
  };
  const store = { getState: () => state, actions: {
    write: async (fn) => { try { await fn("ws_1"); return { ok: true }; } catch (error) { return { ok: false, error }; } },
    refreshWorkspaces: async () => ({ ok: true }),
  } };
  return { ctx: { api, store }, state, calls };
}

const categoriesCard = (root) => root.querySelectorAll("section").find((s) => s.getAttribute("aria-labelledby") === "ws-categories");

describe("BT-022 Workspace page: real category management (Categories & types tab)", () => {
  test("an owner sees every category in a compact row (name, income/expense, colour dot) and a collapsed create form", async () => {
    const { ctx, state } = categoryPage();
    const view = createWorkspace(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    await settle();
    const card = categoriesCard(view.element);
    assert.ok(card, "the Categories card exists");
    assert.equal(card.querySelector("h2").textContent, "Categories");
    const heading3s = card.querySelectorAll("h3").map((h) => h.textContent);
    assert.ok(heading3s.some((t) => t.includes("Groceries")));
    assert.ok(heading3s.some((t) => t.includes("Salary")));
    assert.ok(card.textContent.includes("Expense"), "Groceries shows its real income/expense class");
    assert.ok(card.textContent.includes("Income"), "Salary shows its real income/expense class");
    assert.ok(buttonNamed(card, "Add category"), "a collapsed create-form toggle is offered");
    // Never required to touch a category type to see or add an ordinary category.
    assert.ok(card.textContent.toLowerCase().includes("never need"), "explains categories vs category types in plain language");
  });

  test("a viewer sees a plain, read-only list — no create form, no per-row edit at all", async () => {
    const { ctx, state } = categoryPage({ role: "viewer" });
    const view = createWorkspace(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    await settle();
    const card = categoriesCard(view.element);
    assert.equal(buttonNamed(card, "Add category"), undefined, "no creation control exists in the DOM at all for a non-editor");
    assert.equal(card.querySelectorAll(".typerow").length, 0, "no expandable edit rows either");
    assert.ok(card.textContent.includes("Groceries"));
    assert.ok(card.textContent.includes("Salary"));
  });

  test("creating a new category sends its name and chosen income/expense class — the same route every bill/transaction/budget category picker already reads from", async () => {
    const { ctx, state, calls } = categoryPage();
    const view = createWorkspace(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    await settle();
    const card = categoriesCard(view.element);
    buttonNamed(card, "Add category").click(); // expand the collapsed creation form
    const nameField = card.querySelectorAll("label").find((l) => l.textContent === "New category name");
    card.querySelector(`#${nameField.getAttribute("for")}`).value = "Web Development";
    buttonNamed(card, "Save category").click();
    await settle();
    assert.equal(calls.created.length, 1);
    assert.equal(calls.created[0].name, "Web Development");
    assert.equal(calls.created[0].type, "expense", "defaults to Expense unless Income is chosen");
  });

  test("creating a category with Income chosen sends type: income", async () => {
    const { ctx, state, calls } = categoryPage();
    const view = createWorkspace(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    await settle();
    const card = categoriesCard(view.element);
    buttonNamed(card, "Add category").click();
    const nameField = card.querySelectorAll("label").find((l) => l.textContent === "New category name");
    card.querySelector(`#${nameField.getAttribute("for")}`).value = "Freelance income";
    chooseOption(pickerNamed(card, "Income or expense"), "Income");
    buttonNamed(card, "Save category").click();
    await settle();
    assert.equal(calls.created[0].type, "income");
  });

  test("editing an existing category's name, colour and icon patches the real category — expandable per-row editor, not a permanently expanded wall of fields", async () => {
    const { ctx, state, calls } = categoryPage();
    const view = createWorkspace(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    await settle();
    const card = categoriesCard(view.element);
    const row = card.querySelectorAll(".typerow").find((r) => r.querySelector("summary").textContent.includes("Groceries"));
    assert.ok(row, "Groceries has its own expandable row");
    // domdouble's plain <details> has no native default (unlike a real browser, where `open` is
    // always false until set) — falsy is the meaningful check here, not a strict `=== false`.
    assert.ok(!row.open, "collapsed by default — not a permanently expanded wall of fields");
    // domdouble does not polyfill native <details>/<summary> click-to-toggle activation (only a real
    // browser does — already verified there for this exact row pattern during BT-021's own real-
    // browser checks: clicking a row's summary genuinely opens it). The interactions below reach
    // into `.catrow` directly regardless, exactly like the sibling account/category/merchant-type
    // row tests already do.
    row.querySelector("summary").click();
    const body = row.querySelector(".catrow");
    const nameField = body.querySelectorAll("label").find((l) => l.textContent === "Name");
    const nameInput = body.querySelector(`#${nameField.getAttribute("for")}`);
    nameInput.value = "Groceries and household";
    buttonNamed(body, "Save name").click();
    await settle();
    assert.deepEqual(calls.patched.at(-1), { categoryId: "cat_groceries", name: "Groceries and household" });
    const toggle = body.querySelector(".themepick__toggle");
    toggle.click();
    const options = dom.body.querySelectorAll('[role="option"]');
    const violet = options.find((o) => o.textContent.includes("Violet"));
    assert.ok(violet, "the real palette is offered");
    violet.click();
    await settle();
    assert.deepEqual(calls.patched.at(-1), { categoryId: "cat_groceries", color: "#8b5cf6" });
  });

  test("archiving and reopening a category patches archived — never a permanent delete here", async () => {
    const { ctx, state, calls } = categoryPage();
    const view = createWorkspace(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    await settle();
    const card = categoriesCard(view.element);
    const row = card.querySelectorAll(".typerow").find((r) => r.querySelector("summary").textContent.includes("Groceries"));
    row.querySelector("summary").click();
    const archiveBtn = [...row.querySelectorAll("button")].find((b) => b.textContent === "Archive");
    assert.ok(archiveBtn);
    archiveBtn.click();
    await settle();
    assert.deepEqual(calls.patched.at(-1), { categoryId: "cat_groceries", archived: true });
  });

  test("the optional category-type link only offers types of the SAME income/expense class, never required, and 'None' clears it", async () => {
    const { ctx, state, calls } = categoryPage({ categories: [{ ...GROCERIES, categoryTypeId: "ctype_essential", categoryType: { id: "ctype_essential", name: "Essential spending", color: "#dc2626", icon: "tag", retired: false } }] });
    const view = createWorkspace(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    await settle();
    const card = categoriesCard(view.element);
    // The linked type shows on the compact row itself, even collapsed.
    assert.ok(card.textContent.includes("Essential spending"));
    const row = card.querySelectorAll(".typerow").find((r) => r.querySelector("summary").textContent.includes("Groceries"));
    row.querySelector("summary").click();
    const body = row.querySelector(".catrow");
    const typeSelect = pickerNamed(body, "Category type (optional)");
    // An expense category (Groceries) is never offered the income-only type.
    assert.deepEqual(offeredOptions(typeSelect), ["None", "Essential spending"]);
    chooseOption(typeSelect, "None");
    await settle();
    assert.deepEqual(calls.patched.at(-1), { categoryId: "cat_groceries", categoryTypeId: null });
  });

  // BT-023 (Terry, 2026-09-22): "anything created needs to be able to be deleted. However, if
  // there are any items attached to it, warn the user X number of records will be unset or have
  // to be rechosen, and show which items are affected." Distinct from Archive above (recoverable):
  // this is permanent, reviewed first and double-confirmed, via the same generic dialog every
  // other permanently-deletable record already uses (api/_shared/deletion.js's existing
  // categoryImpact/categoryApply, now wired to a real button here for the first time).
  test("Delete permanently reviews the impact, shows how many records will lose the link, re-checks fresh before the final step, and only then permanently deletes once the name is typed to confirm", async () => {
    const { ctx, state } = categoryPage();
    let impactCalls = 0;
    ctx.api.permanentDeleteImpact = async (route, query, body) => {
      impactCalls += 1;
      assert.equal(route, "categories");
      assert.equal(query.workspaceId, "ws_1");
      assert.equal(body.categoryId, "cat_groceries");
      return {
        impact: {
          type: "category", id: "cat_groceries", label: "Groceries", confirmPhrase: "Groceries",
          blocked: false, blockers: [], cascade: [], together: [],
          severed: [{ type: "transaction", field: "categoryId", count: 3 }], autoCleanup: [], token: "tok1",
        },
      };
    };
    const executed = [];
    ctx.api.permanentDeleteExecute = async (route, query, body) => { executed.push({ route, query, body }); return { deleted: true }; };
    const view = createWorkspace(ctx);
    dom.body.appendChild(view.element);
    view.update(state);
    await settle();
    const card = categoriesCard(view.element);
    const row = card.querySelectorAll(".typerow").find((r) => r.querySelector("summary").textContent.includes("Groceries"));
    row.querySelector("summary").click();
    const body = row.querySelector(".catrow");
    const deleteBtn = [...body.querySelectorAll("button")].find((b) => b.textContent === "Delete permanently");
    assert.ok(deleteBtn, "a permanent-delete action exists alongside Archive");
    deleteBtn.click();
    await settle();
    assert.equal(impactCalls, 1);
    const dialog = dom.body.querySelector(".modal");
    assert.equal(dialog.querySelector("h2").textContent, "Permanently delete Groceries?");
    assert.ok(dialog.textContent.includes("3 transactions will keep everything else and only lose the link."), "shows which records are affected and how many");
    buttonNamed(dialog, "Continue").click();
    await settle();
    assert.equal(impactCalls, 2, "re-checks fresh right before the destructive step, never trusting a stale review");
    const confirmInput = dialog.querySelector("input");
    confirmInput.value = "Groceries";
    buttonNamed(dialog, "Permanently delete").click();
    await settle();
    assert.equal(executed.length, 1);
    assert.deepEqual(executed[0].body, { categoryId: "cat_groceries", impactToken: "tok1", typedConfirmation: "Groceries" });
  });
});
