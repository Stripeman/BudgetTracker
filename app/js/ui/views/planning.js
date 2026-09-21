// Planning (BT-008-01): budgets, the cash-flow forecast and what-if.
//
// BUDGETS show, per category, planned + carried over − spent − still owed from bills = available;
// refunds reduce spending and a recorded bill counts as spent, never twice. Shared budgets count
// shared accounts only, so members' private spending never appears in them.
// THE FORECAST projects accounts whose balance you may see, with upcoming items only where their
// entries are shared with you; it warns when a balance would fall below zero or below your buffer
// and names the bills that lead there. WHAT-IF applies changes to a copy in memory on the server
// and never saves anything.
import { el, mount, announce } from "../dom.js";
import { stateView, money, amountText, button, field, input, pickerSelect, categoryBadges, badge, categoryLabel } from "../components.js";
import { categoryIndex } from "../../core/categories.js";
import { openModal } from "../modal.js";
import { openDeleteDialog } from "../permanentdelete.js";
import { sliceFor } from "../../core/store.js";
import { formatDate, formatAmount, todayIso } from "../../core/format.js";
import { messageFor } from "../../core/errors.js";
import { icon, withIcon } from "../icons.js";
import { createIconPicker, iconChange } from "../iconpicker.js";
import { managesSharedLists } from "../../core/workspacesettings.js";
import { effectiveLayoutId, layoutAccentVars } from "../../core/layoutmeta.js";

// Account icons for the forecast tables (BT-011-05), from the accounts the viewer may see.
const accountIcons = (state) => new Map(((sliceFor(state, "accounts").data || {}).accounts || []).map((a) => [a.id, a.icon]));

const HORIZONS = [{ value: "30", label: "30 days" }, { value: "60", label: "60 days" }, { value: "90", label: "90 days" }, { value: "365", label: "12 months" }];
const PERIODS = [{ value: "monthly", label: "Monthly" }, { value: "biweekly", label: "Every 2 weeks" }, { value: "weekly", label: "Weekly" }];

// A plan change dated before the current period changes periods that have finished, so it needs an
// explicit confirmation; the server refuses it otherwise (FIN-R14). Returns the message or null.
export function backdateProblem(effectiveFrom, periodStart, confirmed, { never = false } = {}) {
  if (!effectiveFrom || !periodStart || effectiveFrom >= periodStart) return null;
  // The workspace setting "Budget changes may apply to past periods: Never" (the server refuses too).
  if (never) return `This workspace does not let budget changes apply to periods that have finished. Choose ${formatDate(periodStart)} or later.`;
  if (confirmed) return null;
  return "This date is before the current period, so it would change periods that have already finished. Tick “Also change finished periods” to confirm, or choose a later date.";
}

// The start a new budget is offered (workspace settings, Terry 2026-09-14), the same rule as the server:
// the first of the month for a monthly budget; for a weekly or two-weekly one the latest day on or before
// `today` that is the workspace's week start (0 Sunday, 1 Monday, 6 Saturday).
export function defaultBudgetStart(period, weekStart, today) {
  if (period === "monthly") return `${today.slice(0, 8)}01`;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - weekStart + 7) % 7));
  return d.toISOString().slice(0, 10);
}

export function warningText(w, fmt, dateFormat) {
  const when = formatDate(w.date, dateFormat);
  const after = w.obligations && w.obligations.length ? ` after ${w.obligations.join(", ")}` : "";
  if (w.type === "below-zero") return `${w.accountName} may go below zero on ${when}${after} (${fmt(w.balance, w.currency)}).`;
  return `${w.accountName} may drop below your buffer of ${fmt(w.buffer, w.currency)} on ${when}${after}.`;
}

function meter(used, total) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : used > 0 ? 100 : 0;
  return el("div", { class: "meter", "aria-hidden": "true" }, [el("div", { class: ["meter__fill", used > total ? "meter__fill--over" : ""], vars: { "--fill": `${pct.toFixed(1)}%` } })]);
}

export function createView(ctx) {
  const budgetsBox = el("div", { class: "stack" });
  // One persistent status region, updated only when the warnings change (A11Y2-009).
  const warningsBox = el("div", { role: "status", "aria-live": "polite" });
  const forecastBox = el("div");
  const whatIfBox = el("div");
  let warningsSig = "";
  const budgetActions = el("div", { class: "page-head__actions" });
  // Archived budgets stay reachable and can be restored; nothing is deleted (BT-001-05).
  const archivedList = el("div", { class: "stack" });
  const archivedBox = el("details", { class: "more" }, [el("summary", { text: "Archived budgets" }), archivedList]);
  const dateFormat = () => ((ctx.store.getState().preferences || {}).effective || {}).dateFormat;
  const loadArchived = async () => {
    mount(archivedList, el("p", { class: "muted small", role: "status", text: "Loading…" }));
    try {
      const data = await ctx.api.budgets(ctx.store.getState().selectedWorkspaceId, { includeArchived: "1" });
      const archived = data.budgets.filter((b) => b.archived);
      mount(archivedList, archived.length ? el("ul", { class: "stack" }, archived.map((b) => el("li", { class: "row" }, [
        withIcon(b.icon, b.name), badge("Archived", "closed"),
        el("span", { class: "muted small", text: `${formatDate(String(b.archivedAt).slice(0, 10), dateFormat())}${b.archiveReason ? ` — ${b.archiveReason}` : ""}` }),
        el("span", { class: "app__spacer" }),
        b.canEdit ? button("Restore", () => openBudgetLifecycle(ctx, b, false, loadArchived), { small: true, attrs: { "aria-label": `Restore budget ${b.name}` } }) : null,
      ]))) : el("p", { class: "muted small", text: "No archived budgets." }));
    } catch (err) { mount(archivedList, el("p", { class: "error-text", role: "alert", text: messageFor(err) })); }
  };
  archivedBox.addEventListener("toggle", () => { if (archivedBox.open) void loadArchived(); });
  // The dropdowns on this page are TaskTracker's command picker (BT-004-05).
  const horizon = pickerSelect(HORIZONS, "90", {}, { search: false });
  const buffer = input({ inputmode: "decimal", placeholder: "Optional, e.g. 500.00" });
  const run = button("Update forecast", () => refresh());
  // BT-013-16: the SAME persistent elements every layout reuses (budgets, archived list, forecast
  // filters/warnings/table, what-if) — nothing about budgeting/forecast calculation, filtering or
  // permission logic differs; only the surrounding wrapper/card styling per layout, exactly like
  // app/js/ui/views/transactions.js and bills.js.
  const bodyHost = el("div");
  const element = el("section", {}, [el("div", { class: "page-head" }, [el("h1", { text: "Planning" })]), bodyHost]);
  const classicArrangement = el("div", {}, [
    el("div", { class: "page-head" }, [el("h2", { class: "section-title" }, [withIcon("target", "Budgets")]), budgetActions]),
    budgetsBox,
    archivedBox,
    el("h2", { class: "section-title" }, [withIcon("chart-line", "Cash flow")]),
    el("p", { class: "muted", text: "Projected balances from today, including bills that are due and not yet recorded, skipped or paused. Only accounts whose balance you can see are included." }),
    el("div", { class: "filters" }, [field("Look ahead", horizon), field("Warn me below", buffer), el("div", { class: "filters__actions" }, [run])]),
    warningsBox, forecastBox,
    el("h2", { class: "section-title", text: "What if…" }),
    whatIfBox,
  ]);
  const FLAGSHIP_IDS = new Set(["ledgerfly-forecast", "finexa-budget", "acru-overview"]);
  let mountedLayout = null;
  function arrangementFor(layoutId) {
    if (!FLAGSHIP_IDS.has(layoutId)) return classicArrangement;
    return el("div", { class: "dashflag", vars: layoutAccentVars(ctx.store.getState(), layoutId) }, [
      el("section", { class: "card", "aria-labelledby": "plan-budgets" }, [
        el("div", { class: "row" }, [el("h2", { class: "card__title", id: "plan-budgets" }, [withIcon("target", "Budgets")]), budgetActions]),
        budgetsBox, archivedBox,
      ]),
      el("section", { class: "card", "aria-labelledby": "plan-cashflow" }, [
        el("h2", { class: "card__title", id: "plan-cashflow" }, [withIcon("chart-line", "Cash flow")]),
        el("p", { class: "muted small", text: "Projected balances from today, including bills that are due and not yet recorded, skipped or paused. Only accounts whose balance you can see are included." }),
        el("div", { class: "filters" }, [field("Look ahead", horizon), field("Warn me below", buffer), el("div", { class: "filters__actions" }, [run])]),
        warningsBox, forecastBox,
      ]),
      el("section", { class: "card", "aria-labelledby": "plan-whatif" }, [el("h2", { class: "card__title", id: "plan-whatif", text: "What if…" }), whatIfBox]),
    ]);
  }
  const params = () => ({ horizon: horizon.value, ...(buffer.value.trim() ? { buffer: buffer.value.trim() } : {}) });
  const refresh = () => ctx.store.actions.refreshForecast(params());
  commitOnEnter(buffer, refresh);
  horizon.addEventListener("change", () => void refresh());
  void ctx.store.actions.refreshBudgets();
  void ctx.store.actions.refreshBills();
  void refresh();
  const whatIf = createWhatIf(ctx, params);
  mount(whatIfBox, whatIf.element);

  function update(state) {
    const ws = (state.workspaces || []).find((w) => w.id === state.selectedWorkspaceId);
    const layoutId = effectiveLayoutId(state, ws);
    if (mountedLayout !== layoutId) { mount(bodyHost, arrangementFor(layoutId)); mountedLayout = layoutId; }
    const eff = (state.preferences && state.preferences.effective) || {};
    const plain = { effective: { ...eff, balanceMasking: false } };
    const fmt = (v, c) => formatAmount(v, c, { numberFormat: eff.numberFormat });
    const role = ws ? ws.role : null;
    mount(budgetActions, role && role !== "viewer"
      ? (state.layoutPreview
        ? button("Add budget", () => {}, { variant: "primary", attrs: { disabled: true, "aria-disabled": "true", title: "This is a read-only layout preview. Exit preview to make changes." } })
        : button("Add budget", () => openBudgetEditor(ctx), { variant: "primary" }))
      : null);

    const budgets = sliceFor(state, "budgets");
    const bs = stateView(budgets, { empty: "No budgets yet. Add one to plan spending by category.", isEmpty: (d) => !d.budgets.length });
    if (bs) mount(budgetsBox, bs);
    else { const cats = categoryIndex(state); mount(budgetsBox, ...budgets.data.budgets.map((b) => budgetCard(ctx, b, plain, fmt, eff.dateFormat, cats))); }

    const fc = sliceFor(state, "forecast");
    const fs = stateView(fc, { empty: "No accounts to project.", isEmpty: (d) => !d.forecast.accounts.length });
    if (fs) { warningsSig = ""; mount(warningsBox); mount(forecastBox, fs); } else {
      const f = fc.data.forecast;
      const sig = JSON.stringify([f.warnings, buffer.value.trim(), horizon.value]);
      if (sig !== warningsSig) {
        warningsSig = sig;
        mount(warningsBox, f.warnings.length
          ? el("div", { class: "notice notice--warning" }, [el("h3", { class: "card__title", text: "Cash-flow warnings" }), el("ul", { class: "stack" }, f.warnings.map((w) => el("li", { text: warningText(w, fmt, eff.dateFormat) })))])
          : el("p", { class: "muted", text: `No balance is projected to fall below zero${buffer.value.trim() ? " or your buffer" : ""} in the next ${horizon.options ? horizon.options[horizon.selectedIndex].text : `${f.horizonDays} days`}.` }));
      }
      mount(forecastBox,
        // One pair of terms, defined where they are used (UX2-003).
        el("p", { class: "muted small", text: "Cautious leaves out estimated income; hopeful leaves out estimated expenses such as variable bills." }),
        forecastTable(f, plain, eff.dateFormat, "Cash-flow forecast", null, accountIcons(state)),
        el("details", { class: "more" }, [el("summary", { text: "How this is worked out" }), el("ul", {}, f.assumptions.map((a) => el("li", { text: a })))]));
      whatIf.setBaseline(f);
    }
    const bills = sliceFor(state, "bills").data;
    const accounts = ((sliceFor(state, "accounts").data || {}).accounts || []).filter((a) => !a.deletedAt && a.balance !== undefined);
    whatIf.setChoices(accounts, bills ? bills.recurring : []);
  }
  return { element, update };
}

function commitOnEnter(control, fn) {
  control.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); void fn(); } });
}

function forecastTable(f, prefs, dateFormat, label, compare = null, icons = new Map()) {
  const nameOf = (a) => (icons.get(a.accountId) ? withIcon(icons.get(a.accountId), a.name) : el("span", { text: a.name }));
  const headers = compare ? ["Account", "Today", "Expected end", "With changes", "Lowest with changes"] : ["Account", "Today", "Expected end", "Lowest", "Cautious end", "Hopeful end"];
  return el("div", { class: "table-wrap" }, [el("table", { class: "table table--cards", "aria-label": label }, [
    el("thead", {}, [el("tr", {}, headers.map((h) => el("th", { scope: "col", class: h === "Account" ? "" : "num", text: h })))]),
    el("tbody", {}, f.accounts.map((a) => {
      if (a.error) {
        return el("tr", {}, [
          el("th", { scope: "row", "data-label": "Account" }, [nameOf(a)]),
          el("td", { "data-label": "Today", class: "num" }, [money(a.start, a.currency, prefs)]),
          el("td", { "data-label": "", colspan: compare ? "3" : "4", text: "Too large to project exactly." }),
        ]);
      }
      const base = compare && compare.accounts.find((x) => x.accountId === a.accountId);
      // One block, so the amount and its date stay together in narrow card rows (UX2-013).
      const lowest = [el("div", {}, [money(a.expected.lowest.amount, a.currency, prefs), el("div", { class: "muted small", text: formatDate(a.expected.lowest.date, dateFormat) })])];
      return el("tr", {}, [
        el("th", { scope: "row", "data-label": "Account" }, [nameOf(a), a.itemsShared ? null : el("div", { class: "muted small", text: "Balance only — entries not shared with you" })]),
        el("td", { "data-label": "Today", class: "num" }, [money(a.start, a.currency, prefs)]),
        compare
          ? el("td", { "data-label": "Expected end", class: "num" }, [base ? money(base.expected.end, a.currency, prefs) : "—"])
          : el("td", { "data-label": "Expected end", class: "num" }, [money(a.expected.end, a.currency, prefs)]),
        compare
          ? el("td", { "data-label": "With changes", class: "num" }, [money(a.expected.end, a.currency, prefs)])
          : el("td", { "data-label": "Lowest", class: "num" }, lowest),
        compare
          ? el("td", { "data-label": "Lowest with changes", class: "num" }, lowest)
          : el("td", { "data-label": "Cautious end", class: "num" }, [money(a.conservative.end, a.currency, prefs)]),
        compare ? null : el("td", { "data-label": "Hopeful end", class: "num" }, [money(a.optimistic.end, a.currency, prefs)]),
      ]);
    })),
  ])]);
}

// BT-014-04: permanent deletion, distinct from Archive above (which is recoverable). Nothing else
// references a budget by id, so it is always deleted alone (api/_shared/deletion.js).
function openPermanentDelete(ctx, budget) {
  const wsId = ctx.store.getState().selectedWorkspaceId;
  openDeleteDialog(ctx, {
    title: `Permanently delete budget ${budget.name}?`,
    fetchImpact: async () => (await ctx.api.permanentDeleteImpact("budgets", { workspaceId: wsId }, { budgetId: budget.id })).impact,
    execute: async (impact, typedConfirmation) => {
      const out = await ctx.store.actions.write(
        (ws) => ctx.api.permanentDeleteExecute("budgets", { workspaceId: ws }, { budgetId: budget.id, impactToken: impact.token, typedConfirmation }),
        ["budgets"],
      );
      if (!out.ok) throw out.error;
    },
  });
}

function budgetCard(ctx, b, prefs, fmt, dateFormat, cats = new Map()) {
  const s = b.status;
  if (s.error) return el("section", { class: "card", "aria-label": `Budget ${b.name}` }, [el("h3", { class: "card__title" }, [withIcon(b.icon, b.name)]), el("p", { class: "error-text", text: s.explanation })]);
  const n = (v) => Number(v);
  const lines = s.lines.map((l) => el("tr", {}, [
    el("th", { scope: "row", "data-label": "Category" }, [categoryLabel(l.category, (cats.get(l.categoryId) || {}).shownColor, (cats.get(l.categoryId) || {}).shownIcon), meter(n(l.actual) + n(l.committed), n(l.planned) + n(l.carry)), l.over ? el("div", { class: "error-text small", text: `Over by ${fmt(l.available.replace(/^-/, ""), s.currency)}` }) : null]),
    // Budget figures are magnitudes, not money in or out, so they are not coloured as such.
    el("td", { "data-label": "Planned", class: "num" }, [amountText(l.planned, s.currency, prefs)]),
    el("td", { "data-label": "Carried over", class: "num" }, [l.rollover ? amountText(l.carry, s.currency, prefs) : "—"]),
    el("td", { "data-label": "Spent", class: "num" }, [amountText(l.actual, s.currency, prefs)]),
    el("td", { "data-label": "Still owed", class: "num" }, [amountText(l.committed, s.currency, prefs)]),
    el("td", { "data-label": "Available", class: "num" }, [amountText(l.available, s.currency, prefs, { alert: l.over })]),
  ]));
  return el("section", { class: "card", "aria-label": `Budget ${b.name}` }, [
    el("div", { class: "row" }, [
      el("h3", { class: "card__title" }, [withIcon(b.icon, b.name)]), b.scope === "shared" ? badge("Shared", "shared") : badge("Private", "private"),
      el("span", { class: "muted small", text: `${formatDate(s.period.start, dateFormat)} – ${formatDate(s.period.end, dateFormat)}` }),
      el("span", { class: "app__spacer" }),
      b.canEdit ? button("Edit", () => openBudgetEditor(ctx, b), { small: true, attrs: { "aria-label": `Edit budget ${b.name}` } }) : null,
      b.canEdit ? button("Archive", () => openBudgetLifecycle(ctx, b, true), { small: true, attrs: { "aria-label": `Archive budget ${b.name}` } }) : null,
      b.canEdit ? button("Delete permanently", () => openPermanentDelete(ctx, b), { small: true, variant: "danger", attrs: { "aria-label": `Permanently delete budget ${b.name}` } }) : null,
    ]),
    el("p", { class: "muted small", text: `${s.explanation} ${s.scopeNote}` }),
    el("div", { class: "table-wrap" }, [el("table", { class: "table table--cards", "aria-label": `${b.name} by category` }, [
      el("thead", {}, [el("tr", {}, ["Category", "Planned", "Carried over", "Spent", "Still owed", "Available"].map((h) => el("th", { scope: "col", class: h === "Category" ? "" : "num", text: h })))]),
      el("tbody", {}, lines),
    ])]),
    el("p", { class: "card__meta", text: `Total available ${fmt(s.totals.available, s.currency)} of ${fmt(s.totals.planned, s.currency)} planned.` }),
  ]);
}

// Archiving takes a budget out of the list and keeps its plan, versions and history; restoring
// brings it back. The reason is optional and kept in the budget's history.
function openBudgetLifecycle(ctx, budget, archive, after = null) {
  const reason = input({ maxlength: "200", placeholder: "Optional", autocomplete: "off" });
  const confirm = el("button", { type: "button", class: "btn btn--primary", text: archive ? "Archive budget" : "Restore budget" });
  const modal = openModal({
    title: archive ? `Archive ${budget.name}?` : `Restore ${budget.name}?`,
    body: [
      el("p", { text: archive
        ? "It leaves the Budgets list. Its plan, earlier versions and history are kept, and you can restore it from Archived budgets."
        : "It returns to the Budgets list with its plan and history." }),
      el("div", { class: "form-grid" }, [field("Reason", reason)]),
    ],
    actions: [button("Cancel", () => modal.close()), confirm],
  });
  confirm.addEventListener("click", async () => {
    modal.setError("");
    modal.setBusy(true);
    const body = { budgetId: budget.id, revision: budget.revision, ...(reason.value.trim() ? { reason: reason.value.trim() } : {}) };
    const out = await ctx.store.actions.write((ws) => (archive ? ctx.api.archiveBudget(ws, body) : ctx.api.restoreBudget(ws, body)), ["budgets"]);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
    announce(archive ? `${budget.name} archived. Its history is kept.` : `${budget.name} restored.`);
    modal.close();
    if (after) void after();
  });
}

function openBudgetEditor(ctx, budget = null) {
  const state = ctx.store.getState();
  const editing = !!budget;
  const categories = ((sliceFor(state, "categories").data || {}).categories || []).filter((c) => !c.archived && c.type !== "income");
  const currencies = [...new Set(((sliceFor(state, "accounts").data || {}).accounts || []).map((a) => a.currency))];
  const name = input({ maxlength: "80", autocomplete: "off" });
  name.value = editing ? budget.name : "";
  // Shared budgets belong to whoever manages shared lists (workspace setting; owners and managers by default).
  const canShare = managesSharedLists(state);
  const scope = pickerSelect([{ value: "private", label: "Private to me" }].concat(canShare ? [{ value: "shared", label: "Shared (shared accounts only)" }] : []), editing ? budget.scope : (canShare ? "shared" : "private"), { disabled: editing }, { search: false });
  const currency = pickerSelect((currencies.length ? currencies : ["EUR"]).map((c) => ({ value: c, label: c })), editing ? budget.currency : currencies[0] || "EUR", { disabled: editing });
  // The workspace's settings give a new budget its period and start (Terry, 2026-09-14).
  const wsValues = ((state.workspaces || []).find((w) => w.id === state.selectedWorkspaceId) || {}).settingValues || {};
  const weekStart = [0, 1, 6].includes(wsValues.weekStart) ? wsValues.weekStart : 1;
  const neverBackdate = wsValues.budgetBackdating === "never";
  const period = pickerSelect(PERIODS, editing ? budget.period : (PERIODS.some((p) => p.value === wsValues.budgetPeriod) ? wsValues.budgetPeriod : "monthly"), {}, { search: false });
  const categoryMarks = categoryBadges(state);
  const start = input({ type: "date" });
  start.value = editing ? budget.startDate : defaultBudgetStart(period.value, weekStart, todayIso());
  // A new budget's start follows its period until someone types a start of their own.
  if (!editing) {
    let offered = start.value;
    period.addEventListener("change", () => { if (start.value === offered) { offered = defaultBudgetStart(period.value, weekStart, todayIso()); start.value = offered; } });
  }
  // Plan changes apply from a date; earlier periods keep the plan they had (BT-001-05).
  const effectiveFrom = input({ type: "date" });
  effectiveFrom.value = editing ? budget.status.period.start : "";
  const confirmBackdate = el("input", { type: "checkbox" });
  // A NEW budget that starts before its current period needs the same confirmation (FIN-1); the box
  // appears once the server says so. Under "Not allowed" it never does: the server's reason is shown.
  const createConfirm = el("input", { type: "checkbox" });
  const createConfirmRow = el("label", { class: "field--inline field__label" }, [createConfirm, "Also count the periods that have finished"]);
  createConfirmRow.hidden = true;
  const reason = input({ maxlength: "200", placeholder: "Optional" });
  const chosenIcon = editing && budget.iconSource === "record" ? budget.icon : null;
  const iconPick = createIconPicker({ value: chosenIcon, inherited: "target", name: editing ? budget.name : "New budget" });
  const linesBox = el("div", { class: "stack" });
  const rows = [];
  // Each line is a numbered group ("Line 2") so its controls are distinguishable; focus moves to a
  // new line on add and to a neighbour on remove (A11Y2-003, A11Y2-010).
  function renumber() {
    rows.forEach((r, i) => { r.legend.textContent = `Line ${i + 1}`; r.remove.setAttribute("aria-label", `Remove line ${i + 1}`); });
  }
  function addRow(line = {}, { focus = false } = {}) {
    // `cat.focus()` below lands on the picker's trigger.
    const cat = pickerSelect(categories.map((c) => ({ value: c.id, label: c.name })), line.categoryId || (categories[0] || {}).id, {}, { badgeOf: categoryMarks, placeholder: "Choose a category…" });
    const amount = input({ inputmode: "decimal", placeholder: "0.00" });
    amount.value = line.amount || "";
    const rollover = el("input", { type: "checkbox" });
    rollover.checked = !!line.rollover;
    const row = { cat, amount, rollover, legend: el("legend", { class: "field__label" }) };
    row.remove = button("Remove", () => {
      const at = rows.indexOf(row);
      rows.splice(at, 1);
      if (row.node.remove) row.node.remove(); else linesBox.removeChild(row.node);
      renumber();
      const next = rows[at] || rows[at - 1];
      (next ? next.remove : addLine).focus();
    }, { small: true });
    row.node = el("fieldset", { class: "form-grid budget-line" }, [row.legend, field("Category", cat), field("Planned amount", amount), el("label", { class: "field--inline field__label" }, [rollover, "Carry unspent over one period"]), el("div", { class: "field" }, [row.remove])]);
    rows.push(row);
    linesBox.appendChild(row.node);
    renumber();
    if (focus) cat.focus();
  }
  (editing ? budget.lines : [{}]).forEach((l) => addRow(l));
  const addLine = button("Add a category", () => addRow({}, { focus: true }), { small: true });
  const save = el("button", { type: "button", class: "btn btn--primary", text: editing ? "Save budget" : "Add budget" });
  const cancel = button("Cancel", () => modal.close());
  const modal = openModal({
    title: editing ? `Edit ${budget.name}` : "Add budget",
    body: [
      el("div", { class: "form-grid" }, [field("Name", name), iconPick.element, field("Who it is for", scope, { help: "A shared budget counts shared accounts only, so members' private spending never appears in it." }), field("Currency", currency), field("Period", period, editing ? {} : { help: `${(PERIODS.find((p) => p.value === wsValues.budgetPeriod) || PERIODS.find((p) => p.value === "monthly")).label} is this workspace's usual period (Workspace settings).` }), field("Starts on", start)]),
      el("h3", { text: "Categories" }), linesBox, addLine,
      editing ? el("div", { class: "form-grid" }, [
        field("Plan changes apply from", effectiveFrom, { help: neverBackdate
          ? `Earlier periods keep the plan they had. This workspace does not let changes apply to periods that have finished, so choose ${formatDate(budget.status.period.start)} or later.`
          : `Earlier periods keep the plan they had. A date before ${formatDate(budget.status.period.start)} changes periods that have finished and needs confirming.` }),
        neverBackdate ? null : el("label", { class: "field--inline field__label" }, [confirmBackdate, "Also change finished periods"]),
        field("Reason for the change", reason),
      ]) : el("div", { class: "form-grid" }, [
        el("p", { class: "field__help field--wide", text: neverBackdate
          ? "This workspace does not let a new budget start in a period that has finished."
          : "A start before the current period counts periods that have finished and needs confirming." }),
        createConfirmRow,
      ]),
    ],
    actions: [cancel, save],
  });
  save.addEventListener("click", async () => {
    modal.setError("");
    // The invalid field is marked, linked to the message and focused; lines are named (A11Y2-003).
    for (const c of [name, ...rows.map((r) => r.amount)]) c.removeAttribute("aria-invalid");
    const invalid = (control, message) => { control.setAttribute("aria-invalid", "true"); control.setAttribute("aria-errormessage", modal.errorId); modal.setError(message); control.focus(); };
    if (!name.value.trim()) { invalid(name, "Give the budget a name."); return; }
    if (!rows.length) { modal.setError("Add at least one category."); addLine.focus(); return; }
    const missing = rows.findIndex((r) => !r.amount.value.trim());
    if (missing >= 0) {
      const r = rows[missing];
      const catName = r.cat.options && r.cat.selectedIndex >= 0 ? r.cat.options[r.cat.selectedIndex].text : "this category";
      invalid(r.amount, `Line ${missing + 1} (${catName}) needs a planned amount.`);
      return;
    }
    const lines = rows.map((r) => ({ categoryId: r.cat.value, amount: r.amount.value.trim(), rollover: r.rollover.checked }));
    let body;
    if (editing) {
      // Only what changed is sent, so an unchanged plan never gains a new version.
      body = { budgetId: budget.id, revision: budget.revision };
      if (name.value.trim() !== budget.name) body.name = name.value.trim();
      const icon = iconChange(chosenIcon, iconPick.getValue());
      if (icon !== undefined) body.icon = icon;
      const planChanged = JSON.stringify(lines) !== JSON.stringify(budget.lines.map((l) => ({ categoryId: l.categoryId, amount: l.amount, rollover: !!l.rollover })))
        || period.value !== budget.period || start.value !== budget.startDate;
      if (planChanged) {
        effectiveFrom.removeAttribute("aria-invalid");
        const problem = backdateProblem(effectiveFrom.value, budget.status.period.start, confirmBackdate.checked, { never: neverBackdate });
        if (problem) { invalid(effectiveFrom, problem); return; }
        const backdated = !!effectiveFrom.value && effectiveFrom.value < budget.status.period.start;
        Object.assign(body, { lines, period: period.value, startDate: start.value, ...(effectiveFrom.value ? { effectiveFrom: effectiveFrom.value } : {}), ...(backdated || confirmBackdate.checked ? { confirmBackdate: true } : {}), ...(reason.value.trim() ? { reason: reason.value.trim() } : {}) });
      }
      if (Object.keys(body).length === 2) { announce("Nothing changed."); modal.close(); return; }
    } else {
      body = { name: name.value.trim(), scope: scope.value, currency: currency.value, period: period.value, startDate: start.value, lines, ...(iconPick.getValue() ? { icon: iconPick.getValue() } : {}), ...(createConfirm.checked ? { confirmBackdate: true } : {}) };
    }
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => (editing ? ctx.api.updateBudget(ws, body) : ctx.api.createBudget(ws, body)), ["budgets"]);
    modal.setBusy(false);
    if (!out.ok) {
      // The server asks for the confirmation: offer it beside the message.
      if (!editing && out.error && out.error.code === "backdate_unconfirmed") createConfirmRow.hidden = false;
      modal.setError(out.error);
      return;
    }
    announce(editing ? "Budget saved." : "Budget added.");
    modal.close();
  });
}

// What-if: changes are collected here and sent to the server, which projects them on a copy in
// memory. Nothing is saved; the result is shown beside the current forecast.
function createWhatIf(ctx, params) {
  let accounts = [];
  let bills = [];
  let baseline = null;
  const changes = [];
  const list = el("ul", { class: "stack" });
  const result = el("div");
  const kind = pickerSelect([
    { value: "one-off", label: "Add a one-off amount" },
    { value: "change-recurring", label: "Change a bill's amount" },
    { value: "exclude-recurring", label: "Leave out a bill" },
  ], "one-off", {}, { search: false });
  // Filled by setChoices() below; the pickers follow the new options. The account's icon is read from
  // the current list, which setChoices replaces.
  // Natural empty-field text while the choices load or when there are none (UX review U6).
  const account = pickerSelect([], "", {}, { badgeOf: (id) => { const a = accounts.find((x) => x.id === id); return a && a.icon ? icon(a.icon) : null; }, placeholder: "Choose an account…" });
  const bill = pickerSelect([], "", {}, { placeholder: "Choose a bill…" });
  const date = input({ type: "date" });
  date.value = todayIso();
  const amount = input({ inputmode: "decimal", placeholder: "-250.00 or 100.00" });
  const accountField = field("Account", account);
  const billField = field("Bill", bill);
  const dateField = field("Date", date);
  const amountField = field("Amount", amount, { help: "Negative for money out, positive for money in." });
  const amountHelp = amountField.querySelector(".field__help");
  const df = () => ((ctx.store.getState().preferences || {}).effective || {}).dateFormat;
  const sync = () => {
    accountField.hidden = kind.value !== "one-off";
    dateField.hidden = kind.value !== "one-off";
    billField.hidden = kind.value === "one-off";
    amountField.hidden = kind.value === "exclude-recurring";
    // A bill's new amount is per payment and has no sign (UX2-002).
    if (amountHelp) amountHelp.textContent = kind.value === "change-recurring" ? "The new amount of each payment, without a sign." : "Negative for money out, positive for money in.";
  };
  kind.addEventListener("change", sync);
  sync();
  const error = el("p", { class: "error-text", role: "alert", hidden: true, id: "whatif-error" });
  const addBtn = button("Add change", () => {
    error.hidden = true;
    amount.removeAttribute("aria-invalid");
    if (kind.value !== "exclude-recurring" && !amount.value.trim()) {
      // The amount field is marked, linked to the message and focused (A11Y2-004).
      error.textContent = "Enter an amount.";
      error.hidden = false;
      amount.setAttribute("aria-invalid", "true");
      amount.setAttribute("aria-errormessage", error.id);
      amount.focus();
      return;
    }
    if (kind.value === "one-off") {
      const a = accounts.find((x) => x.id === account.value);
      changes.push({ body: { type: "one-off", accountId: account.value, date: date.value, amount: amount.value.trim() }, label: `${amount.value.trim()} ${a ? a.currency : ""} on ${formatDate(date.value, df())} in ${a ? a.name : "an account"}` });
    } else {
      const b = bills.find((x) => x.id === bill.value);
      if (!b) { error.textContent = "Choose a bill."; error.hidden = false; return; }
      const perPayment = amount.value.trim().replace(/^[-+]/, "");
      changes.push(kind.value === "change-recurring"
        ? { body: { type: "change-recurring", recurringId: b.id, amount: perPayment }, label: `${b.name}: ${perPayment} ${b.currency} per payment` }
        : { body: { type: "exclude-recurring", recurringId: b.id }, label: `Leave out ${b.name}` });
    }
    amount.value = "";
    renderList();
  }, { small: true });
  const runBtn = button("Run what-if", () => void runScenario(), { variant: "primary" });
  // Says why the button is unavailable (UX2-017).
  const runHelp = el("p", { class: "field__help", id: "whatif-run-help", text: "Add at least one change first." });
  runBtn.setAttribute("aria-describedby", runHelp.id);
  function renderList() {
    mount(list, ...changes.map((c, i) => el("li", { class: "row" }, [el("span", { text: c.label }), button("Remove", () => { changes.splice(i, 1); renderList(); }, { small: true, attrs: { "aria-label": `Remove change: ${c.label}` } })])));
    runBtn.disabled = !changes.length;
    runHelp.hidden = !!changes.length;
  }
  renderList();
  async function runScenario() {
    error.hidden = true;
    try {
      const state = ctx.store.getState();
      const res = await ctx.api.scenario(state.selectedWorkspaceId, { ...params(), horizon: Number(params().horizon), changes: changes.map((c) => c.body) });
      const eff = (state.preferences && state.preferences.effective) || {};
      const plain = { effective: { ...eff, balanceMasking: false } };
      const fmt = (v, c) => formatAmount(v, c, { numberFormat: eff.numberFormat });
      mount(result,
        el("p", { class: "muted small", text: "Nothing was saved. These results use your changes on a copy of today's forecast." }),
        res.forecast.warnings.length ? el("div", { class: "notice notice--warning" }, [el("ul", { class: "stack" }, res.forecast.warnings.map((w) => el("li", { text: warningText(w, fmt, eff.dateFormat) })))]) : null,
        forecastTable(res.forecast, plain, eff.dateFormat, "What-if result", baseline, accountIcons(state)),
      );
      announce("What-if calculated. Nothing was saved.");
    } catch (err) {
      error.textContent = messageFor(err) || "The what-if could not be calculated.";
      error.hidden = false;
    }
  }
  const element = el("div", { class: "card" }, [
    el("p", { class: "muted small", text: "Try changes without saving them: a one-off expense or income, a different bill amount, or leaving a bill out." }),
    el("div", { class: "form-grid" }, [field("Change", kind), accountField, billField, dateField, amountField, el("div", { class: "field" }, [addBtn])]),
    error, list, el("div", { class: "row" }, [runBtn, runHelp]), result,
  ]);
  return {
    element,
    setBaseline(f) { baseline = f; },
    setChoices(nextAccounts, nextBills) {
      accounts = nextAccounts;
      bills = nextBills.filter((b) => !b.ended);
      const keepA = account.value;
      account.replaceChildren(...accounts.map((a) => el("option", { value: a.id, text: `${a.name} (${a.currency})` })));
      if (accounts.some((a) => a.id === keepA)) account.value = keepA;
      const keepB = bill.value;
      bill.replaceChildren(...bills.map((b) => el("option", { value: b.id, text: `${b.name} (${b.amount} ${b.currency})` })));
      if (bills.some((b) => b.id === keepB)) bill.value = keepB;
    },
  };
}
