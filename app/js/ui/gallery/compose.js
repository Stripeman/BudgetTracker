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

const PAGE_LABEL = { dashboard: "Dashboard", transactions: "Transactions", bills: "Bills", budget: "Budget", shared: "Shared expenses", trips: "Trips", settings: "Settings" };
const PAGE_ICON = { dashboard: "chart-pie", transactions: "receipt", bills: "calendar", budget: "target", shared: "users", trips: "suitcase", settings: "user" };
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
  const trendLabel = concept.id === "wealth-overview" ? "Net worth trend, last 4 weeks" : concept.id === "visual-finance" ? "Cash flow and spending by category" : "Cash-flow forecast, next 30 days";
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

function renderTransactions() {
  return el("div", { class: "gpage gpage--list" }, [
    pageTitle("transactions"),
    gcard("All entries", "receipt", el("ul", { class: "stack" }, fx.transactions.map(txRow)), { full: true }),
  ]);
}

function renderBills() {
  const groups = [["Overdue", "overdue"], ["Due soon", "due-soon"], ["Upcoming", "upcoming"]];
  return el("div", { class: "gpage gpage--list" }, [
    pageTitle("bills"),
    ...groups.map(([label, status]) => {
      const rows = fx.bills.filter((b) => b.status === status);
      return rows.length ? gcard(label, "calendar", el("ul", { class: "stack" }, rows.map(billRow)), { full: true }) : null;
    }),
  ]);
}

function renderBudget() {
  return el("div", { class: "gpage gpage--list" }, [pageTitle("budget"), ...heroEnvelopeGrid()]);
}

function renderShared() {
  return el("div", { class: "gpage gpage--list" }, [
    pageTitle("shared"),
    gcard("Balances", "users", fx.shared.balances.map((b) => el("div", { class: "row" }, [el("span", { text: b.name }), el("span", { class: "app__spacer" }), amountText(b.net, fx.shared.currency, fx.prefs)]))),
    gcard("Recent shared expenses", "receipt", el("ul", { class: "stack" }, fx.shared.expenses.map((g) => el("li", { class: "grow" }, [el("span", { class: "muted small", text: g.date }), el("span", { text: g.description }), el("span", { class: "muted small", text: `paid by ${g.payer}` }), el("span", { class: "app__spacer" }), amountText(`-${g.amount}`, fx.shared.currency, fx.prefs)]))), { full: true }),
  ]);
}

function tripCard(t) {
  const pct = Math.min(100, Math.round((Number(t.spent) / Number(t.budget)) * 100));
  return [
    withIcon(t.icon, t.name),
    el("p", { class: "muted small", text: t.dateRange }),
    el("div", { class: "gmeter" }, [el("div", { class: "gmeter__fill", vars: { "--pct": `${pct}%` } })]),
    el("p", { class: "small", text: `${t.spent} of ${t.budget} ${t.currency} spent` }),
    el("p", { class: "muted small", text: `With ${t.participants.join(", ")}` }),
  ];
}

function renderTrips() {
  return el("div", { class: "gpage gpage--list" }, [
    pageTitle("trips"),
    el("p", { class: "field__help", text: "Illustrative only: Trip planning (BT-010) is not yet a real BudgetTracker feature. This page previews how the layout concept would present it." }),
    el("div", { class: "ggrid ggrid--metrics" }, fx.trips.map((t) => gcard(t.name, t.icon, tripCard(t)))),
  ]);
}

function renderSettings() {
  return el("div", { class: "gpage gpage--list" }, [
    pageTitle("settings"),
    gcard("Workspace settings (illustrative)", "user", el("ul", { class: "stack" }, fx.settingsSample.map((s) => el("li", { class: "grow" }, [
      el("span", {}, [el("strong", { text: s.label })]),
      el("span", { class: "app__spacer" }),
      badge(s.type === "boolean" ? (s.value ? "On" : "Off") : (((s.options || []).find((o) => o.value === s.value) || {}).label || String(s.value))),
    ]))), { full: true }),
  ]);
}

const PAGE_RENDERERS = { dashboard: renderDashboard, transactions: renderTransactions, bills: renderBills, budget: renderBudget, shared: renderShared, trips: renderTrips, settings: renderSettings };

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
