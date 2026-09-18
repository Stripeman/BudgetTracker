// BT-013 Design Gallery — THE SHARED COMPOSITION ENGINE. Every one of the 20 layout concepts is
// rendered by this ONE module: a concept manifest (api/_shared/layouts.js, served by
// /api/design-gallery) selects a nav style, a density, a card style and — for the Dashboard only —
// one of twelve distinct hero compositions; everything below reuses the REAL shared components
// (money, categoryLabel, icon/withIcon, badge, button from app/js/ui/components.js and icons.js)
// against the ONE canonical fictional fixture set (./fixtures.js). Layout selection is presentation
// only: nothing here computes a balance, checks a permission or calls an API — it renders numbers
// that are already given.
//
// Fully realized here: the Dashboard (one of twelve real composition functions, never a recoloured
// copy) for all 20 concepts. The other six required pages (Transactions, Bills, Budget, Shared
// expenses, Trips, Settings) share ONE responsive template per page type, driven by the concept's
// own navStyle/density/cardStyle — real structural differences (nav position, spacing, card
// treatment), not hand-tuned per concept. See docs/REQUIREMENTS.md BT-013 for exactly which
// concepts also received deeper, hand-tuned treatment beyond this shared template ("flagship").
import { el, svgEl } from "../dom.js";
import { money, categoryLabel, badge, button, amountText } from "../components.js";
import { icon, withIcon } from "../icons.js";
import { formatAmount } from "../../core/format.js";
import * as fx from "./fixtures.js";

const PAGE_LABEL = { dashboard: "Dashboard", transactions: "Transactions", bills: "Bills", budget: "Budget", accounts: "Accounts / Merchants", shared: "Shared expenses", trips: "Trips", settings: "Settings" };
const PAGE_ICON = { dashboard: "chart-pie", transactions: "receipt", bills: "calendar", budget: "target", accounts: "bank", shared: "users", trips: "suitcase", settings: "user" };
const BILL_STATUS_LABEL = { overdue: "Overdue", "due-soon": "Due soon", upcoming: "Upcoming" };

const cat = (id) => fx.categoryById.get(id);
const merchant = (id) => fx.merchantById.get(id);
const account = (id) => fx.accountById.get(id);

// ---- small chart primitives (the same "decorative SVG + a real sr-only figure table" rule as the
// existing Usage page, app/js/ui/views/analytics.js barChart/lineChart) ---------------------------
function figureTable(rows, caption, columns) {
  return el("table", { class: "sr-only" }, [
    el("caption", { text: caption }),
    el("thead", {}, [el("tr", {}, columns.map((c) => el("th", { scope: "col", text: c })))]),
    el("tbody", {}, rows.map((r) => el("tr", {}, r.map((v, i) => (i === 0 ? el("th", { scope: "row", text: String(v) }) : el("td", { text: String(v) })))))),
  ]);
}

function barChart(points, { width = 420, height = 120 } = {}) {
  const max = Math.max(1, ...points.map((p) => Math.abs(Number(p.value))));
  const n = Math.max(1, points.length);
  const barWidth = width / n;
  const svg = svgEl("svg", { class: "chart chart--bars", viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true", focusable: "false" });
  points.forEach((p, i) => {
    const h = Math.round((Math.abs(Number(p.value)) / max) * (height - 4));
    svg.appendChild(svgEl("rect", { class: "chart__bar", x: i * barWidth + 1, y: height - h, width: Math.max(1, barWidth - 2), height: Math.max(0, h) }));
  });
  return svg;
}

// A three-series line chart (expected/cautious/hopeful), distinguished by dash pattern AND a text
// legend, never colour alone (accessibility notes on Wealth Overview and Cash-Flow Studio).
function multiLineChart(points, series, { width = 420, height = 120 } = {}) {
  const all = points.flatMap((p) => series.map((s) => Number(p[s.key])));
  const max = Math.max(1, ...all);
  const min = Math.min(0, ...all);
  const range = Math.max(1, max - min);
  const stepX = points.length > 1 ? width / (points.length - 1) : width;
  const svg = svgEl("svg", { class: "chart chart--line", viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true", focusable: "false" });
  for (const s of series) {
    const coords = points.map((p, i) => [Math.round(i * stepX), Math.round(height - ((Number(p[s.key]) - min) / range) * (height - 4) - 2)]);
    svg.appendChild(svgEl("polyline", { class: `chart__line chart__line--${s.dash}`, points: coords.map(([x, y]) => `${x},${y}`).join(" ") }));
  }
  return svg;
}

// ---- shared small building blocks -----------------------------------------------------------------
// A module-level counter (like themepicker.js's) guarantees unique heading ids even when two
// concepts are rendered side by side in "Compare" and happen to share a card title (e.g. both
// concepts have a "Balances" card) — aria-labelledby must never resolve to the wrong frame's node.
let gcardCounter = 0;
function gcard(title, iconId, body, { id, full = false } = {}) {
  const headingId = id || `gcard-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${++gcardCounter}`;
  return el("section", { class: ["gcard", full ? "gcard--full" : ""], "aria-labelledby": headingId }, [
    el("h3", { class: "gcard__title", id: headingId }, [withIcon(iconId, title)]),
    ...(Array.isArray(body) ? body : [body]),
  ]);
}

function metric(label, valueNode, meta) {
  return el("div", { class: "gmetric" }, [
    el("p", { class: "gmetric__label", text: label }),
    el("div", { class: "gmetric__value" }, [valueNode]),
    meta ? el("p", { class: "gmetric__meta", text: meta }) : null,
  ]);
}

function txRow(t) {
  const m = t.payee ? merchant(t.payee) : null;
  const c = t.category ? cat(t.category) : null;
  return el("li", { class: "grow" }, [
    el("span", { class: "grow__date muted small", text: t.date }),
    m ? withIcon(m.icon, m.name) : el("span", { text: t.label || "Transfer" }),
    c ? categoryLabel(c.name, c.color, c.icon) : el("span", { class: "muted small", text: "—" }),
    el("span", { class: "app__spacer" }),
    money(t.amount, "EUR", fx.prefs),
  ]);
}

function billRow(b) {
  return el("li", { class: "grow" }, [
    withIcon(b.icon, b.name),
    badge(BILL_STATUS_LABEL[b.status], b.status === "overdue" ? "danger" : b.status === "due-soon" ? "warning" : ""),
    el("span", { class: "muted small", text: b.dueDate }),
    el("span", { class: "app__spacer" }),
    amountText(b.kind === "income" ? b.amount : `-${b.amount}`, b.currency, fx.prefs),
  ]);
}

// ---- the twelve Dashboard hero compositions --------------------------------------------------------
function heroMetricGrid() {
  return [gcard("Key figures", "scale", el("div", { class: "ggrid ggrid--metrics" }, [
    metric("Net position", money(fx.netPosition.amount, fx.netPosition.currency, fx.prefs), "Across every account you can see"),
    metric("Budget this month", amountText("-758.69", "EUR", fx.prefs), "of 890.00 planned"),
    metric("Bills due soon", "2", "1 overdue, 1 due in 3 days"),
    metric("Shared balance", amountText(fx.shared.balances[0].net, fx.shared.currency, fx.prefs), "You are owed, in Fictional Dinner Club"),
  ]))];
}

function heroChartFirst(concept) {
  const series = [{ key: "expected", dash: "solid" }, { key: "cautious", dash: "dashed" }, { key: "hopeful", dash: "dotted" }];
  const trendLabel = concept.id === "wealth-overview" ? "Net worth trend, last 4 weeks" : "Cash-flow forecast, next 30 days";
  const chart = multiLineChart(fx.forecast.points, series);
  const rows = fx.forecast.points.map((p) => [p.date, p.expected, p.cautious, p.hopeful]);
  const blocks = [
    gcard(trendLabel, "chart-line", [
      chart, figureTable(rows, trendLabel, ["Date", "Expected", "Cautious", "Hopeful"]),
      el("p", { class: "gchart__legend" }, [
        el("span", { class: "gchart__key gchart__key--solid" }), "Expected  ",
        el("span", { class: "gchart__key gchart__key--dashed" }), "Cautious  ",
        el("span", { class: "gchart__key gchart__key--dotted" }), "Hopeful",
      ]),
    ], { full: true }),
  ];
  if (concept.chartEmphasis === "mixed") {
    blocks.push(gcard("Spending by category", "chart-pie", [barChart(fx.budget.lines.map((l) => ({ value: l.spent }))), figureTable(fx.budget.lines.map((l) => [cat(l.category).name, l.spent]), "Spending by category", ["Category", "Spent"])]));
  }
  return blocks;
}

function heroTableFirst() {
  return [gcard("Recent entries", "receipt", el("ul", { class: "stack" }, fx.transactions.slice(0, 6).map(txRow)), { full: true })];
}

function heroTimeline() {
  const events = [
    ...fx.transactions.slice(0, 4).map((t) => ({ date: t.date, node: txRow(t), when: "past" })),
    ...fx.bills.map((b) => ({ date: b.dueDate, node: billRow(b), when: "future" })),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
  return [gcard("Timeline", "clock", el("ol", { class: "gtimeline" }, events.map((e) => el("li", { class: ["gtimeline__item", `gtimeline__item--${e.when}`] }, [el("span", { class: "gtimeline__date muted small", text: e.date }), e.node]))), { full: true })];
}

function heroCardStack(concept) {
  const isHousehold = concept.id === "household-hub";
  if (isHousehold) {
    return [
      gcard("Shared bills due", "calendar", el("ul", { class: "stack" }, fx.bills.filter((b) => b.status !== "upcoming").map(billRow))),
      gcard("Shared balance", "users", fx.shared.balances.map((b) => el("div", { class: "row" }, [el("span", { text: b.name }), el("span", { class: "app__spacer" }), amountText(b.net, fx.shared.currency, fx.prefs)]))),
      gcard("Members", "user", el("ul", { class: "stack" }, ["Alice · Owner", "Bob · Member", "Carol · Viewer"].map((n) => el("li", { text: n })))),
    ];
  }
  return fx.accounts.map((a) => gcard(a.name, a.icon, [
    el("div", { class: "gcard__value" }, [money(a.balance, a.currency, fx.prefs)]),
    el("p", { class: "muted small", text: a.access === "shared" ? "Shared with workspace" : "Private · yours" }),
    el("ul", { class: "stack" }, fx.transactions.filter((t) => t.account === a.id).slice(0, 2).map(txRow)),
  ]));
}

function heroGoalProgress() {
  const loan = account("acc-loan");
  const savings = account("acc-savings");
  const pct = (paid, total) => Math.round((paid / total) * 100);
  const loanPct = pct(3520, 15000);
  const savingsPct = pct(8420, 12000);
  const meter = (p) => el("div", { class: "gmeter", role: "img", "aria-label": `${p}% of the way there` }, [el("div", { class: "gmeter__fill", vars: { "--pct": `${p}%` } })]);
  return [
    gcard("Car loan payoff", "loan", [meter(loanPct), el("p", { text: `${loanPct}% paid — ${formatAmount("3520.00", "EUR")} of ${formatAmount("15000.00", "EUR")}` }), el("p", { class: "muted small", text: `Balance remaining: ${loan.balance} EUR` })]),
    gcard("Savings goal: Emergency fund", "target", [meter(savingsPct), el("p", { text: `${savingsPct}% of the way to 12,000.00 EUR` }), el("p", { class: "muted small", text: `Current: ${savings.balance} EUR` })]),
  ];
}

function heroMerchantFeed() {
  return [gcard("Merchant activity", "store", el("ul", { class: "stack" }, fx.merchants.map((m) => {
    const spend = fx.transactions.filter((t) => t.payee === m.id).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    return el("li", { class: "grow" }, [withIcon(m.icon, m.name), el("span", { class: "app__spacer" }), amountText(String(-spend.toFixed(2)), "EUR", fx.prefs), el("span", { class: "muted small", text: "this month" })]);
  })), { full: true })];
}

function heroEnvelopeGrid() {
  return [gcard("Budget envelopes", "target", el("div", { class: "ggrid ggrid--envelopes" }, fx.budget.lines.map((l) => {
    const c = cat(l.category);
    const over = Number(l.available) < 0;
    const pct = Math.min(100, Math.round((Number(l.spent) / Number(l.planned)) * 100));
    return el("div", { class: ["genvelope", over ? "genvelope--over" : ""] }, [
      categoryLabel(c.name, c.color, c.icon),
      el("div", { class: "gmeter" }, [el("div", { class: "gmeter__fill", vars: { "--pct": `${pct}%` } })]),
      el("p", { class: "small", text: `${l.spent} of ${l.planned} · ${over ? "over by" : "available"} ${over ? String(Math.abs(l.available)) : l.available}` }),
    ]);
  })), { full: true })];
}

function heroCommandConsole() {
  return [
    gcard("Needs attention", "bell", el("ul", { class: "stack" }, fx.alerts.map((a) => el("li", { class: "iconlabel" }, [icon(a.icon), el("span", { text: a.text })])))),
    gcard("Forecast", "chart-line", [barChart(fx.forecast.points.map((p) => ({ value: p.expected })))]),
    gcard("Bills due", "calendar", el("ul", { class: "stack" }, fx.bills.slice(0, 3).map(billRow))),
    gcard("Balances", "bank", fx.accounts.map((a) => el("div", { class: "row" }, [withIcon(a.icon, a.name), el("span", { class: "app__spacer" }), money(a.balance, a.currency, fx.prefs)]))),
  ];
}

function heroSplitFocus(concept) {
  const left = gcard("Balances", "bank", fx.accounts.map((a) => el("div", { class: "row" }, [withIcon(a.icon, a.name), el("span", { class: "app__spacer" }), money(a.balance, a.currency, fx.prefs)])));
  const right = concept.id === "analyst-workspace"
    ? gcard("Filters", "filter", el("ul", { class: "stack" }, ["Account: All", "Category: All", "Period: This month"].map((f) => el("li", { text: f }))))
    : gcard("Active trip", "suitcase", tripCard(fx.trips[0]));
  return [el("div", { class: "gsplit" }, [left, right])];
}

function heroStoryFlow() {
  return [
    el("div", { class: "gstory" }, [
      el("p", { class: "gstory__lede", text: "Good news: you're on track this week." }),
      el("p", {}, ["You've spent ", amountText("192.35", "EUR", fx.prefs), " so far today across Groceries and Dining."]),
      el("p", {}, ["Coming up: Electricity (", amountText("-95.00", "EUR", fx.prefs), ") is due in 2 days."]),
      el("p", {}, ["Your net position is ", money(fx.netPosition.amount, fx.netPosition.currency, fx.prefs), "."]),
      button("Add expense", () => {}, { variant: "primary" }),
    ]),
  ];
}

function heroAdaptive(concept, { financialState = "urgent" } = {}) {
  const alertsCard = gcard("Needs attention", "bell", el("ul", { class: "stack" }, fx.alerts.map((a) => el("li", { class: "iconlabel" }, [icon(a.icon), el("span", { text: a.text })]))));
  const balancesCard = gcard("Balances", "bank", fx.accounts.map((a) => el("div", { class: "row" }, [withIcon(a.icon, a.name), el("span", { class: "app__spacer" }), money(a.balance, a.currency, fx.prefs)])));
  // The ONLY dashboard whose section order is conditional on the data itself, proving the composition
  // system supports real reordering (never only CSS order — see accessibilityNotes in layouts.js).
  return financialState === "urgent" ? [alertsCard, balancesCard] : [balancesCard, alertsCard];
}

const DASHBOARD_RENDERERS = {
  "metric-grid": heroMetricGrid,
  "chart-first": heroChartFirst,
  "table-first": heroTableFirst,
  timeline: heroTimeline,
  "card-stack": heroCardStack,
  "goal-progress": heroGoalProgress,
  "merchant-feed": heroMerchantFeed,
  "envelope-grid": heroEnvelopeGrid,
  "command-console": heroCommandConsole,
  "split-focus": heroSplitFocus,
  "story-flow": heroStoryFlow,
  adaptive: heroAdaptive,
};

function renderDashboard(concept) {
  const fn = DASHBOARD_RENDERERS[concept.dashboardPattern] || heroMetricGrid;
  return el("div", { class: "gpage gpage--dashboard" }, [pageTitle("dashboard"), ...fn(concept)]);
}

// ---- the shared template for the other six required pages (real structural composition driven by
// the concept's own nav/density/card rules, never hand-duplicated per concept) ----------------------
function pageTitle(pageId) {
  return el("div", { class: "gpage__head" }, [el("h2", {}, [withIcon(PAGE_ICON[pageId], PAGE_LABEL[pageId])])]);
}

// ---- Transactions: five genuinely different compositions (review, 2026-09-18) ---------------------
function txnFlatList() {
  return [gcard("All entries", "receipt", el("ul", { class: "stack" }, fx.transactions.map(txRow)), { full: true })];
}
function txnGroupedByDate() {
  const byDate = new Map();
  for (const t of fx.transactions) { if (!byDate.has(t.date)) byDate.set(t.date, []); byDate.get(t.date).push(t); }
  return [...byDate.entries()].map(([date, rows]) => gcard(date, "calendar", el("ul", { class: "stack" }, rows.map(txRow)), { full: true }));
}
function txnDenseTable() {
  const rows = fx.transactions.map((t) => {
    const m = t.payee ? merchant(t.payee) : null;
    const c = t.category ? cat(t.category) : null;
    return el("tr", {}, [
      el("td", { text: t.date }),
      el("td", {}, [m ? withIcon(m.icon, m.name) : el("span", { text: t.label || "Transfer" })]),
      el("td", {}, [c ? categoryLabel(c.name, c.color, c.icon) : el("span", { class: "muted small", text: "—" })]),
      el("td", { class: "num" }, [amountText(t.amount, "EUR", fx.prefs)]),
    ]);
  });
  const table = el("table", { class: "table gtable-dense" }, [
    el("thead", {}, [el("tr", {}, ["Date", "Merchant", "Category", "Amount"].map((h) => el("th", { scope: "col", class: h === "Amount" ? "num" : "", text: h })))]),
    el("tbody", {}, rows),
  ]);
  return [gcard("All entries", "receipt", el("div", { class: "table-wrap" }, [table]), { full: true })];
}
function txnCardList() {
  const cards = fx.transactions.map((t) => {
    const m = t.payee ? merchant(t.payee) : null;
    const c = t.category ? cat(t.category) : null;
    return el("div", { class: "gminicard" }, [
      m ? withIcon(m.icon, m.name) : el("strong", { text: t.label || "Transfer" }),
      el("div", { class: "gminicard__amount" }, [amountText(t.amount, "EUR", fx.prefs)]),
      el("div", { class: "muted small" }, [t.date, c ? " · " : "", c ? categoryLabel(c.name, c.color, c.icon) : null]),
    ]);
  });
  return [gcard("All entries", "receipt", el("div", { class: "ggrid ggrid--cards" }, cards), { full: true })];
}
function txnFilterFirst() {
  const filters = gcard("Filters", "filter", el("ul", { class: "stack" }, ["Account: All", "Category: All", "Person: All", "Period: This month"].map((f) => el("li", { text: f }))));
  const list = gcard("Matching entries", "receipt", el("ul", { class: "stack" }, fx.transactions.map(txRow)));
  return [el("div", { class: "gsplit" }, [filters, list])];
}
const TRANSACTIONS_RENDERERS = { "flat-list": txnFlatList, "grouped-by-date": txnGroupedByDate, "dense-table": txnDenseTable, "card-list": txnCardList, "filter-first": txnFilterFirst };
function renderTransactions(concept) {
  const fn = TRANSACTIONS_RENDERERS[concept.transactionsPattern] || txnFlatList;
  return el("div", { class: "gpage gpage--list" }, [pageTitle("transactions"), ...fn()]);
}

// ---- Bills: four genuinely different compositions --------------------------------------------------
function billsGroupedStatus() {
  const groups = [["Overdue", "overdue"], ["Due soon", "due-soon"], ["Upcoming", "upcoming"]];
  return groups.map(([label, status]) => {
    const rows = fx.bills.filter((b) => b.status === status);
    return rows.length ? gcard(label, "calendar", el("ul", { class: "stack" }, rows.map(billRow)), { full: true }) : null;
  });
}
function billsTimeline() {
  const events = [...fx.bills].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  return [gcard("All bills, in order", "clock", el("ol", { class: "gtimeline" }, events.map((b) => el("li", { class: ["gtimeline__item", b.status === "overdue" ? "gtimeline__item--past" : "gtimeline__item--future"] }, [el("span", { class: "gtimeline__date muted small", text: b.dueDate }), billRow(b)]))), { full: true })];
}
function billsKanban() {
  const groups = [["Overdue", "overdue"], ["Due soon", "due-soon"], ["Upcoming", "upcoming"]];
  return [el("div", { class: "gkanban" }, groups.map(([label, status]) => gcard(label, "calendar", el("ul", { class: "stack" }, fx.bills.filter((b) => b.status === status).map(billRow)))))];
}
function billsCompactTable() {
  const rows = fx.bills.map((b) => el("tr", {}, [
    el("td", {}, [withIcon(b.icon, b.name)]),
    el("td", {}, [badge(BILL_STATUS_LABEL[b.status], b.status === "overdue" ? "danger" : b.status === "due-soon" ? "warning" : "")]),
    el("td", { text: b.dueDate }),
    el("td", { class: "num" }, [amountText(b.kind === "income" ? b.amount : `-${b.amount}`, b.currency, fx.prefs)]),
  ]));
  const table = el("table", { class: "table gtable-dense" }, [
    el("thead", {}, [el("tr", {}, ["Bill", "Status", "Due", "Amount"].map((h) => el("th", { scope: "col", class: h === "Amount" ? "num" : "", text: h })))]),
    el("tbody", {}, rows),
  ]);
  return [gcard("All bills", "calendar", el("div", { class: "table-wrap" }, [table]), { full: true })];
}
const BILLS_RENDERERS = { "grouped-status": billsGroupedStatus, timeline: billsTimeline, "kanban-columns": billsKanban, "compact-table": billsCompactTable };
function renderBills(concept) {
  const fn = BILLS_RENDERERS[concept.billsPattern] || billsGroupedStatus;
  return el("div", { class: "gpage gpage--list" }, [pageTitle("bills"), ...fn()]);
}

// ---- Budget: three genuinely different compositions --------------------------------------------------
function budgetBarComparison() {
  const rows = fx.budget.lines.map((l) => {
    const c = cat(l.category);
    const pct = Math.min(100, Math.round((Number(l.spent) / Number(l.planned)) * 100));
    return el("div", { class: "gbarrow" }, [
      categoryLabel(c.name, c.color, c.icon),
      el("div", { class: "gbarrow__track" }, [el("div", { class: "gbarrow__fill", vars: { "--pct": `${pct}%`, "--bar": c.color } })]),
      el("span", { class: "muted small", text: `${l.spent} of ${l.planned}` }),
    ]);
  });
  return [gcard("Planned vs spent, by category", "chart-line", el("div", { class: "stack" }, rows), { full: true })];
}
function budgetListProgress() {
  const rows = fx.budget.lines.map((l) => {
    const c = cat(l.category);
    const over = Number(l.available) < 0;
    const pct = Math.min(100, Math.round((Number(l.spent) / Number(l.planned)) * 100));
    return el("tr", {}, [
      el("td", {}, [categoryLabel(c.name, c.color, c.icon)]),
      el("td", {}, [el("div", { class: "gmeter gmeter--inline" }, [el("div", { class: "gmeter__fill", vars: { "--pct": `${pct}%` } })])]),
      el("td", { class: "num" }, [el("span", { class: over ? "money--out" : "", text: `${over ? "−" : ""}${l.available.replace("-", "")}` })]),
    ]);
  });
  const table = el("table", { class: "table gtable-dense" }, [
    el("thead", {}, [el("tr", {}, ["Category", "Progress", "Available"].map((h) => el("th", { scope: "col", class: h === "Available" ? "num" : "", text: h })))]),
    el("tbody", {}, rows),
  ]);
  return [gcard("Budget lines", "target", el("div", { class: "table-wrap" }, [table]), { full: true })];
}
const BUDGET_RENDERERS = { "envelope-grid": heroEnvelopeGrid, "bar-comparison": budgetBarComparison, "list-progress": budgetListProgress };
function renderBudget(concept) {
  const fn = BUDGET_RENDERERS[concept.budgetPattern] || heroEnvelopeGrid;
  return el("div", { class: "gpage gpage--list" }, [pageTitle("budget"), ...fn()]);
}

// ---- Accounts / Merchants: a page the Gallery was missing entirely (review, 2026-09-18 — the
// design brief names "Accounts/Merchants" as one of the required coordinated views per concept).
// Three genuinely different compositions, each pairing the account list with the managed merchant
// directory, since real BudgetTracker keeps both on view together (app/js/ui/views/accounts.js and
// payees.js are separate pages, but every concept's OWN Accounts view choice is asked to cover both). --
function accountsCardGrid() {
  const cards = fx.accounts.map((a) => el("div", { class: "gminicard" }, [
    withIcon(a.icon, a.name),
    el("div", { class: "gminicard__amount" }, [money(a.balance, a.currency, fx.prefs)]),
    el("div", { class: "muted small", text: a.access === "shared" ? "Shared with workspace" : "Private · yours" }),
  ]));
  const merchantChips = fx.merchants.map((m) => el("span", { class: "badge" }, [withIcon(m.icon, m.name)]));
  return [
    gcard("Accounts", "bank", el("div", { class: "ggrid ggrid--cards" }, cards), { full: true }),
    gcard("Merchants", "store", el("div", { class: "row" }, merchantChips), { full: true }),
  ];
}
function accountsTable() {
  const rows = fx.accounts.map((a) => el("tr", {}, [
    el("td", {}, [withIcon(a.icon, a.name)]),
    el("td", { text: a.type }),
    el("td", { text: a.currency }),
    el("td", { class: "num" }, [money(a.balance, a.currency, fx.prefs)]),
  ]));
  const table = el("table", { class: "table gtable-dense" }, [
    el("thead", {}, [el("tr", {}, ["Account", "Type", "Currency", "Balance"].map((h) => el("th", { scope: "col", class: h === "Balance" ? "num" : "", text: h })))]),
    el("tbody", {}, rows),
  ]);
  const merchantRows = fx.merchants.map((m) => el("tr", {}, [el("td", {}, [withIcon(m.icon, m.name)])]));
  const merchantTable = el("table", { class: "table gtable-dense" }, [el("thead", {}, [el("tr", {}, [el("th", { scope: "col", text: "Merchant" })])]), el("tbody", {}, merchantRows)]);
  return [
    gcard("Accounts", "bank", el("div", { class: "table-wrap" }, [table]), { full: true }),
    gcard("Merchants", "store", el("div", { class: "table-wrap" }, [merchantTable]), { full: true }),
  ];
}
function accountsGroupedByType() {
  const byType = new Map();
  for (const a of fx.accounts) { if (!byType.has(a.type)) byType.set(a.type, []); byType.get(a.type).push(a); }
  const typeLabel = { checking: "Checking", "credit-card": "Credit cards", savings: "Savings", loan: "Loans" };
  const groups = [...byType.entries()].map(([type, list]) => gcard(typeLabel[type] || type, "bank", list.map((a) => el("div", { class: "row" }, [withIcon(a.icon, a.name), el("span", { class: "app__spacer" }), money(a.balance, a.currency, fx.prefs)]))));
  const merchantChips = fx.merchants.map((m) => el("span", { class: "badge" }, [withIcon(m.icon, m.name)]));
  return [...groups, gcard("Merchants", "store", el("div", { class: "row" }, merchantChips), { full: true })];
}
const ACCOUNTS_RENDERERS = { "card-grid": accountsCardGrid, table: accountsTable, "grouped-by-type": accountsGroupedByType };
function renderAccounts(concept) {
  const fn = ACCOUNTS_RENDERERS[concept.accountsPattern] || accountsCardGrid;
  return el("div", { class: "gpage gpage--list" }, [pageTitle("accounts"), ...fn()]);
}

// ---- Shared expenses: three genuinely different compositions (closing the gap the review's own
// "not done" note named — this and Trips were the last two required pages still sharing one
// template across all 15 concepts). ------------------------------------------------------------
function sharedBalanceList() {
  return [
    gcard("Balances", "users", fx.shared.balances.map((b) => el("div", { class: "row" }, [el("span", { text: b.name }), el("span", { class: "app__spacer" }), amountText(b.net, fx.shared.currency, fx.prefs)]))),
    gcard("Recent shared expenses", "receipt", el("ul", { class: "stack" }, fx.shared.expenses.map((g) => el("li", { class: "grow" }, [el("span", { class: "muted small", text: g.date }), el("span", { text: g.description }), el("span", { class: "muted small", text: `paid by ${g.payer}` }), el("span", { class: "app__spacer" }), amountText(`-${g.amount}`, fx.shared.currency, fx.prefs)]))), { full: true }),
  ];
}
function sharedLedgerTable() {
  const rows = fx.shared.expenses.map((g) => el("tr", {}, [
    el("td", { text: g.date }), el("td", { text: g.description }), el("td", { text: g.payer }),
    el("td", { class: "num" }, [amountText(`-${g.amount}`, fx.shared.currency, fx.prefs)]),
  ]));
  const table = el("table", { class: "table gtable-dense" }, [
    el("thead", {}, [el("tr", {}, ["Date", "Description", "Paid by", "Amount"].map((h) => el("th", { scope: "col", class: h === "Amount" ? "num" : "", text: h })))]),
    el("tbody", {}, rows),
  ]);
  const balanceRow = fx.shared.balances.map((b) => el("span", { class: "badge" }, [`${b.name}: `, amountText(b.net, fx.shared.currency, fx.prefs)]));
  return [
    gcard("Balances", "users", el("div", { class: "row" }, balanceRow)),
    gcard("Shared expenses", "receipt", el("div", { class: "table-wrap" }, [table]), { full: true }),
  ];
}
function sharedSettlementFocus() {
  const owes = fx.shared.balances.filter((b) => Number(b.net) < 0);
  const owed = fx.shared.balances.filter((b) => Number(b.net) > 0);
  const suggestions = owes.flatMap((from) => owed.map((to) => el("li", { class: "grow" }, [
    el("span", { text: `${from.name} → ${to.name}` }), el("span", { class: "app__spacer" }),
    amountText(String(Math.min(Math.abs(Number(from.net)), Number(to.net)).toFixed(2)), fx.shared.currency, fx.prefs),
  ])));
  return [
    gcard("Settle up", "scale", suggestions.length ? el("ul", { class: "stack" }, suggestions) : el("p", { class: "muted", text: "Everyone is settled up." }), { full: true }),
    gcard("Recent shared expenses", "receipt", el("ul", { class: "stack" }, fx.shared.expenses.slice(0, 3).map((g) => el("li", { class: "grow" }, [el("span", { text: g.description }), el("span", { class: "app__spacer" }), amountText(`-${g.amount}`, fx.shared.currency, fx.prefs)])))),
  ];
}
const SHARED_RENDERERS = { "balance-list": sharedBalanceList, "ledger-table": sharedLedgerTable, "settlement-focus": sharedSettlementFocus };
function renderShared(concept) {
  const fn = SHARED_RENDERERS[concept.sharedPattern] || sharedBalanceList;
  return el("div", { class: "gpage gpage--list" }, [pageTitle("shared"), ...fn()]);
}

// `withName` is left on for heroSplitFocus, where the surrounding gcard's own title is generic
// ("Active trip") and the trip's own name is not shown anywhere else; the card-grid/list Trips
// patterns below give each trip its own heading already, so they turn this off — never showing
// the same name twice in one card.
function tripCard(t, { withName = true } = {}) {
  const pct = Math.min(100, Math.round((Number(t.spent) / Number(t.budget)) * 100));
  return [
    withName ? withIcon(t.icon, t.name) : null,
    el("p", { class: "muted small", text: t.dateRange }),
    el("div", { class: "gmeter" }, [el("div", { class: "gmeter__fill", vars: { "--pct": `${pct}%` } })]),
    el("p", { class: "small", text: `${t.spent} of ${t.budget} ${t.currency} spent` }),
    el("p", { class: "muted small", text: `With ${t.participants.join(", ")}` }),
  ];
}
const TRIPS_NOTE = "Illustrative only: Trip planning (BT-010) is not yet a real BudgetTracker feature. This page previews how the layout concept would present it.";
function tripsCardGrid() {
  return [el("div", { class: "ggrid ggrid--metrics" }, fx.trips.map((t) => gcard(t.name, t.icon, tripCard(t, { withName: false }))))];
}
function tripsList() {
  return [gcard("Trips", "suitcase", el("ul", { class: "stack" }, fx.trips.map((t) => el("li", { class: "grow" }, [
    withIcon(t.icon, t.name), el("span", { class: "muted small", text: t.dateRange }), el("span", { class: "app__spacer" }),
    el("span", { class: "small", text: `${t.spent} of ${t.budget} ${t.currency}` }),
  ]))), { full: true })];
}
function tripsTimeline() {
  const sorted = [...fx.trips].sort((a, b) => (a.dateRange < b.dateRange ? -1 : 1));
  return [gcard("Trips, in order", "clock", el("ol", { class: "gtimeline" }, sorted.map((t) => el("li", { class: "gtimeline__item gtimeline__item--future" }, [
    el("span", { class: "gtimeline__date muted small", text: t.dateRange }), withIcon(t.icon, t.name), el("span", { class: "muted small" }, [` — ${t.spent} of ${t.budget} ${t.currency}`]),
  ]))), { full: true })];
}
const TRIPS_RENDERERS = { "card-grid": tripsCardGrid, list: tripsList, timeline: tripsTimeline };
function renderTrips(concept) {
  const fn = TRIPS_RENDERERS[concept.tripsPattern] || tripsCardGrid;
  return el("div", { class: "gpage gpage--list" }, [pageTitle("trips"), el("p", { class: "field__help", text: TRIPS_NOTE }), ...fn()]);
}

function settingValueBadge(s) {
  return badge(s.type === "boolean" ? (s.value ? "On" : "Off") : (((s.options || []).find((o) => o.value === s.value) || {}).label || String(s.value)));
}
function settingsFlatList() {
  return [gcard("Workspace settings (illustrative)", "user", el("ul", { class: "stack" }, fx.settingsSample.map((s) => el("li", { class: "grow" }, [
    el("span", {}, [el("strong", { text: s.label })]),
    el("span", { class: "app__spacer" }),
    settingValueBadge(s),
  ]))), { full: true })];
}
// Mirrors the REAL responsive two-column settings layout shipped in the application itself (item 5,
// settingsform.js/components.css .settings-group__body) — reusing the exact same class names, so a
// concept that chooses this pattern previews the production mechanism, not a lookalike.
function settingsTwoColumnGrouped() {
  const rows = fx.settingsSample.map((s) => el("div", { class: "setting" }, [
    el("strong", { text: s.label }),
    settingValueBadge(s),
  ]));
  return [gcard("Workspace settings (illustrative)", "user", el("div", { class: "settings-group__body" }, rows), { full: true })];
}
const SETTINGS_RENDERERS = { "flat-list": settingsFlatList, "two-column-grouped": settingsTwoColumnGrouped };
function renderSettings(concept) {
  const fn = SETTINGS_RENDERERS[concept.settingsPattern] || settingsFlatList;
  return el("div", { class: "gpage gpage--list" }, [pageTitle("settings"), ...fn()]);
}

const PAGE_RENDERERS = { dashboard: renderDashboard, transactions: renderTransactions, bills: renderBills, budget: renderBudget, accounts: renderAccounts, shared: renderShared, trips: renderTrips, settings: renderSettings };

// ---- the frame: nav + page, driven by the concept's own composition parameters --------------------
function renderNav(concept, activeId, onNavigate, requiredPages) {
  const items = requiredPages.map((id) => el("button", {
    type: "button", class: ["gnav__item", id === activeId ? "gnav__item--active" : ""], "aria-current": id === activeId ? "page" : null,
    onClick: () => onNavigate(id),
  }, [withIcon(PAGE_ICON[id], PAGE_LABEL[id])]));
  const brand = el("div", { class: "gnav__brand" }, [withIcon("scale", "BudgetTracker")]);
  if (concept.navStyle === "command") {
    return el("nav", { class: "gnav gnav--command", "aria-label": "Gallery preview navigation" }, [brand, el("div", { class: "gnav__items" }, items.slice(0, 3)), el("span", { class: "gnav__more muted small" }, ["More …"])]);
  }
  return el("nav", { class: "gnav", "aria-label": "Gallery preview navigation" }, [brand, el("div", { class: "gnav__items" }, items)]);
}

/**
 * Renders one concept's preview frame for one required page, using ONLY the shared fixtures and
 * shared components — never a live API call. `onNavigate(pageId)` is called when a person presses a
 * nav item inside the preview (switching the previewed page; the Gallery page owns that state).
 */
export function renderConceptFrame(concept, pageId, onNavigate, { requiredPages = Object.keys(PAGE_LABEL) } = {}) {
  const page = (PAGE_RENDERERS[pageId] || renderDashboard)(concept);
  return el("div", {
    class: "gframe", dataset: { nav: concept.navStyle, density: concept.density, card: concept.cardStyle, page: pageId },
    "aria-label": `${concept.name} preview, ${PAGE_LABEL[pageId] || pageId} page`,
  }, [
    renderNav(concept, pageId, onNavigate, requiredPages),
    el("div", { class: "gframe__main" }, [page]),
  ]);
}

export { PAGE_LABEL, PAGE_ICON };
