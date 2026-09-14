// Workspace settings card (Terry, 2026-09-14: "the user should be able to decide"). Every setting comes
// from the server's one list and is rendered the same way: a command picker (BT-004-05) with the
// setting's label and its plain explanation, or a set of checkboxes for a list of kinds. Save sends only
// what changed. Someone who may not change a setting sees its value as text. Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { nativeDropdowns, pickerLabels, pickerNamed, chooseOption, offeredOptions, triggerFor, spokenOf } from "./pickerassert.js";
import { createView as createWorkspace, settingText } from "../js/ui/views/workspace.js";
import { createView as createPlanning, defaultBudgetStart, backdateProblem } from "../js/ui/views/planning.js";
import { openBillEditor } from "../js/ui/views/bills.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const settingsCard = (root) => root.querySelectorAll("section").find((s) => s.getAttribute("aria-labelledby") === "ws-settings");

// A fictional list as the server sends it (values and labels written out here, not taken from the server).
const LIST = (canChange) => [
  { key: "budgetPeriod", group: "Budgets", type: "choice", label: "Budget period for new budgets", explanation: "The period a new budget starts with. Anyone adding a budget can still choose another.", value: "monthly", default: "monthly", changedBy: "manager", canChange,
    options: [{ value: "monthly", label: "Monthly" }, { value: "weekly", label: "Weekly" }, { value: "biweekly", label: "Every two weeks" }] },
  { key: "weekStart", group: "Budgets", type: "choice", label: "Weeks start on", explanation: "A new weekly budget starts on this day of the week.", value: 1, default: 1, changedBy: "manager", canChange,
    options: [{ value: 1, label: "Monday" }, { value: 0, label: "Sunday" }, { value: 6, label: "Saturday" }] },
  { key: "billReminderDays", group: "Bills", type: "integer", label: "Show new bills as due soon (days before)", explanation: "How many days before a payment is due a new bill appears under Due soon.", value: 3, default: 3, min: 0, max: 60, changedBy: "manager", canChange },
  { key: "sharedExpenses", group: "Shared expenses", type: "boolean", label: "Shared expenses", explanation: "Split costs with the people in this workspace and see who owes whom.", value: true, default: true, changedBy: "manager", canChange },
  { key: "memberRestoreModes", group: "Restores by members", type: "set", label: "Kinds of restore members may use", explanation: "Which kinds of restore a member may use.", value: ["create-new", "merge"], default: ["create-new", "merge"], changedBy: "owner", canChange,
    options: [{ value: "create-new", label: "Create a new workspace from a backup" }, { value: "merge", label: "Merge — add missing records" }, { value: "replace", label: "Replace — roll records back to the backup" }] },
];

function page({ role = "owner", canChange = true, history = [] } = {}) {
  const calls = { patches: [], refreshed: 0 };
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  let list = LIST(canChange);
  const state = {
    selectedWorkspaceId: "ws_1", preferences: null,
    workspaces: [{ id: "ws_1", name: "Fictional household", role }],
    members: ready({ members: [{ id: "m_me", name: "Me Fictional", role, self: true }] }),
    categories: ready({ categories: [], palette: [] }), icons: ready({ typeIcons: {}, canEditTypeIcons: false, catalog: null }),
  };
  const api = {
    invitations: async () => ({ invitations: [] }), backups: async () => ({ archives: [], policy: "" }), audit: async () => ({ entries: [] }),
    request: async (name, opts = {}) => {
      if (name === "workspaces" && opts.method === "PATCH") {
        calls.patches.push(opts.body);
        list = list.map((s) => (Object.prototype.hasOwnProperty.call(opts.body.settings, s.key) ? { ...s, value: opts.body.settings[s.key] } : s));
        return { workspace: {} };
      }
      if (name === "workspaces") return { workspace: { history, lifecycle: [], settingsList: list } };
      if (name === "members") return { former: [] };
      return {};
    },
  };
  const store = { getState: () => state, actions: { write: async (fn) => { await fn("ws_1"); return { ok: true }; }, refreshWorkspaces: async () => { calls.refreshed += 1; return { ok: true }; } } };
  return { ctx: { api, store }, state, calls };
}

async function open(options) {
  const { ctx, state, calls } = page(options);
  const view = createWorkspace(ctx);
  dom.body.appendChild(view.element);
  view.update(state);
  for (let i = 0; i < 5; i += 1) await tick();
  return { view, calls, card: settingsCard(view.element) };
}

describe("Workspace settings card", () => {
  test("every setting from the list is a labelled command picker with its explanation; a list of kinds is checkboxes; no native dropdown", async () => {
    const { card } = await open();
    assert.ok(card, "the card is on the Workspace page");
    assert.equal(card.querySelector("h2").textContent, "Workspace settings");
    assert.deepEqual(nativeDropdowns(card), []);
    assert.deepEqual(pickerLabels(card), ["Budget period for new budgets", "Weeks start on", "Show new bills as due soon (days before)", "Shared expenses"]);
    assert.deepEqual(offeredOptions(pickerNamed(card, "Budget period for new budgets")), ["Monthly", "Weekly", "Every two weeks"]);
    assert.deepEqual(offeredOptions(pickerNamed(card, "Shared expenses")), ["On", "Off"]);
    assert.equal(offeredOptions(pickerNamed(card, "Show new bills as due soon (days before)")).length, 61, "0 to 60 days");
    assert.match(spokenOf(triggerFor(pickerNamed(card, "Weeks start on"))), /^Weeks start on: Monday/);
    assert.match(card.textContent, /A new weekly budget starts on this day of the week\./);
    const boxes = card.querySelectorAll('input[type="checkbox"]');
    assert.deepEqual(boxes.map((b) => b.checked), [true, true, false]);
    assert.deepEqual(card.querySelectorAll("h3").map((h) => h.textContent), ["Budgets", "Bills", "Shared expenses", "Restores by members"]);
  });

  test("Save sends only what changed, typed as the server expects, with the reason; the app's workspace list is re-read", async () => {
    const { card, calls, view } = await open();
    chooseOption(pickerNamed(card, "Weeks start on"), "Sunday");
    chooseOption(pickerNamed(card, "Show new bills as due soon (days before)"), "10");
    chooseOption(pickerNamed(card, "Shared expenses"), "Off");
    card.querySelectorAll('input[type="checkbox"]')[2].checked = true;
    card.querySelector('input[placeholder="Optional"]').value = "Fictional reason";
    buttonNamed(card, "Save workspace settings").click();
    for (let i = 0; i < 5; i += 1) await tick();
    assert.deepEqual(calls.patches, [{ settings: { weekStart: 0, billReminderDays: 10, sharedExpenses: false, memberRestoreModes: ["create-new", "merge", "replace"] }, reason: "Fictional reason" }]);
    assert.equal(calls.refreshed, 1);
    const again = settingsCard(view.element);
    assert.match(again.textContent, /Saved\. Everyone in the workspace now works this way\./);
    assert.ok(document.activeElement === buttonNamed(again, "Save workspace settings"), "focus is back on Save after the card is redrawn");
  });

  test("Save with nothing changed sends nothing and says so", async () => {
    const { card, calls } = await open();
    buttonNamed(card, "Save workspace settings").click();
    await tick();
    assert.deepEqual(calls.patches, []);
    assert.match(card.textContent, /Nothing changed\./);
  });

  test("someone who may not change the settings sees each value in words and who changes it, with no controls", async () => {
    const { card } = await open({ role: "member", canChange: false });
    assert.equal(card.querySelectorAll("select").length, 0);
    assert.equal(card.querySelectorAll("input").length, 0);
    assert.equal(buttonNamed(card, "Save workspace settings"), undefined);
    for (const text of ["Monthly", "Monday", "On", "Create a new workspace from a backup, Merge — add missing records", "Owners and managers change this.", "Only owners change this."]) assert.ok(card.textContent.includes(text), text);
  });

  test("Workspace changes name each setting and its values in words", async () => {
    const history = [{ at: "2026-09-14T10:00:00Z", by: "Alice Fictional", reason: "New rhythm", changes: [{ field: "settings.budgetPeriod", from: "monthly", to: "weekly" }, { field: "settings.sharedExpenses", from: true, to: false }, { field: "name", from: "A", to: "B" }] }];
    const { view } = await open({ history });
    const box = view.element.querySelectorAll("section").find((s) => s.getAttribute("aria-labelledby") === "ws-history");
    assert.match(box.textContent, /Budget period for new budgets Monthly → Weekly; Shared expenses On → Off; Name A → B — New rhythm/);
  });

  test("(i) a new budget's start: the first of the month, or the latest week-start day on or before today", () => {
    // 2026-09-13 is a Sunday; 2026-09-16 a Wednesday.
    assert.equal(defaultBudgetStart("monthly", 1, "2026-09-13"), "2026-09-01");
    assert.equal(defaultBudgetStart("weekly", 1, "2026-09-13"), "2026-09-07");
    assert.equal(defaultBudgetStart("weekly", 0, "2026-09-13"), "2026-09-13");
    assert.equal(defaultBudgetStart("biweekly", 6, "2026-09-13"), "2026-09-12");
    assert.equal(defaultBudgetStart("weekly", 1, "2026-09-16"), "2026-09-14");
    assert.equal(defaultBudgetStart("weekly", 6, "2026-03-01"), "2026-02-28", "across a month end");
  });

  test("(i) with \"Never\", a date before the current period is refused even when confirmed; otherwise today's rule", () => {
    assert.equal(backdateProblem("2026-09-01", "2026-09-01", false, { never: true }), null);
    assert.match(backdateProblem("2026-08-15", "2026-09-01", true, { never: true }), /does not let budget changes apply to periods that have finished/);
    assert.equal(backdateProblem("2026-08-15", "2026-09-01", true), null);
    assert.match(backdateProblem("2026-08-15", "2026-09-01", false), /Tick “Also change finished periods”/);
  });

  test("(i) Add budget starts with the workspace's period, and its start is on the workspace's week start", async () => {
    const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
    const state = {
      selectedWorkspaceId: "ws_1", preferences: null,
      workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner", kind: "household", settingValues: { budgetPeriod: "weekly", weekStart: 0, budgetBackdating: "confirm" } }],
      accounts: ready({ accounts: [] }), categories: ready({ categories: [{ id: "cat_food", name: "Groceries", color: "#16a34a", icon: null }] }),
      budgets: ready({ budgets: [] }), forecast: ready({ forecast: { accounts: [], warnings: [], assumptions: [], horizonDays: 90 } }), bills: ready({ recurring: [] }),
    };
    const store = { getState: () => state, actions: { refreshForecast: async () => {}, refreshBudgets: async () => {}, refreshBills: async () => {}, write: async () => ({ ok: true }) } };
    const view = createPlanning({ store, api: {} });
    dom.body.appendChild(view.element);
    view.update(state);
    buttonNamed(view.element, "Add budget").click();
    const root = dom.body.querySelector(".modal");
    assert.match(spokenOf(triggerFor(pickerNamed(root, "Period"))), /^Period: Weekly/);
    const start = root.querySelector('input[type="date"]').value;
    const today = new Date().toISOString().slice(0, 10);
    const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
    assert.equal(new Date(`${start}T00:00:00Z`).getUTCDay(), 0, `${start} is a Sunday`);
    assert.ok(days >= 0 && days <= 6, `${start} is the latest Sunday on or before ${today}`);
    chooseOption(pickerNamed(root, "Period"), "Monthly");
    assert.equal(root.querySelector('input[type="date"]').value, `${today.slice(0, 8)}01`, "a monthly budget is offered the first of the month");
  });

  test("(j) Add bill starts with the workspace's due-soon days (3 when it has none); editing keeps the bill's own", () => {
    const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
    const stateWith = (settingValues) => ({
      selectedWorkspaceId: "ws_1", preferences: null,
      workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner", kind: "household", ...(settingValues ? { settingValues } : {}) }],
      accounts: ready({ accounts: [{ id: "acc_joint", name: "Fictional joint", currency: "EUR", access: "shared", status: "open", capabilities: ["create"], icon: "bank" }] }),
      categories: ready({ categories: [] }), payees: ready({ payees: [] }), bills: ready({ recurring: [], summary: { overdue: 0, dueSoon: 0, next30Days: [] } }),
    });
    const reminderIn = (settingValues, bill) => {
      const state = stateWith(settingValues);
      const ctx = { store: { getState: () => state, actions: { write: async () => ({ ok: true }) } }, api: { people: async () => ({ options: [] }) } };
      openBillEditor(ctx, bill);
      const modals = dom.body.querySelectorAll(".modal");
      return modals[modals.length - 1].querySelector('input[type="number"][max="60"]').value;
    };
    assert.equal(reminderIn({ billReminderDays: 10 }), "10");
    assert.equal(reminderIn({ billReminderDays: 0 }), "0");
    assert.equal(reminderIn(null), "3");
  });

  test("settingText writes each kind of value in words", () => {
    const [period, , days, shared, modes] = LIST(true);
    assert.equal(settingText(period, "biweekly"), "Every two weeks");
    assert.equal(settingText(days, 0), "0");
    assert.equal(settingText(shared, false), "Off");
    assert.equal(settingText(modes, []), "None");
    assert.equal(settingText(period, "custom"), "custom");
  });
});
