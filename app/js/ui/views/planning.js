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
import { stateView, money, amountText, button, field, input, select, badge } from "../components.js";
import { openModal } from "../modal.js";
import { sliceFor } from "../../core/store.js";
import { formatDate, formatAmount, todayIso } from "../../core/format.js";
import { messageFor } from "../../core/errors.js";

const HORIZONS = [{ value: "30", label: "30 days" }, { value: "60", label: "60 days" }, { value: "90", label: "90 days" }, { value: "365", label: "12 months" }];
const PERIODS = [{ value: "monthly", label: "Monthly" }, { value: "biweekly", label: "Every 2 weeks" }, { value: "weekly", label: "Weekly" }];

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
  const warningsBox = el("div");
  const forecastBox = el("div");
  const whatIfBox = el("div");
  const budgetActions = el("div", { class: "page-head__actions" });
  const horizon = select(HORIZONS, "90");
  const buffer = input({ inputmode: "decimal", placeholder: "Optional, e.g. 500.00" });
  const run = button("Update forecast", () => refresh());
  const element = el("section", {}, [
    el("div", { class: "page-head" }, [el("h1", { text: "Planning" })]),
    el("div", { class: "page-head" }, [el("h2", { class: "section-title", text: "Budgets" }), budgetActions]),
    budgetsBox,
    el("h2", { class: "section-title", text: "Cash flow" }),
    el("p", { class: "muted", text: "Projected balances from today, including bills that are due and not yet recorded, skipped or paused. Only accounts whose balance you can see are included." }),
    el("div", { class: "filters" }, [field("Look ahead", horizon), field("Warn me below", buffer), el("div", { class: "filters__actions" }, [run])]),
    warningsBox, forecastBox,
    el("h2", { class: "section-title", text: "What if…" }),
    whatIfBox,
  ]);
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
    const eff = (state.preferences && state.preferences.effective) || {};
    const plain = { effective: { ...eff, balanceMasking: false } };
    const fmt = (v, c) => formatAmount(v, c, { numberFormat: eff.numberFormat });
    const role = ((state.workspaces || []).find((w) => w.id === state.selectedWorkspaceId) || {}).role;
    mount(budgetActions, role && role !== "viewer" ? button("Add budget", () => openBudgetEditor(ctx), { variant: "primary" }) : null);

    const budgets = sliceFor(state, "budgets");
    const bs = stateView(budgets, { empty: "No budgets yet. Add one to plan spending by category.", isEmpty: (d) => !d.budgets.length });
    if (bs) mount(budgetsBox, bs);
    else mount(budgetsBox, ...budgets.data.budgets.map((b) => budgetCard(ctx, b, plain, fmt, eff.dateFormat)));

    const fc = sliceFor(state, "forecast");
    const fs = stateView(fc, { empty: "No accounts to project.", isEmpty: (d) => !d.forecast.accounts.length });
    if (fs) { mount(warningsBox); mount(forecastBox, fs); } else {
      const f = fc.data.forecast;
      mount(warningsBox, f.warnings.length
        ? el("div", { class: "notice notice--warning", role: "status" }, [el("strong", { text: "Cash-flow warnings" }), el("ul", { class: "stack" }, f.warnings.map((w) => el("li", { text: warningText(w, fmt, eff.dateFormat) })))])
        : el("p", { class: "muted", text: `No balance is projected to fall below zero${buffer.value.trim() ? " or your buffer" : ""} in the next ${horizon.options ? horizon.options[horizon.selectedIndex].text : `${f.horizonDays} days`}.` }));
      mount(forecastBox, forecastTable(f, plain, eff.dateFormat, "Cash-flow forecast"), el("details", { class: "more" }, [el("summary", { text: "How this is worked out" }), el("ul", {}, f.assumptions.map((a) => el("li", { text: a })))]));
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

function forecastTable(f, prefs, dateFormat, label, compare = null) {
  const headers = compare ? ["Account", "Today", "Expected end", "With changes", "Lowest with changes"] : ["Account", "Today", "Expected end", "Lowest", "Cautious end", "Hopeful end"];
  return el("div", { class: "table-wrap" }, [el("table", { class: "table table--cards", "aria-label": label }, [
    el("thead", {}, [el("tr", {}, headers.map((h) => el("th", { scope: "col", class: h === "Account" ? "" : "num", text: h })))]),
    el("tbody", {}, f.accounts.map((a) => {
      const base = compare && compare.accounts.find((x) => x.accountId === a.accountId);
      const lowest = [money(a.expected.lowest.amount, a.currency, prefs), el("div", { class: "muted small", text: formatDate(a.expected.lowest.date, dateFormat) })];
      return el("tr", {}, [
        el("th", { scope: "row", "data-label": "Account" }, [el("span", { text: a.name }), a.itemsShared ? null : el("div", { class: "muted small", text: "Balance only — entries not shared with you" })]),
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

function budgetCard(ctx, b, prefs, fmt, dateFormat) {
  const s = b.status;
  const n = (v) => Number(v);
  const lines = s.lines.map((l) => el("tr", {}, [
    el("th", { scope: "row", "data-label": "Category" }, [el("span", { text: l.category }), meter(n(l.actual) + n(l.committed), n(l.planned) + n(l.carry)), l.over ? el("div", { class: "error-text small", text: `Over by ${fmt(l.available.replace(/^-/, ""), s.currency)}` }) : null]),
    // Budget figures are magnitudes, not money in or out, so they are not coloured as such.
    el("td", { "data-label": "Planned", class: "num" }, [amountText(l.planned, s.currency, prefs)]),
    el("td", { "data-label": "Carried over", class: "num" }, [l.rollover ? amountText(l.carry, s.currency, prefs) : "—"]),
    el("td", { "data-label": "Spent", class: "num" }, [amountText(l.actual, s.currency, prefs)]),
    el("td", { "data-label": "Still owed", class: "num" }, [amountText(l.committed, s.currency, prefs)]),
    el("td", { "data-label": "Available", class: "num" }, [amountText(l.available, s.currency, prefs, { alert: l.over })]),
  ]));
  return el("section", { class: "card", "aria-label": `Budget ${b.name}` }, [
    el("div", { class: "row" }, [
      el("h3", { class: "card__title", text: b.name }), b.scope === "shared" ? badge("Shared", "shared") : badge("Private", "private"),
      el("span", { class: "muted small", text: `${formatDate(s.period.start, dateFormat)} – ${formatDate(s.period.end, dateFormat)}` }),
      el("span", { class: "app__spacer" }),
      b.canEdit ? button("Edit", () => openBudgetEditor(ctx, b), { small: true, attrs: { "aria-label": `Edit budget ${b.name}` } }) : null,
    ]),
    el("p", { class: "muted small", text: `${s.explanation} ${s.scopeNote}` }),
    el("div", { class: "table-wrap" }, [el("table", { class: "table table--cards", "aria-label": `${b.name} by category` }, [
      el("thead", {}, [el("tr", {}, ["Category", "Planned", "Carried over", "Spent", "Still owed", "Available"].map((h) => el("th", { scope: "col", class: h === "Category" ? "" : "num", text: h })))]),
      el("tbody", {}, lines),
    ])]),
    el("p", { class: "card__meta", text: `Total available ${fmt(s.totals.available, s.currency)} of ${fmt(s.totals.planned, s.currency)} planned.` }),
  ]);
}

function openBudgetEditor(ctx, budget = null) {
  const state = ctx.store.getState();
  const editing = !!budget;
  const role = ((state.workspaces || []).find((w) => w.id === state.selectedWorkspaceId) || {}).role;
  const categories = ((sliceFor(state, "categories").data || {}).categories || []).filter((c) => !c.archived && c.type !== "income");
  const currencies = [...new Set(((sliceFor(state, "accounts").data || {}).accounts || []).map((a) => a.currency))];
  const name = input({ maxlength: "80", autocomplete: "off" });
  name.value = editing ? budget.name : "";
  const canShare = role === "owner" || role === "manager";
  const scope = select([{ value: "private", label: "Private to me" }].concat(canShare ? [{ value: "shared", label: "Shared (shared accounts only)" }] : []), editing ? budget.scope : (canShare ? "shared" : "private"), { disabled: editing });
  const currency = select((currencies.length ? currencies : ["EUR"]).map((c) => ({ value: c, label: c })), editing ? budget.currency : currencies[0] || "EUR", { disabled: editing });
  const period = select(PERIODS, editing ? budget.period : "monthly");
  const start = input({ type: "date" });
  start.value = editing ? budget.startDate : `${todayIso().slice(0, 8)}01`;
  const linesBox = el("div", { class: "stack" });
  const rows = [];
  function addRow(line = {}) {
    const cat = select(categories.map((c) => ({ value: c.id, label: c.name })), line.categoryId || (categories[0] || {}).id);
    const amount = input({ inputmode: "decimal", placeholder: "0.00" });
    amount.value = line.amount || "";
    const rollover = el("input", { type: "checkbox" });
    rollover.checked = !!line.rollover;
    const row = { cat, amount, rollover };
    const remove = button("Remove", () => { rows.splice(rows.indexOf(row), 1); node.remove ? node.remove() : linesBox.removeChild(node); }, { small: true, attrs: { "aria-label": "Remove this category line" } });
    const node = el("div", { class: "form-grid" }, [field("Category", cat), field("Planned amount", amount), el("label", { class: "field--inline field__label" }, [rollover, "Carry unspent over one period"]), el("div", { class: "field" }, [remove])]);
    rows.push(row);
    linesBox.appendChild(node);
  }
  (editing ? budget.lines : [{}]).forEach(addRow);
  const save = el("button", { type: "button", class: "btn btn--primary", text: editing ? "Save budget" : "Add budget" });
  const cancel = button("Cancel", () => modal.close());
  const modal = openModal({
    title: editing ? `Edit ${budget.name}` : "Add budget",
    body: [
      el("div", { class: "form-grid" }, [field("Name", name), field("Who it is for", scope, { help: "A shared budget counts shared accounts only, so members' private spending never appears in it." }), field("Currency", currency), field("Period", period), field("Starts on", start)]),
      el("h3", { text: "Categories" }), linesBox,
      button("Add a category", () => addRow(), { small: true }),
    ],
    actions: [cancel, save],
  });
  save.addEventListener("click", async () => {
    modal.setError("");
    if (!name.value.trim()) { modal.setError("Give the budget a name."); name.focus(); return; }
    if (!rows.length || rows.some((r) => !r.amount.value.trim())) { modal.setError("Every category line needs a planned amount."); return; }
    const lines = rows.map((r) => ({ categoryId: r.cat.value, amount: r.amount.value.trim(), rollover: r.rollover.checked }));
    const body = editing
      ? { budgetId: budget.id, revision: budget.revision, name: name.value.trim(), period: period.value, startDate: start.value, lines }
      : { name: name.value.trim(), scope: scope.value, currency: currency.value, period: period.value, startDate: start.value, lines };
    modal.setBusy(true);
    const out = await ctx.store.actions.write((ws) => (editing ? ctx.api.updateBudget(ws, body) : ctx.api.createBudget(ws, body)), ["budgets"]);
    modal.setBusy(false);
    if (!out.ok) { modal.setError(out.error); return; }
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
  const kind = select([
    { value: "one-off", label: "Add a one-off amount" },
    { value: "change-recurring", label: "Change a bill's amount" },
    { value: "exclude-recurring", label: "Leave out a bill" },
  ], "one-off");
  const account = select([], "");
  const bill = select([], "");
  const date = input({ type: "date" });
  date.value = todayIso();
  const amount = input({ inputmode: "decimal", placeholder: "-250.00 or 100.00" });
  const accountField = field("Account", account);
  const billField = field("Bill", bill);
  const dateField = field("Date", date);
  const amountField = field("Amount", amount, { help: "Negative for money out, positive for money in." });
  const sync = () => {
    accountField.hidden = kind.value !== "one-off";
    dateField.hidden = kind.value !== "one-off";
    billField.hidden = kind.value === "one-off";
    amountField.hidden = kind.value === "exclude-recurring";
  };
  kind.addEventListener("change", sync);
  sync();
  const error = el("p", { class: "error-text", role: "alert", hidden: true });
  const addBtn = button("Add change", () => {
    error.hidden = true;
    if (kind.value !== "exclude-recurring" && !amount.value.trim()) { error.textContent = "Enter an amount."; error.hidden = false; return; }
    if (kind.value === "one-off") {
      const a = accounts.find((x) => x.id === account.value);
      changes.push({ body: { type: "one-off", accountId: account.value, date: date.value, amount: amount.value.trim() }, label: `${amount.value.trim()} ${a ? a.currency : ""} on ${date.value} in ${a ? a.name : "an account"}` });
    } else {
      const b = bills.find((x) => x.id === bill.value);
      if (!b) { error.textContent = "Choose a bill."; error.hidden = false; return; }
      changes.push(kind.value === "change-recurring"
        ? { body: { type: "change-recurring", recurringId: b.id, amount: amount.value.trim() }, label: `${b.name} becomes ${amount.value.trim()} ${b.currency}` }
        : { body: { type: "exclude-recurring", recurringId: b.id }, label: `Leave out ${b.name}` });
    }
    amount.value = "";
    renderList();
  }, { small: true });
  const runBtn = button("Run what-if", () => void runScenario(), { variant: "primary" });
  function renderList() {
    mount(list, ...changes.map((c, i) => el("li", { class: "row" }, [el("span", { text: c.label }), button("Remove", () => { changes.splice(i, 1); renderList(); }, { small: true, attrs: { "aria-label": `Remove change: ${c.label}` } })])));
    runBtn.disabled = !changes.length;
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
        forecastTable(res.forecast, plain, eff.dateFormat, "What-if result", baseline),
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
    error, list, el("div", { class: "row" }, [runBtn]), result,
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
