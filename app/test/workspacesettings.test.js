// Workspace settings card (Terry, 2026-09-14: "the user should be able to decide"). Every setting comes
// from the server's one list and is rendered the same way: a command picker (BT-004-05) with the
// setting's label and its plain explanation, or a set of checkboxes for a list of kinds. Save sends only
// what changed. Someone who may not change a setting sees its value as text. Fictional data only.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, DomEvent } from "./domdouble.js";
import { nativeDropdowns, pickerLabels, pickerNamed, chooseOption, offeredOptions, triggerFor, spokenOf } from "./pickerassert.js";
import { createView as createWorkspace, settingText } from "../js/ui/views/workspace.js";
import { createView as createPlanning, defaultBudgetStart, backdateProblem } from "../js/ui/views/planning.js";
import { openBillEditor, createView as createBills } from "../js/ui/views/bills.js";
import { createView as createDashboard } from "../js/ui/views/dashboard.js";
import { navRoutes } from "../js/core/router.js";
import { createShell } from "../js/ui/shell.js";
import { createThemeController } from "../js/ui/theme.js";
import { unsavedNames, clearUnsaved } from "../js/core/unsaved.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttonNamed = (root, text) => root.querySelectorAll("button").find((b) => b.textContent === text);
const settingsCard = (root) => root.querySelectorAll("section").find((s) => s.getAttribute("aria-labelledby") === "ws-settings");

// A fictional list as the server sends it (values and labels written out here, not taken from the server).
const RESTORE_NOTE = "Members can't restore from the app yet; this applies to restores through the API.";
const LIST = (canChange, { ownerKeys = canChange } = {}) => [
  { key: "budgetPeriod", group: "Budgets", type: "choice", label: "Budget period for new budgets", explanation: "The period a new budget starts with. Anyone adding a budget can still choose another.", value: "monthly", default: "monthly", changedBy: "manager", canChange,
    options: [{ value: "monthly", label: "Monthly" }, { value: "weekly", label: "Weekly" }, { value: "biweekly", label: "Every two weeks" }] },
  { key: "weekStart", group: "Budgets", type: "choice", label: "Weeks start on", explanation: "A new weekly budget starts on this day of the week.", value: 1, default: 1, changedBy: "manager", canChange,
    options: [{ value: 1, label: "Monday" }, { value: 0, label: "Sunday" }, { value: 6, label: "Saturday" }] },
  { key: "billReminderDays", group: "Bills", type: "integer", label: "Days before the due date a new bill shows as Due soon", explanation: "New bills show under Due soon this many days before each payment. Each bill can still have its own number.", value: 3, default: 3, min: 0, max: 60, unit: "days", changedBy: "manager", canChange },
  { key: "sharedExpenses", group: "Shared expenses", type: "boolean", label: "Use Shared expenses in this workspace", explanation: "Split costs with the people in this workspace and see who owes whom.", value: true, default: true, changedBy: "manager", canChange },
  { key: "memberRestoresPerDay", group: "Restores by members", type: "integer", label: "How often a member may restore their own records", explanation: "How many restores each member may make in a day.", value: 3, default: 3, min: 0, max: 3, changedBy: "owner", canChange: ownerKeys,
    options: [{ value: 0, label: "Not allowed" }, { value: 1, label: "Once a day" }, { value: 2, label: "Up to 2 a day" }, { value: 3, label: "Up to 3 a day" }], groupNote: RESTORE_NOTE },
  { key: "memberRestoreModes", group: "Restores by members", type: "set", label: "Kinds of restore members may use", explanation: "Which kinds of restore a member may use.", value: ["create-new", "merge", "restore-deleted"], default: ["create-new", "merge", "restore-deleted"], changedBy: "owner", canChange: ownerKeys,
    options: [{ value: "create-new", label: "Create a new workspace from a backup" }, { value: "merge", label: "Merge — add missing records" }, { value: "restore-deleted", label: "Merge that also brings back deleted entries" }, { value: "replace", label: "Replace — roll records back to the backup" }],
    requires: { "restore-deleted": "merge" }, requiresMessage: "“Merge that also brings back deleted entries” needs “Merge” ticked as well." },
];

function page({ role = "owner", canChange = true, ownerKeys, history = [], settingsHistory = [], refuse = null } = {}) {
  const calls = { patches: [], refreshed: 0 };
  const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
  let list = LIST(canChange, { ownerKeys: ownerKeys === undefined ? canChange : ownerKeys });
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
        // The server's refusal, as the API client reports it (kind, code, message, details).
        if (refuse) throw Object.assign(new Error(refuse.message), { kind: "client", status: 400, code: "invalid_setting", details: { setting: refuse.setting } });
        list = list.map((s) => (Object.prototype.hasOwnProperty.call(opts.body.settings, s.key) ? { ...s, value: opts.body.settings[s.key] } : s));
        return { workspace: {} };
      }
      if (name === "workspaces") return { workspace: { history, lifecycle: [], settingsList: list, settingsHistory } };
      if (name === "members") return { former: [] };
      return {};
    },
  };
  // Like the real store: a failed write is reported, not thrown.
  const store = { getState: () => state, actions: {
    write: async (fn) => { try { await fn("ws_1"); return { ok: true }; } catch (error) { return { ok: false, error }; } },
    refreshWorkspaces: async () => { calls.refreshed += 1; return { ok: true }; },
  } };
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
const settle = async () => { for (let i = 0; i < 6; i += 1) await tick(); };
const groupToggle = (card, name) => card.querySelectorAll("button.settings-group__toggle").find((b) => b.textContent === name);
const bodyOf = (card, name) => card.querySelector(`#${groupToggle(card, name).getAttribute("aria-controls")}`);
const numberField = (card) => card.querySelector('input[type="number"]');
const fire = (node, type) => node.dispatchEvent(new DomEvent(type, { bubbles: true }));
const tickBox = (box, checked) => { box.checked = checked; fire(box, "change"); };
const boxLabelled = (card, text) => { const l = card.querySelectorAll("label").find((x) => x.textContent === text); return card.querySelector(`#${l.getAttribute("for")}`); };

describe("Settings card (shared by the workspace and group settings; UX review of eefd115)", () => {
  afterEach(() => { delete globalThis.localStorage; });

  test("controls: pickers for choices and on/off, a number field with its unit, checkboxes for kinds; no native dropdown; owner-only ones marked", async () => {
    const { card } = await open();
    assert.equal(card.querySelector("h2").textContent, "Workspace settings");
    assert.deepEqual(nativeDropdowns(card), []);
    assert.deepEqual(pickerLabels(card), ["Budget period for new budgets", "Weeks start on", "Use Shared expenses in this workspace", "How often a member may restore their own records"]);
    assert.deepEqual(offeredOptions(pickerNamed(card, "How often a member may restore their own records")), ["Not allowed", "Once a day", "Up to 2 a day", "Up to 3 a day"]);
    assert.deepEqual(offeredOptions(pickerNamed(card, "Use Shared expenses in this workspace")), ["On", "Off"]);
    const days = numberField(card);
    assert.deepEqual([days.getAttribute("min"), days.getAttribute("max"), days.getAttribute("step"), days.value], ["0", "60", "1", "3"]);
    const label = card.querySelectorAll("label").find((l) => l.getAttribute("for") === days.id);
    assert.equal(label.textContent, "Days before the due date a new bill shows as Due soon");
    const unit = card.querySelector(".input-with-unit__unit");
    assert.deepEqual([unit.textContent, unit.getAttribute("aria-hidden")], ["days", "true"]);
    assert.match(spokenOf(triggerFor(pickerNamed(card, "Weeks start on"))), /^Weeks start on: Monday/);
    assert.equal(card.querySelectorAll(".badge--source").filter((b) => b.textContent === "Owners only").length, 2, "only the two owner-only settings");
    assert.match(card.textContent, new RegExp(RESTORE_NOTE.replace(/[.']/g, ".")));
  });

  test("groups collapse under smaller in-card headings: the first open, the others closed, each person's choice remembered in this browser", async () => {
    const store = {};
    globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
    const { card } = await open();
    assert.deepEqual(card.querySelectorAll("h3").map((h) => [h.getAttribute("class"), h.textContent]),
      [["settings-group__title", "Budgets"], ["settings-group__title", "Bills"], ["settings-group__title", "Shared expenses"], ["settings-group__title", "Restores by members"]]);
    assert.deepEqual(["Budgets", "Bills"].map((n) => [groupToggle(card, n).getAttribute("aria-expanded"), bodyOf(card, n).hidden]), [["true", false], ["false", true]]);
    groupToggle(card, "Bills").click();
    assert.deepEqual([groupToggle(card, "Bills").getAttribute("aria-expanded"), bodyOf(card, "Bills").hidden], ["true", false]);
    assert.deepEqual(JSON.parse(store["bt.settingsGroups.workspace"]), { Bills: true });
    dom.teardown(); dom = installDom();
    const again = (await open()).card;
    assert.equal(groupToggle(again, "Bills").getAttribute("aria-expanded"), "true", "remembered");
    // A browser that refuses storage still shows the card, first group open.
    globalThis.localStorage = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    dom.teardown(); dom = installDom();
    const third = (await open()).card;
    assert.equal(groupToggle(third, "Budgets").getAttribute("aria-expanded"), "true");
    groupToggle(third, "Bills").click();
    assert.equal(groupToggle(third, "Bills").getAttribute("aria-expanded"), "true");
  });

  test("each explanation shows its first sentence; the rest is behind “More about this” (aria-expanded)", async () => {
    const { card } = await open();
    const more = card.querySelectorAll("button.linklike").find((b) => b.getAttribute("aria-label") === "More about this: Budget period for new budgets");
    const rest = card.querySelector(`#${more.getAttribute("aria-controls")}`);
    assert.deepEqual([more.textContent, more.getAttribute("aria-expanded"), rest.hidden, rest.textContent], ["More about this", "false", true, "Anyone adding a budget can still choose another."]);
    more.click();
    assert.deepEqual([more.getAttribute("aria-expanded"), rest.hidden, more.textContent], ["true", false, "Less about this"]);
    assert.ok(!card.querySelectorAll("button.linklike").some((b) => (b.getAttribute("aria-label") || "").endsWith("Weeks start on")), "one sentence, no button");
  });

  test("Save sends only what changed, typed, with the reason; says so, keeps focus on Save, re-reads the app's workspace list", async () => {
    const { card, calls, view } = await open();
    chooseOption(pickerNamed(card, "Weeks start on"), "Sunday");
    chooseOption(pickerNamed(card, "Use Shared expenses in this workspace"), "Off");
    chooseOption(pickerNamed(card, "How often a member may restore their own records"), "Once a day");
    numberField(card).value = "10"; fire(numberField(card), "input");
    tickBox(boxLabelled(card, "Replace — roll records back to the backup"), true);
    card.querySelector('input[placeholder="Optional"]').value = "Fictional reason";
    buttonNamed(card, "Save settings").click();
    await settle();
    assert.deepEqual(calls.patches, [{ settings: { weekStart: 0, billReminderDays: 10, sharedExpenses: false, memberRestoresPerDay: 1, memberRestoreModes: ["create-new", "merge", "restore-deleted", "replace"] }, reason: "Fictional reason" }]);
    assert.equal(calls.refreshed, 1);
    const again = settingsCard(view.element);
    assert.equal(again.querySelector('[role="status"]').textContent, "Settings saved. Everyone in the workspace now works this way.");
    assert.equal(again.querySelector(".settings-bar__unsaved").hidden, true);
    assert.ok(document.activeElement === buttonNamed(again, "Save settings"), "focus is back on Save after the card is redrawn");
    assert.equal(numberField(again).value, "10", "drawn from what is saved now");
  });

  test("an edit shows “You have unsaved changes”; Undo changes puts every value back", async () => {
    const { card, calls } = await open();
    const unsaved = card.querySelector(".settings-bar__unsaved");
    const undo = buttonNamed(card, "Undo changes");
    assert.deepEqual([unsaved.hidden, undo.disabled], [true, true]);
    chooseOption(pickerNamed(card, "Budget period for new budgets"), "Weekly");
    numberField(card).value = "7"; fire(numberField(card), "input");
    assert.deepEqual([unsaved.hidden, unsaved.textContent, undo.disabled], [false, "You have unsaved changes.", false]);
    undo.click();
    assert.equal(pickerNamed(card, "Budget period for new budgets").value, "monthly");
    assert.equal(numberField(card).value, "3");
    assert.deepEqual([unsaved.hidden, undo.disabled, card.querySelector('[role="status"]').textContent], [true, true, "Changes undone."]);
    assert.ok(document.activeElement === buttonNamed(card, "Save settings"), "focus moves to Save, not lost with the disabled Undo");
    assert.deepEqual(calls.patches, []);
  });

  test("unsaved edits are registered by the card's name, so leaving asks first; Undo, Save and leaving the page clear them (finding 3)", async () => {
    clearUnsaved();
    const { card, view } = await open();
    assert.deepEqual(unsavedNames(), []);
    chooseOption(pickerNamed(card, "Weeks start on"), "Sunday");
    assert.deepEqual(unsavedNames(), ["Workspace settings"]);
    buttonNamed(card, "Undo changes").click();
    assert.deepEqual(unsavedNames(), []);
    chooseOption(pickerNamed(card, "Weeks start on"), "Saturday");
    buttonNamed(card, "Save settings").click();
    await settle();
    assert.deepEqual(unsavedNames(), [], "saved");
    chooseOption(pickerNamed(settingsCard(view.element), "Weeks start on"), "Monday");
    assert.deepEqual(unsavedNames(), ["Workspace settings"]);
    view.destroy();
    assert.deepEqual(unsavedNames(), [], "the page is left");
  });

  test("Save with nothing changed sends nothing and says so", async () => {
    const { card, calls } = await open();
    buttonNamed(card, "Save settings").click();
    await tick();
    assert.deepEqual(calls.patches, []);
    assert.equal(card.querySelector('[role="status"]').textContent, "Nothing changed.");
  });

  test("a refusal is shown in the error style; the setting is marked invalid, points at the message, and its group opens", async () => {
    const message = "“Days before the due date a new bill shows as Due soon”: enter a whole number from 0 to 60.";
    const { card } = await open({ refuse: { setting: "billReminderDays", message } });
    numberField(card).value = "59"; fire(numberField(card), "input");
    buttonNamed(card, "Save settings").click();
    await settle();
    const error = card.querySelector(".error-text");
    assert.deepEqual([error.hidden, error.getAttribute("role"), error.textContent], [false, "alert", message]);
    const days = numberField(card);
    assert.equal(days.getAttribute("aria-invalid"), "true");
    assert.ok(days.getAttribute("aria-describedby").split(" ").includes(error.id), "points at the message");
    assert.equal(bodyOf(card, "Bills").hidden, false, "the group is opened");
    assert.equal(card.querySelector('[role="status"]').textContent, "", "not shown as help text");
    fire(days, "input");
    assert.equal(days.getAttribute("aria-invalid"), null, "editing it clears the mark");
  });

  test("a number outside 0–60 or not whole is refused in the card, before anything is sent", async () => {
    const { card, calls } = await open();
    for (const bad of ["61", "2.5", "abc", ""]) {
      numberField(card).value = bad; fire(numberField(card), "input");
      buttonNamed(card, "Save settings").click();
      await tick();
      assert.equal(card.querySelector(".error-text").textContent, "“Days before the due date a new bill shows as Due soon”: enter a whole number from 0 to 60.", bad);
    }
    assert.deepEqual(calls.patches, []);
  });

  test("“Merge that also brings back deleted entries” is unticked and unavailable while “Merge” is off", async () => {
    const { card, calls } = await open();
    const merge = boxLabelled(card, "Merge — add missing records");
    const deleted = boxLabelled(card, "Merge that also brings back deleted entries");
    assert.deepEqual([deleted.checked, deleted.disabled], [true, false]);
    tickBox(merge, false);
    assert.deepEqual([deleted.checked, deleted.disabled], [false, true]);
    tickBox(merge, true);
    assert.deepEqual([deleted.checked, deleted.disabled], [false, false]);
    tickBox(deleted, true);
    buttonNamed(card, "Save settings").click();
    await settle();
    assert.deepEqual(calls.patches, [], "back where it started: nothing changed");
  });

  test("read-only: a label–value list, who changes settings said once, owner-only marked, and the history with who, when and why", async () => {
    const settingsHistory = [{ at: "2026-09-14T10:00:00Z", by: "Alice Fictional", reason: "Sunday people", changes: [{ field: "settings.weekStart", from: 1, to: 0 }] }];
    const { card } = await open({ role: "viewer", canChange: false, settingsHistory });
    assert.equal(card.querySelectorAll("select").length + card.querySelectorAll("input").length, 0);
    assert.equal(buttonNamed(card, "Save settings"), undefined);
    const dts = card.querySelectorAll("dt").map((d) => d.textContent);
    const dds = card.querySelectorAll("dd.settings-dl__value").map((d) => d.textContent);
    assert.deepEqual(dts, ["Budget period for new budgets", "Weeks start on", "Days before the due date a new bill shows as Due soon", "Use Shared expenses in this workspace",
      "How often a member may restore their own recordsOwners only", "Kinds of restore members may useOwners only"]);
    assert.deepEqual(dds, ["Monthly", "Monday", "3 days", "On", "Up to 3 a day", "Create a new workspace from a backup, Merge — add missing records, Merge that also brings back deleted entries"]);
    const text = card.textContent;
    assert.equal(text.split("Owners and managers change them").length - 1, 1, "said once");
    assert.doesNotMatch(text, /Owners and managers change this\./);
    assert.match(text, /Changes \(1\)/);
    assert.match(text, /2026-09-14 10:00 · Alice Fictional/);
    assert.match(text, /Weeks start on: Monday → Sunday/);
    assert.match(text, /Reason: Sunday people/);
  });

  test("a manager changes the manager settings and reads the owner-only ones", async () => {
    const { card } = await open({ role: "manager", canChange: true, ownerKeys: false });
    assert.deepEqual(pickerLabels(card), ["Budget period for new budgets", "Weeks start on", "Use Shared expenses in this workspace"]);
    assert.deepEqual(card.querySelectorAll("dt").map((d) => d.textContent), ["How often a member may restore their own recordsOwners only", "Kinds of restore members may useOwners only"]);
    assert.ok(buttonNamed(card, "Save settings"));
  });

  test("Workspace changes name each setting and its values in words", async () => {
    const history = [{ at: "2026-09-14T10:00:00Z", by: "Alice Fictional", reason: "New rhythm", changes: [{ field: "settings.budgetPeriod", from: "monthly", to: "weekly" }, { field: "settings.sharedExpenses", from: true, to: false }, { field: "name", from: "A", to: "B" }] }];
    const { view } = await open({ history });
    const box = view.element.querySelectorAll("section").find((s) => s.getAttribute("aria-labelledby") === "ws-history");
    assert.match(box.textContent, /Budget period for new budgets Monthly → Weekly; Use Shared expenses in this workspace On → Off; Name A → B — New rhythm/);
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

  test("(g) a member is offered shared budgets only when the workspace lets members manage shared lists; a viewer never", () => {
    const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
    const scopesFor = (role, settingValues) => {
      const state = {
        selectedWorkspaceId: "ws_1", preferences: null,
        workspaces: [{ id: "ws_1", name: "Fictional household", role, kind: "household", settingValues }],
        accounts: ready({ accounts: [] }), categories: ready({ categories: [{ id: "cat_food", name: "Groceries", color: "#16a34a", icon: null }] }),
        budgets: ready({ budgets: [] }), forecast: ready({ forecast: { accounts: [], warnings: [], assumptions: [], horizonDays: 90 } }), bills: ready({ recurring: [] }),
      };
      const store = { getState: () => state, actions: { refreshForecast: async () => {}, refreshBudgets: async () => {}, refreshBills: async () => {}, write: async () => ({ ok: true }) } };
      const view = createPlanning({ store, api: {} });
      dom.body.appendChild(view.element);
      view.update(state);
      const add = buttonNamed(view.element, "Add budget");
      if (!add) return "no Add budget";
      add.click();
      const modals = dom.body.querySelectorAll(".modal");
      return offeredOptions(pickerNamed(modals[modals.length - 1], "Who it is for"));
    };
    const both = ["Private to me", "Shared (shared accounts only)"];
    assert.deepEqual(scopesFor("member", { sharedListManagers: "managers" }), ["Private to me"]);
    assert.deepEqual(scopesFor("member", { sharedListManagers: "members" }), both);
    assert.deepEqual(scopesFor("manager", { sharedListManagers: "managers" }), both);
    assert.equal(scopesFor("viewer", { sharedListManagers: "members" }), "no Add budget", "a viewer adds no budget at all, whatever the setting");
  });

  test("(a) the nav shows Shared expenses by the workspace setting, bounded by the site; without a setting, today's rule by kind", () => {
    const shows = (ws, site) => navRoutes(ws, site).some((r) => r.id === "group");
    assert.equal(shows({ kind: "household" }), true);
    assert.equal(shows({ kind: "personal" }), false);
    assert.equal(shows({ kind: "household", settingValues: { sharedExpenses: false } }), false);
    assert.equal(shows({ kind: "personal", settingValues: { sharedExpenses: true } }), true);
    assert.equal(shows({ kind: "group", settingValues: { sharedExpenses: true } }, { modules: { sharedExpenses: false } }), false, "the site switch wins");
    assert.equal(shows({ kind: "group", settingValues: { sharedExpenses: true } }, { modules: { sharedExpenses: true } }), true);
    assert.equal(shows(null), false, "no workspace, no section");
    assert.equal(shows("trip"), true, "a kind alone still works");
  });

  test("(a) the dashboard summary follows the same rule as the page: a household sees its balance; off hides it and loads nothing", () => {
    const dash = (settingValues, site) => {
      let refreshed = 0;
      const state = {
        selectedWorkspaceId: "ws_1", preferences: null, site: site || null,
        workspaces: [{ id: "ws_1", name: "Fictional household", kind: "household", role: "member", ...(settingValues ? { settingValues } : {}) }],
        group: { workspaceId: "ws_1", status: "ready", error: null, data: { currency: "EUR", permissions: { canAdd: true, selfRef: "member:a", role: "member" }, participants: [], expenses: [], settlements: [], balances: [] } },
      };
      const store = { getState: () => state, actions: { refreshGroup: async () => { refreshed += 1; }, refreshTransactions: async () => {}, refreshBills: async () => {}, refreshForecast: async () => {}, refreshWeekActivity: async () => {}, refreshMonthActivity: async () => {} } };
      const view = createDashboard({ store, api: {}, state });
      dom.body.appendChild(view.element);
      view.update(state);
      view.update(state);
      const text = view.element.textContent;
      dom.body.removeChild(view.element);
      return { text, refreshed };
    };
    const on = dash({ sharedExpenses: true });
    assert.match(on.text, /Your balance in Shared expenses/);
    assert.equal(on.refreshed, 1, "loaded once");
    const legacy = dash(undefined);
    assert.match(legacy.text, /Your balance in Shared expenses/, "a household with no setting stored: on, as its page always was");
    const off = dash({ sharedExpenses: false });
    assert.doesNotMatch(off.text, /Your balance/);
    assert.equal(off.refreshed, 0);
    const siteOff = dash({ sharedExpenses: true }, { modules: { sharedExpenses: false } });
    assert.doesNotMatch(siteOff.text, /Your balance/);
    assert.equal(siteOff.refreshed, 0);
  });

  test("(a) the shell: Shared expenses opened while off says so (workspace or site) and has no nav item; turned on, the real page is used", () => {
    const listeners = new Set();
    let state = {
      auth: { status: "ready", user: { name: "Bob Fictional" } }, preferences: null, site: null, app: { version: "0.0.0-test", environment: "test" },
      workspaces: [{ id: "ws_1", name: "Fictional household", kind: "household", status: "active", role: "member", settingValues: { sharedExpenses: false } }],
      selectedWorkspaceId: "ws_1",
    };
    let groupLoads = 0;
    const store = {
      getState: () => state, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      actions: { refreshGroup: async () => { groupLoads += 1; }, refreshTransactions: async () => {}, refreshBills: async () => {}, refreshForecast: async () => {}, savePreferences: async () => ({ ok: true }), selectWorkspace: async () => {} },
    };
    const commit = (patch) => { state = { ...state, ...patch }; for (const fn of listeners) fn(state); };
    const theme = createThemeController({ root: { setAttribute() {} }, storage: { getItem: () => null, setItem() {} }, media: { matches: false, addEventListener() {} } });
    const router = { current: () => ({ id: "group", params: {} }), subscribe() {}, navigate() {} };
    const mountPoint = document.createElement("div");
    dom.body.appendChild(mountPoint);
    createShell({ mountPoint, store, router, theme, api: {} }).render();
    const main = () => mountPoint.querySelector("main").textContent;
    const nav = () => mountPoint.querySelector("nav").querySelectorAll("a").map((a) => a.textContent);
    assert.match(main(), /Shared expenses are turned off in this workspace\. Nothing recorded has been removed/);
    assert.equal(nav().includes("Shared expenses"), false);
    assert.equal(groupLoads, 0, "nothing is loaded while it is off");
    commit({ workspaces: [{ ...state.workspaces[0], settingValues: { sharedExpenses: true } }], site: { modules: { sharedExpenses: false } } });
    assert.match(main(), /turned off for this site by the site administrator/);
    assert.equal(nav().includes("Shared expenses"), false);
    commit({ site: { modules: { sharedExpenses: true } } });
    assert.doesNotMatch(main(), /turned off/);
    assert.equal(nav().includes("Shared expenses"), true);
    assert.equal(groupLoads, 1, "the real page loads Shared expenses once it is on");
  });

  test("FIN-1: Add budget offers the confirmation once the server asks for it, then sends it; under “Not allowed” it is never offered", async () => {
    const run = async (budgetBackdating, answers) => {
      const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
      const state = {
        selectedWorkspaceId: "ws_1", preferences: null,
        workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner", kind: "household", settingValues: { budgetPeriod: "monthly", weekStart: 1, budgetBackdating } }],
        accounts: ready({ accounts: [] }), categories: ready({ categories: [{ id: "cat_food", name: "Groceries", color: "#16a34a", icon: null }] }),
        budgets: ready({ budgets: [] }), forecast: ready({ forecast: { accounts: [], warnings: [], assumptions: [], horizonDays: 90 } }), bills: ready({ recurring: [] }),
      };
      const sent = [];
      const api = { createBudget: async (ws, body) => { sent.push(body); const a = answers.shift(); if (a) throw Object.assign(new Error(a.message), { kind: "conflict", status: 409, code: a.code }); return {}; } };
      const store = { getState: () => state, actions: { refreshForecast: async () => {}, refreshBudgets: async () => {}, refreshBills: async () => {},
        write: async (fn) => { try { await fn("ws_1"); return { ok: true }; } catch (error) { return { ok: false, error }; } } } };
      const view = createPlanning({ store, api });
      dom.body.appendChild(view.element);
      view.update(state);
      buttonNamed(view.element, "Add budget").click();
      const modals = dom.body.querySelectorAll(".modal");
      const root = modals[modals.length - 1];
      root.querySelector('input[maxlength="80"]').value = "Fictional food";
      root.querySelector('input[inputmode="decimal"]').value = "400.00";
      root.querySelector('input[type="date"]').value = "2026-07-16";
      const confirmRow = root.querySelectorAll("label").find((l) => l.textContent === "Also count the periods that have finished");
      const hiddenBefore = confirmRow.hidden;
      buttonNamed(root, "Add budget").click();
      await tick(); await tick();
      return { root, sent, confirmRow, hiddenBefore };
    };
    const asked = await run("confirm", [{ code: "backdate_unconfirmed", message: "This budget would start before its current period (which started 2026-08-16) and count periods that have finished. Confirm that this is intended, or start it on 2026-08-16." }]);
    assert.deepEqual([asked.hiddenBefore, asked.confirmRow.hidden], [true, false], "offered once the server asks");
    assert.match(asked.root.textContent, /which started 2026-08-16/);
    assert.equal(asked.sent[0].confirmBackdate, undefined);
    asked.confirmRow.querySelector("input").checked = true;
    buttonNamed(asked.root, "Add budget").click();
    await tick(); await tick();
    assert.equal(asked.sent[1].confirmBackdate, true, "sent with the confirmation");
    dom.teardown(); dom = installDom();
    const never = await run("never", [{ code: "backdate_off", message: "This workspace does not let a new budget cover periods that have finished. Start it on 2026-08-16 or later." }]);
    assert.equal(never.confirmRow.hidden, true, "never offered under “Not allowed”");
    assert.match(never.root.textContent, /This workspace does not let a new budget start in a period that has finished\./);
    assert.match(never.root.textContent, /Start it on 2026-08-16 or later\./);
  });

  test("finding 9: the off page offers a way back — owners and managers open the setting, others are told whom to ask; a site switch-off offers neither", () => {
    const offPage = (role, site = null) => {
      const listeners = new Set();
      const state = {
        auth: { status: "ready", user: { name: "Fictional Person" } }, preferences: null, site, app: { version: "0.0.0-test", environment: "test" },
        workspaces: [{ id: "ws_1", name: "Fictional household", kind: "household", status: "active", role, settingValues: { sharedExpenses: false } }],
        selectedWorkspaceId: "ws_1",
      };
      const store = { getState: () => state, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        actions: { refreshGroup: async () => {}, refreshTransactions: async () => {}, refreshBills: async () => {}, refreshForecast: async () => {}, savePreferences: async () => ({ ok: true }), selectWorkspace: async () => {} } };
      const theme = createThemeController({ root: { setAttribute() {} }, storage: { getItem: () => null, setItem() {} }, media: { matches: false, addEventListener() {} } });
      const mountPoint = document.createElement("div");
      dom.body.appendChild(mountPoint);
      createShell({ mountPoint, store, router: { current: () => ({ id: "group", params: {} }), subscribe() {}, navigate() {} }, theme, api: {} }).render();
      const main = mountPoint.querySelector("main");
      const link = main.querySelectorAll("a").find((a) => a.textContent === "Open Workspace settings");
      const text = main.textContent;
      dom.body.removeChild(mountPoint);
      return { href: link ? link.getAttribute("href") : null, text };
    };
    for (const role of ["owner", "manager"]) {
      const page = offPage(role);
      assert.equal(page.href, "#/workspace?setting=sharedExpenses", role);
      assert.doesNotMatch(page.text, /Ask an owner or manager/, role);
    }
    for (const role of ["member", "viewer"]) {
      const page = offPage(role);
      assert.equal(page.href, null, role);
      assert.match(page.text, /Ask an owner or manager to turn it on\./, role);
    }
    const site = offPage("owner", { modules: { sharedExpenses: false } });
    assert.equal(site.href, null, "the workspace setting cannot turn it back on");
    assert.match(site.text, /turned off for this site by the site administrator/);
    assert.doesNotMatch(site.text, /Ask an owner or manager/);
  });

  test("finding 9: the Workspace page opened from that link puts focus on the setting and opens its group", async () => {
    const { ctx, state } = page();
    const view = createWorkspace({ ...ctx, params: { setting: "sharedExpenses" } });
    dom.body.appendChild(view.element);
    view.update(state);
    await settle();
    const card = settingsCard(view.element);
    assert.equal(bodyOf(card, "Shared expenses").hidden, false, "its group is open");
    assert.ok(document.activeElement === triggerFor(pickerNamed(card, "Use Shared expenses in this workspace")), "focus is on the setting");
  });

  test("finding 10: Add budget says its period is the workspace's usual one (Workspace settings)", () => {
    const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
    const state = {
      selectedWorkspaceId: "ws_1", preferences: null,
      workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner", kind: "household", settingValues: { budgetPeriod: "weekly", weekStart: 1, budgetBackdating: "confirm" } }],
      accounts: ready({ accounts: [] }), categories: ready({ categories: [{ id: "cat_food", name: "Groceries", color: "#16a34a", icon: null }] }),
      budgets: ready({ budgets: [] }), forecast: ready({ forecast: { accounts: [], warnings: [], assumptions: [], horizonDays: 90 } }), bills: ready({ recurring: [] }),
    };
    const store = { getState: () => state, actions: { refreshForecast: async () => {}, refreshBudgets: async () => {}, refreshBills: async () => {}, write: async () => ({ ok: true }) } };
    const view = createPlanning({ store, api: {} });
    dom.body.appendChild(view.element);
    view.update(state);
    buttonNamed(view.element, "Add budget").click();
    assert.match(dom.body.querySelector(".modal").textContent, /Weekly is this workspace's usual period \(Workspace settings\)\./);
  });

  test("finding 10: a new bill says where its due-soon days come from; editing a bill does not", () => {
    const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
    const state = {
      selectedWorkspaceId: "ws_1", preferences: null,
      workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner", kind: "household", settingValues: { billReminderDays: 10 } }],
      accounts: ready({ accounts: [{ id: "acc_joint", name: "Fictional joint", currency: "EUR", access: "shared", status: "open", capabilities: ["create"], icon: "bank" }] }),
      categories: ready({ categories: [] }), payees: ready({ payees: [] }), bills: ready({ recurring: [], summary: { overdue: 0, dueSoon: 0, next30Days: [] } }),
    };
    const ctx = { store: { getState: () => state, actions: { write: async () => ({ ok: true }) } }, api: { people: async () => ({ options: [] }) } };
    openBillEditor(ctx);
    // The workspace-settings explanation is now a real accessible popover (review, 2026-09-18),
    // not inert text — it must be opened to read it, and it carries a real action too.
    const popoverTrigger = dom.body.querySelector(".popover__trigger");
    assert.ok(popoverTrigger, "a new bill's due-soon field has a help popover");
    popoverTrigger.click();
    const popoverPanel = dom.body.querySelector(".popover__panel");
    assert.match(popoverPanel.textContent, /New bills start with this workspace's due-soon window \(currently 10 days\)/);
    assert.ok([...popoverPanel.querySelectorAll("button")].some((b) => b.textContent === "Go to Workspace settings"), "the popover holds a real action, not just text");
    dom.teardown(); dom = installDom();
    openBillEditor(ctx, { id: "bill_x", name: "Fictional rent", billType: "housing", kind: "expense", accountId: "acc_joint", amount: "950.00", currency: "EUR", amountType: "fixed",
      schedule: { freq: "monthly", interval: 1, startDate: "2026-01-01" }, reminderDays: 3, revision: 1, versions: [], skips: [], pauses: [], history: [] });
    assert.doesNotMatch(dom.body.querySelector(".modal").textContent, /Workspace settings/);
    assert.equal(dom.body.querySelector(".popover__trigger"), null, "editing an existing bill has no workspace-default popover — it already has its own value");
  });

  test("finding 10: recording a late bill says where its date comes from (Workspace settings); an on-time one says nothing", async () => {
    const record = async (overdueRecordDate, overdue) => {
      const ready = (data) => ({ workspaceId: "ws_1", status: "ready", error: null, data });
      const bill = { id: "bill_rent", name: "Fictional rent", billType: "housing", kind: "expense", accountId: "acc_joint", accountName: "Fictional joint",
        amount: "950.00", currency: "EUR", amountType: "fixed", schedule: { freq: "monthly", interval: 1, startDate: "2026-01-01" }, reminderDays: 3, categoryId: null, payeeId: null,
        iconSource: null, icon: "home", nextDue: "2026-09-01", revision: 1, responsible: null, overdue: overdue ? ["2026-09-01"] : [], reminders: overdue ? [] : ["2026-09-01"],
        canRecord: true, canEdit: true, inactiveReason: null, ended: false, pausedNow: false, versions: [], skips: [], pauses: [], history: [] };
      const state = {
        selectedWorkspaceId: "ws_1", preferences: null,
        workspaces: [{ id: "ws_1", name: "Fictional household", role: "owner", kind: "household", settingValues: { overdueRecordDate } }],
        accounts: ready({ accounts: [{ id: "acc_joint", name: "Fictional joint", currency: "EUR", access: "shared", status: "open", capabilities: ["create"], icon: "bank" }] }),
        categories: ready({ categories: [] }), payees: ready({ payees: [] }), bills: ready({ recurring: [bill], summary: { overdue: overdue ? 1 : 0, dueSoon: overdue ? 0 : 1, next30Days: [] } }),
      };
      const draft = { amountIsEstimate: false, amount: "950.00", date: overdueRecordDate === "due" || !overdue ? "2026-09-01" : "2026-09-14", categoryId: null, payeeId: null, payeeName: null, currency: "EUR", overdue };
      const ctx = { store: { getState: () => state, actions: { write: async () => ({ ok: true }), refreshBills: async () => {} } }, api: { billDraft: async () => ({ draft }), people: async () => ({ options: [] }) } };
      const view = createBills(ctx);
      dom.body.appendChild(view.element);
      view.update(state);
      view.element.querySelectorAll("button").find((b) => (b.getAttribute("aria-label") || "").startsWith("Review and record Fictional rent")).click();
      for (let i = 0; i < 4; i += 1) await tick();
      const text = dom.body.querySelector(".modal").textContent;
      dom.teardown(); dom = installDom();
      return text;
    };
    assert.match(await record("due", true), /Filled in with the due date \(Workspace settings\)\./);
    assert.match(await record("today", true), /Filled in with today's date \(Workspace settings\)\./);
    assert.doesNotMatch(await record("today", false), /Workspace settings/);
  });

  test("settingText writes each kind of value in words", () => {
    const [period, , days, shared, perDay, modes] = LIST(true);
    assert.equal(settingText(period, "biweekly"), "Every two weeks");
    assert.equal(settingText(days, 0), "0 days", "a number with its unit");
    assert.equal(settingText(perDay, 1), "Once a day", "a small number in words");
    assert.equal(settingText({ type: "integer" }, 7), "7");
    assert.equal(settingText(shared, false), "Off");
    assert.equal(settingText(modes, []), "None");
    assert.equal(settingText(period, "custom"), "custom");
  });
});
