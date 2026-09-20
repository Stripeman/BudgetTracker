// BT-013 Design Gallery — THE SHARED COMPOSITION ENGINE. Every one of the 15 layout concepts is
// rendered by this ONE module: a concept manifest (api/_shared/layouts.js, served by
// /api/design-gallery) selects a nav style, a density, a card style and — for the Dashboard only —
// one of seventeen distinct hero compositions (five added BT-013-09, 2026-09-19, for the genuine
// replacement concepts Terry required); everything below reuses the REAL shared components
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
import { el, svgEl, mount } from "../dom.js";
import { money, categoryLabel, badge, button, amountText, field, pickerSelect, input } from "../components.js";
import { icon, withIcon } from "../icons.js";
import { formatAmount } from "../../core/format.js";
import * as fx from "./fixtures.js";

// BT-013-14 (2026-09-20): 'settings' split into 'mysettings' and 'worksettings' — the Gallery's single
// combined "Settings" page never reflected the real app's own distinction (My Settings: applies only to
// you; Workspace Settings: applies to everyone in the workspace, BT-017) — Terry named both explicitly
// as required pages. Two real pages now, never one page pretending to be both.
const PAGE_LABEL = { dashboard: "Dashboard", transactions: "Transactions", bills: "Bills", budget: "Budget", accounts: "Accounts / Merchants", shared: "Shared expenses", trips: "Trips", mysettings: "My Settings", worksettings: "Workspace Settings", merchants: "Merchants", debt: "Debt detail" };
const PAGE_ICON = { dashboard: "chart-pie", transactions: "receipt", bills: "calendar", budget: "target", accounts: "bank", shared: "users", trips: "suitcase", mysettings: "user", worksettings: "building", merchants: "store", debt: "loan" };
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

// A single filled trend area (Terry's reference 5, "Forecasts · executive overview": a large filled
// forecast chart), with the same three expected/cautious/hopeful lines drawn over the fill so the
// detail the multi-line chart already gave is not lost — never colour alone (the lines keep their own
// dash pattern), and it pairs with the identical sr-only figure table/legend every other chart uses.
function areaChart(points, series, { width = 420, height = 120 } = {}) {
  const all = points.flatMap((p) => series.map((s) => Number(p[s.key])));
  const max = Math.max(1, ...all);
  const min = Math.min(0, ...all);
  const range = Math.max(1, max - min);
  const stepX = points.length > 1 ? width / (points.length - 1) : width;
  const y = (v) => Math.round(height - ((v - min) / range) * (height - 4) - 2);
  const lead = series[0];
  const coords = points.map((p, i) => [Math.round(i * stepX), y(Number(p[lead.key]))]);
  const areaPoints = [[0, height], ...coords, [width, height]].map(([x, yy]) => `${x},${yy}`).join(" ");
  const svg = svgEl("svg", { class: "chart chart--area", viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true", focusable: "false" });
  svg.appendChild(svgEl("polygon", { class: "chart__area-fill", points: areaPoints }));
  for (const s of series) {
    const c = points.map((p, i) => [Math.round(i * stepX), y(Number(p[s.key]))]);
    svg.appendChild(svgEl("polyline", { class: `chart__line chart__line--${s.dash}`, points: c.map(([x, yy]) => `${x},${yy}`).join(" ") }));
  }
  return svg;
}

// A circular progress gauge (Terry's reference 1, "Financial health" ring, and reference 6's debt-
// payoff ring): decorative SVG plus the SAME "figure is stated in real text beside it, never colour
// or the arc alone" rule every meter/envelope already follows — the percentage is real text content
// here (via the caller), this is only the accessible-labelled illustration.
function radialGauge(pct, label, { size = 96, stroke = 10 } = {}) {
  const r = size / 2 - stroke;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = circumference * (1 - clamped / 100);
  const svg = svgEl("svg", { class: "chart chart--gauge", width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: "img", "aria-label": label });
  svg.appendChild(svgEl("circle", { class: "gauge__track", cx, cy, r, "stroke-width": stroke, fill: "none" }));
  svg.appendChild(svgEl("circle", {
    class: "gauge__fill", cx, cy, r, "stroke-width": stroke, fill: "none",
    "stroke-dasharray": circumference, "stroke-dashoffset": offset, transform: `rotate(-90 ${cx} ${cy})`,
  }));
  return el("div", { class: "ggauge" }, [svg, el("span", { class: "ggauge__pct", "aria-hidden": "true", text: `${clamped}%` })]);
}

// A two-series comparison bar chart (planned vs. spent, one paired group per category) — BT-013-10,
// built for the Finexa-inspired Budget page (`.local/refcheck/r02.png`'s "Budget Utilization" chart):
// the category with the highest utilization gets a highlighted (solid) spent bar, the rest stay a
// muted accent, matching the reference's own single-highlighted-month treatment. Decorative only,
// aria-hidden, and always paired with the same sr-only figure table every other chart here uses.
function dualBarChart(lines, highlightIndex, { width = 520, height = 140 } = {}) {
  const max = Math.max(1, ...lines.flatMap((l) => [l.planned, l.spent]));
  const n = Math.max(1, lines.length);
  const groupWidth = width / n;
  const barWidth = groupWidth / 3;
  const svg = svgEl("svg", { class: "chart chart--dualbars", viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true", focusable: "false" });
  lines.forEach((l, i) => {
    const x0 = i * groupWidth + groupWidth / 2 - barWidth;
    const hPlanned = Math.round((l.planned / max) * (height - 4));
    const hSpent = Math.round((l.spent / max) * (height - 4));
    svg.appendChild(svgEl("rect", { class: "chart__bar chart__bar--planned", x: x0, y: height - hPlanned, width: Math.max(1, barWidth - 2), height: Math.max(0, hPlanned) }));
    svg.appendChild(svgEl("rect", {
      class: `chart__bar chart__bar--spent${i === highlightIndex ? " chart__bar--highlight" : ""}`,
      x: x0 + barWidth, y: height - hSpent, width: Math.max(1, barWidth - 2), height: Math.max(0, hSpent),
    }));
  });
  return svg;
}

// A filled trend chart for the Ledgerfly-inspired forecast overview (BT-013-10, `.local/refcheck/r05.png`'s
// dominant "Cash Forecast" chart) — deliberately built as its OWN primitive with its OWN class names
// (`chart--trendfill`/`chart__trend-fill`), never reusing `areaChart`'s `chart--area`/`chart__area-fill`
// classes: `wealth-overview` is the one and only concept whose `chartEmphasis` is `'area'`
// (api/test/layouts.test.js asserts this exactly), and a shared class name would have made this
// concept's bespoke Dashboard trip the existing "every OTHER concept's dashboard never renders the
// area chart" test even though it is a structurally different composition. Reuses the shared
// `chart__line--solid/dashed/dotted` dash-pattern classes (never colour alone), and always pairs with
// the same sr-only figure table every other chart here uses.
function forecastTrendChart(points, series, { width = 520, height = 160 } = {}) {
  const all = points.flatMap((p) => series.map((s) => Number(p[s.key])));
  const max = Math.max(1, ...all);
  const min = Math.min(0, ...all);
  const range = Math.max(1, max - min);
  const stepX = points.length > 1 ? width / (points.length - 1) : width;
  const y = (v) => Math.round(height - ((v - min) / range) * (height - 4) - 2);
  const lead = series[0];
  const coords = points.map((p, i) => [Math.round(i * stepX), y(Number(p[lead.key]))]);
  const areaPoints = [[0, height], ...coords, [width, height]].map(([x, yy]) => `${x},${yy}`).join(" ");
  const svg = svgEl("svg", { class: "chart chart--trendfill", viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true", focusable: "false" });
  svg.appendChild(svgEl("polygon", { class: "chart__trend-fill", points: areaPoints }));
  for (const s of series) {
    const c = points.map((p, i) => [Math.round(i * stepX), y(Number(p[s.key]))]);
    svg.appendChild(svgEl("polyline", { class: `chart__line chart__line--${s.dash}`, points: c.map(([x, yy]) => `${x},${yy}`).join(" ") }));
  }
  return svg;
}

// A filled percentage dial (BT-013-10, matching the reference's own solid-pie category card) — a
// genuinely different visual family from `radialGauge`'s hollow ring, built with a CSS conic-gradient
// rather than SVG arc trigonometry. Purely decorative (aria-hidden): the real percentage is always
// shown as visible text beside it by the caller, never colour or the dial alone.
function pieDial(pct, { size = 76 } = {}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return el("div", { class: "gpie", "aria-hidden": "true", vars: { "--pie-pct": `${clamped}%`, "--pie-size": `${size}px` } });
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
  // Reference 5 ("Forecasts · executive overview"): a large FILLED forecast area, not a bare line —
  // used only where the concept's own chartEmphasis asks for it (never decoration for its own sake).
  const chart = concept.chartEmphasis === "area" ? areaChart(fx.forecast.points, series) : multiLineChart(fx.forecast.points, series);
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
  // BT-013-12 (2026-09-20): polished in place for `wealth-overview` ("Net Worth Atlas"), the sole
  // `chartEmphasis: 'area'` concept — a real Assets/Liabilities breakdown beneath the trend, answering
  // "what do I actually have" with the same real accounts the trend chart itself is built from.
  if (concept.id === "wealth-overview") {
    const assets = fx.accounts.filter((a) => Number(a.balance) >= 0);
    const liabilities = fx.accounts.filter((a) => Number(a.balance) < 0);
    const totalAssets = assets.reduce((s, a) => s + Number(a.balance), 0);
    const totalLiabilities = liabilities.reduce((s, a) => s + Math.abs(Number(a.balance)), 0);
    blocks.push(el("div", { class: "gwealth-split" }, [
      gcard("Assets", "bank", [
        el("p", { class: "gwealth-total" }, [money(totalAssets.toFixed(2), "EUR", fx.prefs)]),
        el("ul", { class: "stack" }, assets.map((a) => el("li", { class: "row" }, [withIcon(a.icon, a.name), el("span", { class: "app__spacer" }), money(a.balance, a.currency, fx.prefs)]))),
      ]),
      gcard("Liabilities", "loan", [
        el("p", { class: "gwealth-total" }, [amountText((-totalLiabilities).toFixed(2), "EUR", fx.prefs)]),
        el("ul", { class: "stack" }, liabilities.map((a) => el("li", { class: "row" }, [withIcon(a.icon, a.name), el("span", { class: "app__spacer" }), money(a.balance, a.currency, fx.prefs)]))),
      ]),
    ]));
  }
  return blocks;
}

// BT-013-12 (2026-09-20): polished in place for `precision-grid` ("Spreadsheet Mode"), its sole
// remaining user — a real accounts x metrics data grid (not a mockup, every figure derived from the
// same canonical fixtures) leads, matching its own "spreadsheet-minded" identity, with the recent
// ledger beneath it.
function heroTableFirst() {
  const spentByAccount = new Map();
  for (const t of fx.transactions) { if (Number(t.amount) < 0) spentByAccount.set(t.account, (spentByAccount.get(t.account) || 0) + -Number(t.amount)); }
  const rows = fx.accounts.map((a) => el("tr", {}, [
    el("td", {}, [withIcon(a.icon, a.name)]),
    el("td", { class: "num" }, [money(a.balance, a.currency, fx.prefs)]),
    el("td", { class: "num" }, [amountText((-(spentByAccount.get(a.id) || 0)).toFixed(2), a.currency, fx.prefs)]),
  ]));
  const grid = el("table", { class: "table gtable-dense" }, [
    el("thead", {}, [el("tr", {}, ["Account", "Balance", "Spent this period"].map((h) => el("th", { scope: "col", class: h === "Account" ? "" : "num", text: h })))]),
    el("tbody", {}, rows),
  ]);
  return [
    gcard("Accounts at a glance", "bank", el("div", { class: "table-wrap" }, [grid]), { full: true }),
    gcard("Recent entries", "receipt", el("ul", { class: "stack" }, fx.transactions.slice(0, 6).map(txRow)), { full: true }),
  ];
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

function heroGoalProgress(concept) {
  const loan = account("acc-loan");
  const savings = account("acc-savings");
  const pct = (paid, total) => Math.round((paid / total) * 100);
  const loanPct = pct(3520, 15000);
  const savingsPct = pct(8420, 12000);
  const meter = (p) => el("div", { class: "gmeter", role: "img", "aria-label": `${p}% of the way there` }, [el("div", { class: "gmeter__fill", vars: { "--pct": `${p}%` } })]);
  // References 1 ("Financial health" ring) and 6 (debt-payoff ring): a circular gauge leads instead
  // of the plain linear meter, only where the concept's own chartEmphasis chooses it.
  const useGauge = concept && concept.chartEmphasis === "donut";
  const progress = (p, label) => (useGauge ? radialGauge(p, label) : meter(p));
  return [
    gcard("Car loan payoff", "loan", [progress(loanPct, `${loanPct}% of the loan paid off`), el("p", { text: `${loanPct}% paid — ${formatAmount("3520.00", "EUR")} of ${formatAmount("15000.00", "EUR")}` }), el("p", { class: "muted small", text: `Balance remaining: ${loan.balance} EUR` })]),
    gcard("Savings goal: Emergency fund", "target", [progress(savingsPct, `${savingsPct}% of the way to the savings goal`), el("p", { text: `${savingsPct}% of the way to 12,000.00 EUR` }), el("p", { class: "muted small", text: `Current: ${savings.balance} EUR` })]),
  ];
}

function heroMerchantFeed() {
  return [gcard("Merchant activity", "store", el("ul", { class: "stack" }, fx.merchants.map((m) => {
    const spend = fx.transactions.filter((t) => t.payee === m.id).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    return el("li", { class: "grow" }, [withIcon(m.icon, m.name), el("span", { class: "app__spacer" }), amountText(String(-spend.toFixed(2)), "EUR", fx.prefs), el("span", { class: "muted small", text: "this month" })]);
  })), { full: true })];
}

function heroEnvelopeGrid() {
  // BT-013-13 (2026-09-20): only reached as a Budget-page pattern today (no concept's own Dashboard
  // uses 'envelope-grid' any more) — safe to add the same real summary row every other remaining
  // Budget pattern now carries.
  return [budgetSummaryRow(), gcard("Budget envelopes", "target", el("div", { class: "ggrid ggrid--envelopes" }, fx.budget.lines.map((l) => {
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

function heroCommandConsole(concept) {
  const panels = [
    gcard("Needs attention", "bell", el("ul", { class: "stack" }, fx.alerts.map((a) => el("li", { class: "iconlabel" }, [icon(a.icon), el("span", { text: a.text })])))),
    gcard("Forecast", "chart-line", [barChart(fx.forecast.points.map((p) => ({ value: p.expected })))]),
    gcard("Bills due", "calendar", el("ul", { class: "stack" }, fx.bills.slice(0, 3).map(billRow))),
    gcard("Balances", "bank", fx.accounts.map((a) => el("div", { class: "row" }, [withIcon(a.icon, a.name), el("span", { class: "app__spacer" }), money(a.balance, a.currency, fx.prefs)]))),
  ];
  // Reference 1's "Financial health" ring, for the one concept whose chartEmphasis asks for a
  // second, denser chart family alongside the bar forecast (never a total computed independently —
  // the same spent/planned figures already shown on Budget are only sized for the ring here).
  if (concept && concept.chartEmphasis === "mixed") {
    const spent = fx.budget.lines.reduce((s, l) => s + Number(l.spent), 0);
    const planned = fx.budget.lines.reduce((s, l) => s + Number(l.planned), 0);
    const pct = Math.round((spent / planned) * 100);
    panels.push(gcard("Budget used", "target", [radialGauge(pct, `${pct}% of this month's budget used`), el("p", { class: "muted small", text: `${spent.toFixed(2)} of ${planned.toFixed(2)} EUR planned` })]));
  }
  return panels;
}

// BT-013-12 (2026-09-20): now sole-held by `analyst-workspace` ("Filter Desk") — `travel-ledger` has
// its own bespoke `heroTripFocus` below, since sharing one generic split-panel structure between two
// concepts with genuinely different identities was exactly the "template combination" Terry rejected.
// Polished in place: a real dense category report (spent/planned/available per category, not just a
// plain balances list) beside the filters, matching Filter Desk's own "comparisons, reporting,
// data-density" identity.
function heroSplitFocus() {
  const filters = gcard("Filters", "filter", el("ul", { class: "stack" }, ["Account: All", "Category: All", "Period: This month"].map((f) => el("li", { text: f }))));
  const rows = fx.budget.lines.map((l) => {
    const c = cat(l.category);
    return el("tr", {}, [
      el("td", {}, [categoryLabel(c.name, c.color, c.icon)]),
      el("td", { class: "num" }, [formatAmount(l.spent, "EUR")]),
      el("td", { class: "num" }, [formatAmount(l.planned, "EUR")]),
      el("td", { class: "num" }, [formatAmount(l.available, "EUR")]),
    ]);
  });
  const table = el("table", { class: "table gtable-dense" }, [
    el("thead", {}, [el("tr", {}, ["Category", "Spent", "Planned", "Available"].map((h, i) => el("th", { scope: "col", class: i ? "num" : "", text: h })))]),
    el("tbody", {}, rows),
  ]);
  const report = gcard("Category report", "chart-pie", el("div", { class: "table-wrap" }, [table]));
  return [el("div", { class: "gsplit" }, [filters, report])];
}

// BT-013-12 (2026-09-20): a genuinely bespoke Dashboard for `travel-ledger` ("Journey Ledger"),
// separated out of the old shared `split-focus` pattern it used to recombine with Filter Desk — a
// dominant "Active trip" card (real trip progress, from `fx.trips`) anchors the page, with a real
// balances/settlement pair beneath, matching this concept's own trip-and-settlement identity.
function heroTripFocus() {
  const trip = fx.trips[0];
  const hero = gcard("Active trip", "suitcase", tripCard(trip), { full: true });
  const balances = gcard("Balances", "bank", fx.accounts.map((a) => el("div", { class: "row" }, [withIcon(a.icon, a.name), el("span", { class: "app__spacer" }), money(a.balance, a.currency, fx.prefs)])));
  const owes = fx.shared.balances.filter((b) => Number(b.net) < 0);
  const owed = fx.shared.balances.filter((b) => Number(b.net) > 0);
  const suggestions = owes.flatMap((from) => owed.map((to) => el("li", { class: "grow" }, [
    el("span", { text: `${from.name} → ${to.name}` }), el("span", { class: "app__spacer" }),
    amountText(String(Math.min(Math.abs(Number(from.net)), Number(to.net)).toFixed(2)), fx.shared.currency, fx.prefs),
  ])));
  const settle = gcard("Settle up", "scale", suggestions.length ? el("ul", { class: "stack" }, suggestions) : el("p", { class: "muted", text: "Everyone is settled up." }));
  return [hero, el("div", { class: "gsplit" }, [balances, settle])];
}

// `onNavigate` is the SAME callback the frame's own nav items already use (renderConceptFrame):
// pressing "Add expense" here switches the previewed page to Transactions, exactly what every real
// BudgetTracker dashboard's own "Add expense" leads toward. Fixed from a silent no-op (review,
// 2026-09-19): a button that does nothing is exactly the kind of dead control Terry's brief asked
// this Gallery to never present, even in a preview.
// BT-013-12 (2026-09-20): polished in place for `focus-mode` ("One Thing Mode") — a single, large,
// centred focal card replaces the old top-aligned paragraph stack, matching its own "do the one
// thing" identity more deliberately, while keeping the exact wired "Add expense" button (text and
// behaviour unchanged — a real dedicated test presses it and expects the preview to navigate).
function heroStoryFlow(concept, onNavigate) {
  return [
    el("div", { class: "gstory" }, [
      el("div", { class: "gstory__icon", "aria-hidden": "true" }, [icon("scale")]),
      el("p", { class: "gstory__lede", text: "Good news: you're on track this week." }),
      el("p", {}, ["You've spent ", amountText("192.35", "EUR", fx.prefs), " so far today across Groceries and Dining."]),
      el("p", {}, ["Coming up: Electricity (", amountText("-95.00", "EUR", fx.prefs), ") is due in 2 days."]),
      el("p", { class: "gstory__net" }, ["Your net position is ", money(fx.netPosition.amount, fx.netPosition.currency, fx.prefs), "."]),
      button("Add expense", () => { if (typeof onNavigate === "function") onNavigate("transactions"); }, { variant: "primary" }),
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

// ---- five further, GENUINELY NEW hero compositions (BT-013-09, 2026-09-19: Terry rejected the
// original 15 concepts outright and asked for substantially redesigned, distinct options — never
// incremental adjustment of what he had already seen). Each is a real, different information
// structure, built from the same shared fixtures/components as every other hero above, never a
// recoloured copy of one of the twelve already here. ---------------------------------------------
// A single headline figure plus a short, real, ordered list of what actually matters right now —
// distinct from story-flow's prose paragraphs (no explicit list there) and from adaptive's
// alerts-first reordering (this always leads with the headline number, never reorders).
// BT-013-12 (2026-09-20): polished in place for `calm-budget` ("Morning Briefing") — a soft gradient
// card and a real date line, keeping the exact wired "Add expense" button unchanged.
function heroBriefing(concept, onNavigate) {
  const priorities = [
    { icon: "alert", text: `Electricity (${formatAmount("95.00", "EUR")}) is due in 2 days.` },
    { icon: "receipt", text: `You've spent ${formatAmount("192.35", "EUR")} today, mostly Groceries and Dining.` },
    { icon: "scale", text: `Your net position is ${formatAmount(fx.netPosition.amount, fx.netPosition.currency)}.` },
  ];
  const latest = [...fx.transactions].sort((a, b) => (a.date > b.date ? -1 : 1))[0];
  const dateLabel = new Date(`${latest.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return [el("div", { class: "gbriefing__wrap" }, [gcard("Today's briefing", "bell", [
    el("p", { class: "muted small", text: dateLabel }),
    el("p", { class: "gbriefing__headline" }, [money(fx.netPosition.amount, fx.netPosition.currency, fx.prefs)]),
    el("p", { class: "muted small", text: "Net position across every account you can see" }),
    el("ul", { class: "gbriefing__list" }, priorities.map((p) => el("li", { class: "iconlabel" }, [icon(p.icon), el("span", { text: p.text })]))),
    button("Add expense", () => { if (typeof onNavigate === "function") onNavigate("transactions"); }, { variant: "primary" }),
  ], { full: true })])];
}
// One unified, urgency-sorted feed (alerts AND bills together, sorted Now/Soon/Later) — distinct
// from command-console's four separate, fixed, equal-weight panels: here there is exactly one list,
// and its own order is the whole point.
// BT-013-12 (2026-09-20): polished in place for `financial-command-center` ("Ops Console") — a slim
// top KPI ribbon (real urgency counts) anchors the page, with the single unified feed now split into
// real Now/Soon/Later SECTIONS (not just an inline badge per row), matching its own "console" density.
function heroInbox() {
  const items = [
    ...fx.alerts.map((a) => ({ urgency: "now", icon: a.icon, text: a.text })),
    ...fx.bills.map((b) => ({ urgency: b.status === "overdue" ? "now" : b.status === "due-soon" ? "soon" : "later", icon: b.icon, text: `${b.name} due ${b.dueDate}` })),
  ];
  const order = { now: 0, soon: 1, later: 2 };
  const sorted = [...items].sort((a, b) => order[a.urgency] - order[b.urgency]);
  const label = { now: "Now", soon: "Soon", later: "Later" };
  const variant = { now: "danger", soon: "warning", later: "" };
  const ribbon = el("div", { class: "goc-ribbon" }, Object.keys(label).map((key) => metric(label[key], String(sorted.filter((it) => it.urgency === key).length), null)));
  const sections = Object.keys(label).map((key) => {
    const rows = sorted.filter((it) => it.urgency === key);
    return rows.length ? gcard(label[key], "bell", el("ul", { class: "ginbox" }, rows.map((it) => el("li", { class: "ginbox__row" }, [badge(label[key], variant[key]), withIcon(it.icon, it.text)]))), { full: true }) : null;
  }).filter(Boolean);
  return [ribbon, ...sections];
}
// Several compact radial gauges together (budget used, savings goal, loan payoff) — distinct from
// goal-progress's two full-width detailed cards: this is denser, gauge-only, side by side.
function heroRingCluster() {
  const loanPct = Math.round((3520 / 15000) * 100);
  const savingsPct = Math.round((8420 / 12000) * 100);
  const spent = fx.budget.lines.reduce((s, l) => s + Number(l.spent), 0);
  const planned = fx.budget.lines.reduce((s, l) => s + Number(l.planned), 0);
  const budgetPct = Math.round((spent / planned) * 100);
  const rings = [{ pct: budgetPct, label: "Budget used this month" }, { pct: savingsPct, label: "Savings goal reached" }, { pct: loanPct, label: "Loan paid off" }];
  return [gcard("At a glance", "target", el("div", { class: "gringcluster" }, rings.map((r) => el("div", { class: "gringcluster__item" }, [radialGauge(r.pct, `${r.pct}% — ${r.label}`), el("p", { class: "small", text: r.label })]))), { full: true })];
}
// An asymmetric tile grid (one large tile, several smaller, one wide) — distinct from metric-grid's
// uniform, equal-weight grid: real visual hierarchy via tile SIZE, not just card order.
// BT-013-12 (2026-09-20): polished in place for `modern-banking` ("Everyday Banking") — the big tile
// now carries a real day-by-day net-movement sparkline (derived from the same fixtures, never a
// second invented dataset), and every figure below is computed rather than a hand-typed literal.
function heroMosaic(concept) {
  const byDate = new Map();
  for (const t of fx.transactions) byDate.set(t.date, (byDate.get(t.date) || 0) + Number(t.amount));
  const trendPoints = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, value]) => ({ value }));
  const spentTotal = fx.budget.lines.reduce((s, l) => s + Number(l.spent), 0);
  const plannedTotal = fx.budget.lines.reduce((s, l) => s + Number(l.planned), 0);
  const billsDue = fx.bills.filter((b) => b.kind !== "income" && b.status !== "upcoming");
  const tiles = [
    el("div", { class: "gmosaic__tile gmosaic__tile--big" }, [gcard("Net position", "scale", [
      el("div", { class: "gcard__value" }, [money(fx.netPosition.amount, fx.netPosition.currency, fx.prefs)]),
      el("p", { class: "muted small", text: "Across every account you can see" }),
      barChart(trendPoints, { width: 320, height: 56 }),
    ])]),
    el("div", { class: "gmosaic__tile" }, [gcard("Budget", "target", [amountText((plannedTotal - spentTotal).toFixed(2), "EUR", fx.prefs), el("p", { class: "muted small", text: "left to spend" })])]),
    el("div", { class: "gmosaic__tile" }, [gcard("Bills due", "calendar", [el("span", { text: String(billsDue.length) }), el("p", { class: "muted small", text: billsDue.some((b) => b.status === "overdue") ? "1 overdue" : "none overdue" })])]),
    el("div", { class: "gmosaic__tile" }, [gcard("Shared balance", "users", [amountText(fx.shared.balances[0].net, fx.shared.currency, fx.prefs)])]),
    el("div", { class: "gmosaic__tile gmosaic__tile--wide" }, [gcard("Recent entries", "receipt", el("ul", { class: "stack" }, fx.transactions.slice(0, 3).map(txRow)))]),
  ];
  // Reference 1's "Financial health" ring, for the one concept whose chartEmphasis asks for a
  // second, denser chart family alongside the plain figures (never a total computed independently —
  // the same spent/planned figures already shown on Budget are only sized for the ring here).
  if (concept && concept.chartEmphasis === "mixed") {
    const spent = fx.budget.lines.reduce((s, l) => s + Number(l.spent), 0);
    const planned = fx.budget.lines.reduce((s, l) => s + Number(l.planned), 0);
    const pct = Math.round((spent / planned) * 100);
    tiles.push(el("div", { class: "gmosaic__tile" }, [gcard("Budget used", "target", [radialGauge(pct, `${pct}% of this month's budget used`), el("p", { class: "muted small", text: `${spent.toFixed(2)} of ${planned.toFixed(2)} EUR planned` })])]));
  }
  return [el("div", { class: "gmosaic" }, tiles)];
}
// A horizontal strip of key figures above the real recent-entries table — distinct from table-first
// alone (this adds a genuinely different, scannable KPI header) and from metric-grid (a strip, not a
// wrapping grid; reuses heroTableFirst's own table beneath it, never a duplicated implementation).
// BT-013-12 (2026-09-20): polished in place for `executive-ledger` ("Ledger Command") — the KPI
// strip now carries real meta context per figure (not a bare number), and the table beneath is a
// genuine two-column layout (the real ledger dominant, a slim "needs attention"/accounts rail beside
// it) rather than a bare stacked table, matching its own "authority and completeness" identity.
function heroLedgerStrip() {
  const spentTotal = fx.budget.lines.reduce((s, l) => s + Number(l.spent), 0);
  const plannedTotal = fx.budget.lines.reduce((s, l) => s + Number(l.planned), 0);
  const billsDue = fx.bills.filter((b) => b.kind !== "income" && b.status !== "upcoming");
  const overdue = billsDue.filter((b) => b.status === "overdue").length;
  const stats = [
    ["Net position", money(fx.netPosition.amount, fx.netPosition.currency, fx.prefs), "Across every account you can see"],
    ["Budget left", amountText((plannedTotal - spentTotal).toFixed(2), "EUR", fx.prefs), `of ${formatAmount(plannedTotal.toFixed(2), "EUR")} planned`],
    ["Bills due", el("span", { text: String(billsDue.length) }), overdue ? `${overdue} overdue` : "None overdue"],
    ["Shared balance", amountText(fx.shared.balances[0].net, fx.shared.currency, fx.prefs), "You are owed"],
  ];
  const strip = el("div", { class: "gledgerstrip" }, stats.map(([label, value, meta]) => el("div", { class: "gledgerstrip__item" }, [
    el("p", { class: "gledgerstrip__label", text: label }), el("div", { class: "gledgerstrip__value" }, [value]),
    el("p", { class: "muted small", text: meta }),
  ])));
  const ledger = gcard("Ledger", "receipt", el("ul", { class: "stack" }, fx.transactions.slice(0, 6).map(txRow)), { full: true });
  const attention = gcard("Needs attention", "bell", el("ul", { class: "stack" }, fx.alerts.map((a) => el("li", { class: "iconlabel" }, [icon(a.icon), el("span", { text: a.text })]))));
  const balances = gcard("Accounts", "bank", fx.accounts.map((a) => el("div", { class: "row" }, [withIcon(a.icon, a.name), el("span", { class: "app__spacer" }), money(a.balance, a.currency, fx.prefs)])));
  return [
    el("div", { class: "gledgerstrip-wrap" }, [strip]),
    el("div", { class: "glcmd-grid" }, [el("div", { class: "glcmd-main" }, [ledger]), el("div", { class: "glcmd-side" }, [attention, balances])]),
  ];
}

// BT-013-10 (Terry, 2026-09-20): a BESPOKE Dashboard composition for `acru-overview`, built closely
// against the real ACRU reference image (`.local/refcheck/r01.png`, extracted from
// docs/BudgetTracker-references.html) — its whole page composition, not one borrowed element.
// Deliberately NOT assembled from the shared hero vocabulary above: its own utility header, its own
// two-column-plus-lower-row grid (`.gacru-*`, gallery.css), reusing shared PRIMITIVES (money,
// categoryLabel, radialGauge, barChart, txRow, billRow) and the real canonical fixtures, never a
// second parallel data model. The reference's own bank-card/promo area is replaced entirely with real
// BudgetTracker content (accounts, upcoming bills) per Terry's explicit instruction; there is no
// "Upgrade to Pro" or any promotional content anywhere in this composition.
function heroReferenceAcru() {
  // Every figure below is DERIVED from the same canonical fixtures every other concept already
  // shares — never a separately invented number.
  const incomeTotal = fx.transactions.filter((t) => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const expenseTotal = fx.transactions.filter((t) => Number(t.amount) < 0).reduce((s, t) => s - Number(t.amount), 0);
  const byDate = new Map();
  for (const t of fx.transactions) byDate.set(t.date, (byDate.get(t.date) || 0) + Number(t.amount));
  const days = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const chartPoints = days.map(([date, value]) => ({ date, value }));
  const peak = chartPoints.reduce((m, p) => (Math.abs(p.value) > Math.abs(m.value) ? p : m), chartPoints[0]);
  const fmt = (v) => formatAmount(v.toFixed(2), fx.netPosition.currency);

  const spendByCat = new Map();
  let totalSpend = 0;
  for (const t of fx.transactions) {
    if (Number(t.amount) >= 0 || !t.category) continue;
    const v = -Number(t.amount);
    spendByCat.set(t.category, (spendByCat.get(t.category) || 0) + v);
    totalSpend += v;
  }
  const segments = [...spendByCat.entries()].map(([id, v]) => ({ cat: cat(id), amount: v, pct: Math.round((v / totalSpend) * 100) })).sort((a, b) => b.amount - a.amount);

  const plannedTotal = fx.budget.lines.reduce((s, l) => s + Number(l.planned), 0);
  const spentTotal = fx.budget.lines.reduce((s, l) => s + Number(l.spent), 0);
  const healthPct = Math.max(0, Math.min(100, Math.round((spentTotal / plannedTotal) * 100)));

  // ---- restrained utility header: search, notifications, an account avatar, one primary action ----
  const search = input({ type: "search", placeholder: "Quick search", "aria-label": "Quick search this workspace" });
  const header = el("div", { class: "gacru-header" }, [
    el("div", { class: "gacru-search" }, [search]),
    el("div", { class: "gacru-header__actions" }, [
      el("button", { type: "button", class: "gacru-iconbtn", "aria-label": "Notifications" }, [icon("bell")]),
      el("div", { class: "gacru-avatar" }, [icon("user"), el("span", { class: "small", text: "Alice Fictional" })]),
      button("+ Add entry", () => {}, { variant: "primary", small: true }),
    ]),
  ]);

  // ---- the hero: a large central chart anchoring the page, with income/expense/net beside it -------
  const heroCard = gcard("Balance overview", "chart-line", [
    el("div", { class: "gacru-hero__top" }, [
      el("div", {}, [
        el("p", { class: "gacru-hero__figure" }, [money(fx.netPosition.amount, fx.netPosition.currency, fx.prefs)]),
        el("p", { class: "muted small", text: "Net position across every account you can see" }),
      ]),
      el("div", { class: "gchart__legend" }, [el("span", { class: "gchart__key" }), " Net movement per day"]),
    ]),
    barChart(chartPoints, { width: 520, height: 140 }),
    figureTable(chartPoints.map((p) => [p.date, fmt(p.value)]), "Net cash movement per day", ["Date", "Net"]),
    peak ? el("p", { class: "muted small", text: `Largest movement: ${peak.date}, ${fmt(peak.value)}` }) : null,
  ]);
  const statRail = el("div", { class: "gacru-statrail" }, [
    metric("Total income", amountText(incomeTotal.toFixed(2), fx.netPosition.currency, fx.prefs), "This period"),
    metric("Total expenses", amountText((-expenseTotal).toFixed(2), fx.netPosition.currency, fx.prefs), "This period"),
    metric("Net position", money(fx.netPosition.amount, fx.netPosition.currency, fx.prefs), "Across every account you can see"),
  ]);

  // ---- right column: real BudgetTracker content replaces the reference's bank-card/promo area -------
  const accountsCard = gcard("Accounts", "bank", el("ul", { class: "stack" }, fx.accounts.map((a) => el("li", { class: "grow" }, [
    withIcon(a.icon, a.name), el("span", { class: "app__spacer" }), money(a.balance, a.currency, fx.prefs),
  ]))));
  const billsCard = gcard("Upcoming bills", "calendar", el("ul", { class: "stack" }, fx.bills.slice(0, 4).map(billRow)));
  const txCard = gcard("Transaction history", "receipt", el("ul", { class: "stack" }, fx.transactions.slice(0, 6).map(txRow)));

  // ---- lower panels: spending distribution, overall budget health, this month's budget progress -----
  const segBar = el("div", { class: "gacru-segbar" }, segments.map((s) => el("span", { class: "gacru-segbar__seg", vars: { "--seg-pct": `${s.pct}%`, "--seg-color": s.cat.color } })));
  const segLegend = el("ul", { class: "gacru-seglegend" }, segments.map((s) => el("li", {}, [categoryLabel(s.cat.name, s.cat.color, s.cat.icon), el("span", { class: "app__spacer" }), el("span", { class: "small", text: `${s.pct}%` })])));
  const spendingCard = gcard("Spending distribution", "chart-pie", [
    el("p", { class: "gacru-hero__figure gacru-hero__figure--small" }, [amountText((-totalSpend).toFixed(2), fx.netPosition.currency, fx.prefs)]),
    segBar, segLegend,
  ]);
  const healthCard = gcard("Budget health", "target", [radialGauge(healthPct, `${healthPct}% of this month's planned budget already spent`), el("p", { class: "muted small", text: `${formatAmount(spentTotal.toFixed(2), fx.budget.currency)} of ${formatAmount(plannedTotal.toFixed(2), fx.budget.currency)} planned` })]);
  const progressCard = gcard("Budget progress", "chart-pie", el("ul", { class: "stack" }, fx.budget.lines.map((l) => {
    const c = cat(l.category);
    const pct = Math.max(0, Math.min(100, Math.round((Number(l.spent) / Number(l.planned)) * 100)));
    return el("li", { class: "gacru-progrow" }, [
      categoryLabel(c.name, c.color, c.icon),
      el("div", { class: "gmeter", role: "img", "aria-label": `${pct}% of ${c.name}'s budget used` }, [el("div", { class: "gmeter__fill", vars: { "--pct": `${pct}%` } })]),
      el("span", { class: "muted small", text: `${formatAmount(l.spent, fx.budget.currency)} / ${formatAmount(l.planned, fx.budget.currency)}` }),
    ]);
  })));

  return [
    header,
    el("div", { class: "gacru-grid" }, [
      el("div", { class: "gacru-main" }, [
        heroCard, statRail,
        el("div", { class: "gacru-lower" }, [spendingCard, healthCard, progressCard]),
      ]),
      el("div", { class: "gacru-side" }, [accountsCard, billsCard, txCard]),
    ]),
  ];
}

// BT-013-10 (Terry, 2026-09-20): a BESPOKE Dashboard composition for `ledgerfly-forecast`, built
// closely against the real Ledgerfly reference image (`.local/refcheck/r05.png`, extracted from
// docs/BudgetTracker-references.html) — its whole Executive Overview page composition, not one
// borrowed element. Deliberately NOT assembled from the shared hero vocabulary above: a compact
// header, a four-card KPI strip with one deliberately emphasised card, a dominant filled forecast
// chart, a right-hand column of real breakdowns, and a scenario panel stating the workspace's own
// already-real Expected/Cautious/Hopeful forecast figures (`fx.forecast`, the same figures other
// concepts already use — never a second invented forecast, and never a fake "run simulation" control
// this Gallery cannot actually execute). Reuses shared PRIMITIVES (money, amountText, categoryLabel,
// figureTable, the new `forecastTrendChart`) and the real canonical fixtures throughout.
// BT-013-15 (2026-09-20): extracted from the Dashboard's own KPI strip so EVERY Ledgerfly page can
// open with the same "restrained header, strong KPI strip" identity Terry asked to be carried through
// every page, not only the Dashboard — the exact same markup/CSS the anchor page already established
// and was already reviewed, never a second lookalike.
function ledgerflyKpiStrip(kpis) {
  return el("div", { class: "gledgerfly-kpis" }, kpis.map((k) => el("div", { class: ["gledgerfly-kpi", k.emphasize ? "gledgerfly-kpi--emphasis" : ""] }, [
    el("p", { class: "gledgerfly-kpi__label", text: k.label }),
    el("p", { class: "gledgerfly-kpi__value" }, [k.value]),
    el("p", { class: "gledgerfly-kpi__meta muted small", text: k.meta }),
  ])));
}
function heroReferenceLedgerfly() {
  const incomeTotal = fx.transactions.filter((t) => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const expenseTotal = fx.transactions.filter((t) => Number(t.amount) < 0).reduce((s, t) => s - Number(t.amount), 0);
  const netFlow = incomeTotal - expenseTotal;
  const totalCash = Number(fx.netPosition.amount);
  const runwayMonths = expenseTotal > 0 ? (totalCash / expenseTotal).toFixed(1) : "—";

  const kpiStrip = ledgerflyKpiStrip([
    { label: "Total balance", value: money(fx.netPosition.amount, fx.netPosition.currency, fx.prefs), meta: "Across every account you can see", emphasize: true },
    { label: "Monthly spending", value: amountText((-expenseTotal).toFixed(2), fx.netPosition.currency, fx.prefs), meta: "This period" },
    { label: "Runway", value: el("span", { text: `${runwayMonths} months` }), meta: "Balance ÷ this period's spending" },
    { label: "Net monthly flow", value: amountText(netFlow.toFixed(2), fx.netPosition.currency, fx.prefs), meta: "Income minus spending" },
  ]);

  const series = [{ key: "expected", dash: "solid" }, { key: "cautious", dash: "dashed" }, { key: "hopeful", dash: "dotted" }];
  const forecastCard = gcard("Cash forecast", "chart-line", [
    forecastTrendChart(fx.forecast.points, series),
    figureTable(fx.forecast.points.map((p) => [p.date, p.expected, p.cautious, p.hopeful]), "Cash forecast, next 30 days", ["Date", "Expected", "Cautious", "Hopeful"]),
    el("p", { class: "gchart__legend" }, [
      el("span", { class: "gchart__key gchart__key--solid" }), "Expected  ",
      el("span", { class: "gchart__key gchart__key--dashed" }), "Cautious  ",
      el("span", { class: "gchart__key gchart__key--dotted" }), "Hopeful",
    ]),
  ], { full: true });

  const spendByCat = new Map();
  let totalSpend = 0;
  for (const t of fx.transactions) {
    if (Number(t.amount) >= 0 || !t.category) continue;
    const v = -Number(t.amount);
    spendByCat.set(t.category, (spendByCat.get(t.category) || 0) + v);
    totalSpend += v;
  }
  const spendRows = [...spendByCat.entries()].map(([id, v]) => ({ cat: cat(id), amount: v, pct: Math.round((v / totalSpend) * 100) })).sort((a, b) => b.amount - a.amount);
  const breakdownCard = gcard("Spending breakdown", "chart-pie", el("ul", { class: "stack" }, spendRows.map((s) => el("li", { class: "gledgerfly-breakdown__row" }, [
    categoryLabel(s.cat.name, s.cat.color, s.cat.icon),
    el("div", { class: "gmeter", role: "img", "aria-label": `${s.pct}% of spending was ${s.cat.name}` }, [el("div", { class: "gmeter__fill", vars: { "--pct": `${s.pct}%` } })]),
    el("span", { class: "muted small", text: `${s.pct}% · ${formatAmount(s.amount.toFixed(2), fx.netPosition.currency)}` }),
  ]))));

  const spendByMerchant = new Map();
  for (const t of fx.transactions) {
    if (Number(t.amount) >= 0 || !t.payee) continue;
    spendByMerchant.set(t.payee, (spendByMerchant.get(t.payee) || 0) + -Number(t.amount));
  }
  const topMerchants = [...spendByMerchant.entries()].map(([id, v]) => ({ m: merchant(id), amount: v })).sort((a, b) => b.amount - a.amount).slice(0, 2);
  const driversCard = gcard("Primary cost drivers", "store", el("ul", { class: "stack" }, topMerchants.map((d) => el("li", { class: "grow" }, [
    withIcon(d.m.icon, d.m.name), el("span", { class: "app__spacer" }), amountText((-d.amount).toFixed(2), fx.netPosition.currency, fx.prefs),
  ]))));

  // The reference's own "Run Simulation" scenario panel is deliberately NOT reproduced as a fake
  // interactive control — this Gallery never calls a live API and has no real simulation to run.
  // Instead, the panel states the workspace's own ALREADY-REAL Expected/Cautious/Hopeful 30-day
  // forecast figures (the same ones `forecastCard` above already charts), honestly labelled.
  const lastPoint = fx.forecast.points[fx.forecast.points.length - 1];
  const scenarioCard = gcard("Scenario planning", "chart-line", [
    el("p", { class: "muted small", text: `Net position by ${lastPoint.date}, across three real planning scenarios already used throughout this Gallery:` }),
    el("ul", { class: "stack" }, [
      el("li", { class: "grow" }, [el("span", { text: "Expected" }), el("span", { class: "app__spacer" }), amountText(lastPoint.expected, fx.netPosition.currency, fx.prefs)]),
      el("li", { class: "grow" }, [el("span", { text: "Cautious" }), el("span", { class: "app__spacer" }), amountText(lastPoint.cautious, fx.netPosition.currency, fx.prefs)]),
      el("li", { class: "grow" }, [el("span", { text: "Hopeful" }), el("span", { class: "app__spacer" }), amountText(lastPoint.hopeful, fx.netPosition.currency, fx.prefs)]),
    ]),
  ]);
  const biggestBill = [...fx.bills].filter((b) => b.kind !== "income").sort((a, b) => Number(b.amount) - Number(a.amount))[0];
  const obligationCard = gcard("Largest upcoming obligation", "calendar", [
    withIcon(biggestBill.icon, biggestBill.name),
    el("p", { class: "muted small", text: `Due ${biggestBill.dueDate}` }),
    el("p", { class: "gledgerfly-obligation__amount" }, [amountText(`-${biggestBill.amount}`, biggestBill.currency, fx.prefs)]),
    badge(BILL_STATUS_LABEL[biggestBill.status], biggestBill.status === "overdue" ? "danger" : biggestBill.status === "due-soon" ? "warning" : ""),
  ]);

  return [
    kpiStrip,
    el("div", { class: "gledgerfly-grid" }, [
      el("div", { class: "gledgerfly-main" }, [forecastCard]),
      el("div", { class: "gledgerfly-side" }, [breakdownCard, driversCard]),
    ]),
    el("div", { class: "gledgerfly-lower" }, [scenarioCard, obligationCard]),
  ];
}

// BT-013-11 (2026-09-20): a BESPOKE Dashboard composition for `goal-navigator`, built closely against
// a real debt-payoff app's own "Payoff Plan" screen (`.local/refcheck/r06.png`, extracted from
// docs/BudgetTracker-references.html) — replacing the earlier generic `goal-progress` template with
// one built for this exact page. A "payments until debt-free" hero stat with a projected freedom
// date, a two-node journey visual, a real payment-order list, and two circular payoff-percentage
// gauges (radialGauge — the same primitive `goal-progress` already used, keeping this concept the sole
// `chartEmphasis: 'donut'` holder, per api/test/layouts.test.js's own exact check). Every number is
// either real (both debts' own current balances, from `fx.accounts`) or a clearly disclosed
// illustrative assumption (an "original balance" anchor for each debt's own % paid off, and a steady
// monthly payment used only to project the payoff date) — never presented as a guarantee.
function addMonthsLabel(dateStr, months) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
function heroReferenceDebtpayoff() {
  const loan = account("acc-loan");
  const card = account("acc-card");
  const loanBalance = Math.abs(Number(loan.balance));
  const cardBalance = Math.abs(Number(card.balance));
  // Illustrative "original balance" anchors, disclosed plainly — never presented as measured fact.
  const loanOriginal = 15000;
  const cardOriginal = 1200;
  const loanPct = Math.max(0, Math.min(100, Math.round(((loanOriginal - loanBalance) / loanOriginal) * 100)));
  const cardPct = Math.max(0, Math.min(100, Math.round(((cardOriginal - cardBalance) / cardOriginal) * 100)));
  const combinedBalance = loanBalance + cardBalance;
  const assumedMonthlyPayment = 200;
  const paymentsLeft = Math.ceil(combinedBalance / assumedMonthlyPayment);
  const latest = [...fx.transactions].sort((a, b) => (a.date > b.date ? -1 : 1))[0];
  const freedomLabel = addMonthsLabel(latest.date, paymentsLeft);

  const hero = gcard("Payoff plan", "target", [
    el("div", { class: "gpayoff-hero" }, [
      el("div", {}, [
        el("p", { class: "gpayoff-hero__figure" }, [el("span", { text: String(paymentsLeft) }), " payments until debt-free"]),
        el("p", { class: "muted small", text: `Assumes a steady ${formatAmount(assumedMonthlyPayment.toFixed(2), fx.netPosition.currency)}/month payment across both debts (illustrative).` }),
      ]),
      el("div", { class: "gpayoff-hero__freedom" }, [
        el("p", { class: "muted small", text: "Freedom day" }),
        el("p", { class: "gpayoff-hero__freedomdate", text: freedomLabel }),
      ]),
    ]),
    el("div", { class: "gpayoff-stats" }, [
      metric("Payments left", String(paymentsLeft), null),
      metric("Freedom day", freedomLabel, null),
      metric("Debts", "2", null),
      metric("Total balance", money(combinedBalance.toFixed(2), fx.netPosition.currency, fx.prefs), null),
    ]),
  ], { full: true });

  const journey = gcard("Your journey to freedom", "chart-line", [
    el("div", { class: "gpayoff-journey" }, [
      el("div", { class: "gpayoff-journey__node gpayoff-journey__node--start" }, [el("span", { class: "gpayoff-journey__dot", "aria-hidden": "true" }), el("p", { class: "small", text: "Today" })]),
      el("div", { class: "gpayoff-journey__node" }, [el("span", { class: "gpayoff-journey__dot", "aria-hidden": "true" }), el("p", { class: "small" }, [withIcon(card.icon, card.name)]), el("p", { class: "muted small", text: "Cleared first" })]),
      el("div", { class: "gpayoff-journey__node gpayoff-journey__node--end" }, [el("span", { class: "gpayoff-journey__dot gpayoff-journey__dot--flag", "aria-hidden": "true" }, [icon("target")]), el("p", { class: "small", text: "Freedom!" }), el("p", { class: "muted small", text: freedomLabel })]),
    ]),
  ], { full: true });

  const rows = [
    { a: card, pct: cardPct, balance: cardBalance },
    { a: loan, pct: loanPct, balance: loanBalance },
  ];
  const paymentOrder = gcard("Payment order", "calendar", el("ul", { class: "stack" }, rows.map((r) => el("li", { class: "gpayoff-row" }, [
    withIcon(r.a.icon, r.a.name),
    el("div", { class: "gmeter", role: "img", "aria-label": `${r.pct}% of ${r.a.name}'s balance paid off` }, [el("div", { class: "gmeter__fill", vars: { "--pct": `${r.pct}%` } })]),
    el("span", { class: "muted small", text: `${r.pct}% paid — ${formatAmount(r.balance.toFixed(2), r.a.currency)} left` }),
  ]))), { full: true });

  const gauges = gcard("Payoff progress", "target", [
    el("div", { class: "gpayoff-gauges" }, [
      el("div", { class: "gpayoff-gauges__item" }, [radialGauge(loanPct, `${loanPct}% of ${loan.name}'s balance paid off`), el("p", { class: "small", text: loan.name })]),
      el("div", { class: "gpayoff-gauges__item" }, [radialGauge(cardPct, `${cardPct}% of ${card.name}'s balance paid off`), el("p", { class: "small", text: card.name })]),
    ]),
  ], { full: true });

  return [hero, journey, paymentOrder, gauges];
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
  "trip-focus": heroTripFocus,
  "story-flow": heroStoryFlow,
  adaptive: heroAdaptive,
  briefing: heroBriefing,
  inbox: heroInbox,
  "ring-cluster": heroRingCluster,
  mosaic: heroMosaic,
  "ledger-strip": heroLedgerStrip,
  "reference-acru": heroReferenceAcru,
  "reference-ledgerfly": heroReferenceLedgerfly,
  "reference-debtpayoff": heroReferenceDebtpayoff,
};

function renderDashboard(concept, onNavigate) {
  const fn = DASHBOARD_RENDERERS[concept.dashboardPattern] || heroMetricGrid;
  return el("div", { class: "gpage gpage--dashboard" }, [pageTitle("dashboard"), ...fn(concept, onNavigate)]);
}

// ---- the shared template for the other six required pages (real structural composition driven by
// the concept's own nav/density/card rules, never hand-duplicated per concept) ----------------------
function pageTitle(pageId, labelOverride) {
  return el("div", { class: "gpage__head" }, [el("h2", {}, [withIcon(PAGE_ICON[pageId], labelOverride || PAGE_LABEL[pageId])])]);
}

// ---- Transactions: five genuinely different compositions (review, 2026-09-18) ---------------------
// BT-013-13 (2026-09-20): a real summary row (entry count, total in, total out — all derived, never
// invented) shared by every remaining Transactions pattern, so each concept's own ledger page opens
// with real coordinated context instead of a bare list/table, matching the same standard the bespoke
// pages already hold themselves to. Each pattern keeps its own genuinely different body beneath it.
function txnSummaryRow() {
  const income = fx.transactions.filter((t) => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const expense = fx.transactions.filter((t) => Number(t.amount) < 0).reduce((s, t) => s - Number(t.amount), 0);
  return el("div", { class: "ggrid gpage-summary" }, [
    metric("Entries", String(fx.transactions.length), null),
    metric("Total in", amountText(income.toFixed(2), "EUR", fx.prefs), null),
    metric("Total out", amountText((-expense).toFixed(2), "EUR", fx.prefs), null),
  ]);
}
function txnFlatList() {
  return [txnSummaryRow(), gcard("All entries", "receipt", el("ul", { class: "stack" }, fx.transactions.map(txRow)), { full: true })];
}
function txnGroupedByDate() {
  const byDate = new Map();
  for (const t of fx.transactions) { if (!byDate.has(t.date)) byDate.set(t.date, []); byDate.get(t.date).push(t); }
  return [txnSummaryRow(), ...[...byDate.entries()].map(([date, rows]) => gcard(date, "calendar", el("ul", { class: "stack" }, rows.map(txRow)), { full: true }))];
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
  return [txnSummaryRow(), gcard("All entries", "receipt", el("div", { class: "table-wrap" }, [table]), { full: true })];
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
  return [txnSummaryRow(), gcard("All entries", "receipt", el("div", { class: "ggrid ggrid--cards" }, cards), { full: true })];
}
function txnFilterFirst() {
  const filters = gcard("Filters", "filter", el("ul", { class: "stack" }, ["Account: All", "Category: All", "Person: All", "Period: This month"].map((f) => el("li", { text: f }))));
  const list = gcard("Matching entries", "receipt", el("ul", { class: "stack" }, fx.transactions.map(txRow)));
  return [txnSummaryRow(), el("div", { class: "gsplit" }, [filters, list])];
}
// BT-013-11 (2026-09-20): a BESPOKE Transactions composition for `merchant-insights`, built closely
// against a real reference image (`.local/refcheck/r03.png`, extracted from
// docs/BudgetTracker-references.html) — a calm, complete ledger page, not one borrowed element.
// Deliberately NOT assembled from the shared transactionsPattern vocabulary above: a bold heading row
// with a real period label and three always-visible entry actions, and a clean table whose every row
// states a real, plain-language TYPE (Income/Expense/Transfer) as visible text beside its amount —
// never colour alone. Reuses shared PRIMITIVES (money, amountText, categoryLabel, withIcon, button)
// and the real canonical fixtures, never a second parallel data model.
function txnReferenceMonsy() {
  const latest = [...fx.transactions].sort((a, b) => (a.date > b.date ? -1 : 1))[0];
  const periodLabel = new Date(`${latest.date}T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const typeOf = (t) => (Number(t.amount) > 0 ? { label: "Income", cls: "income" } : t.category ? { label: "Expense", cls: "expense" } : { label: "Transfer", cls: "transfer" });

  const head = el("div", { class: "gmonsy-head" }, [
    el("div", {}, [
      el("h3", { class: "gmonsy-head__title", text: "All entries" }),
      el("p", { class: "muted small", text: "View every income, expense and transfer in one place." }),
    ]),
    el("p", { class: "gmonsy-period", text: periodLabel }),
  ]);
  const actions = el("div", { class: "gmonsy-actions" }, [
    el("span", { class: "gmonsy-actionbtn gmonsy-actionbtn--income" }, [button("+ Add income", () => {}, { small: true })]),
    el("span", { class: "gmonsy-actionbtn gmonsy-actionbtn--expense" }, [button("+ Add expense", () => {}, { small: true })]),
    el("span", { class: "gmonsy-actionbtn gmonsy-actionbtn--saving" }, [button("+ Add saving", () => {}, { small: true })]),
  ]);

  const rows = fx.transactions.map((t) => {
    const m = t.payee ? merchant(t.payee) : null;
    const c = t.category ? cat(t.category) : null;
    const a = account(t.account);
    const type = typeOf(t);
    return el("tr", {}, [
      el("td", { text: t.date }),
      el("td", {}, [el("span", { class: `badge gmonsy-type gmonsy-type--${type.cls}`, text: type.label })]),
      el("td", {}, [m ? withIcon(m.icon, m.name) : el("span", { text: t.label || "Transfer" }), c ? el("div", { class: "muted small" }, [categoryLabel(c.name, c.color, c.icon)]) : null]),
      el("td", { class: "muted small", text: a.name }),
      el("td", { class: "num" }, [amountText(t.amount, "EUR", fx.prefs)]),
    ]);
  });
  const table = el("table", { class: "table gtable-dense" }, [
    el("thead", {}, [el("tr", {}, ["Date", "Type", "Description", "Account", "Amount"].map((h) => el("th", { scope: "col", class: h === "Amount" ? "num" : "", text: h })))]),
    el("tbody", {}, rows),
  ]);

  return [head, actions, gcard("All entries", "receipt", el("div", { class: "table-wrap" }, [table]), { full: true })];
}

// BT-013-15 (2026-09-20): a BESPOKE Transactions composition for `ledgerfly-forecast`, carrying the
// SAME navy KPI-strip identity its Dashboard already established through every required page (Terry:
// "Carry that analytical clarity through every page — not just the dashboard"). Answers the page's own
// question (Terry's table): where did money come from or go this period — filter-aware totals and a
// meaningful trend above an excellent list, distinguishing transfers from spending, never colour alone.
function txnReferenceLedgerfly() {
  const incomeTotal = fx.transactions.filter((t) => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const expenseTotal = fx.transactions.filter((t) => Number(t.amount) < 0).reduce((s, t) => s - Number(t.amount), 0);
  const kpiStrip = ledgerflyKpiStrip([
    { label: "Total in", value: amountText(incomeTotal.toFixed(2), "EUR", fx.prefs), meta: "This period", emphasize: true },
    { label: "Total out", value: amountText((-expenseTotal).toFixed(2), "EUR", fx.prefs), meta: "This period" },
    { label: "Net", value: amountText((incomeTotal - expenseTotal).toFixed(2), "EUR", fx.prefs), meta: "In minus out" },
    { label: "Entries", value: el("span", { text: String(fx.transactions.length) }), meta: "This period" },
  ]);
  const byDate = new Map();
  for (const t of fx.transactions) byDate.set(t.date, (byDate.get(t.date) || 0) + Number(t.amount));
  const chartPoints = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, value]) => ({ date, value }));
  const trendCard = gcard("Daily net movement", "chart-line", [
    barChart(chartPoints, { width: 640, height: 140 }),
    figureTable(chartPoints.map((p) => [p.date, formatAmount(p.value.toFixed(2), "EUR")]), "Daily net movement", ["Date", "Net"]),
  ], { full: true });
  const typeOf = (t) => (Number(t.amount) > 0 ? { label: "Income", variant: "shared" } : t.category ? { label: "Spending", variant: "" } : { label: "Transfer", variant: "warning" });
  const rows = [...fx.transactions].sort((a, b) => (a.date > b.date ? -1 : 1)).map((t) => {
    const m = t.payee ? merchant(t.payee) : null;
    const c = t.category ? cat(t.category) : null;
    const type = typeOf(t);
    return el("tr", {}, [
      el("td", { class: "muted small", text: t.date }),
      el("td", {}, [m ? withIcon(m.icon, m.name) : el("span", { text: t.label || "Transfer" })]),
      el("td", {}, [c ? categoryLabel(c.name, c.color, c.icon) : el("span", { class: "muted small", text: "—" })]),
      el("td", {}, [badge(type.label, type.variant)]),
      el("td", { class: "num" }, [amountText(t.amount, "EUR", fx.prefs)]),
    ]);
  });
  const table = el("table", { class: "table gtable-dense" }, [
    el("thead", {}, [el("tr", {}, ["Date", "Description", "Category", "Type", "Amount"].map((h) => el("th", { scope: "col", class: h === "Amount" ? "num" : "", text: h })))]),
    el("tbody", {}, rows),
  ]);
  const listCard = gcard("All entries", "receipt", el("div", { class: "table-wrap" }, [table]), { full: true });
  return [kpiStrip, trendCard, listCard];
}
const TRANSACTIONS_RENDERERS = { "flat-list": txnFlatList, "grouped-by-date": txnGroupedByDate, "dense-table": txnDenseTable, "card-list": txnCardList, "filter-first": txnFilterFirst, "reference-monsy": txnReferenceMonsy, "reference-ledgerfly": txnReferenceLedgerfly };
function renderTransactions(concept) {
  const fn = TRANSACTIONS_RENDERERS[concept.transactionsPattern] || txnFlatList;
  return el("div", { class: "gpage gpage--list" }, [pageTitle("transactions"), ...fn()]);
}

// ---- Bills: four genuinely different compositions --------------------------------------------------
// BT-013-13 (2026-09-20): a real summary row (bills tracked, overdue/due-soon counts, total due —
// never invented) shared by every remaining Bills pattern, coordinating each concept's own Bills page
// with real context the same way its bespoke pages already do. Each pattern keeps its own body below.
function billsSummaryRow() {
  const overdue = fx.bills.filter((b) => b.status === "overdue").length;
  const dueSoon = fx.bills.filter((b) => b.status === "due-soon").length;
  const totalDue = fx.bills.filter((b) => b.kind !== "income").reduce((s, b) => s + Number(b.amount), 0);
  return el("div", { class: "ggrid gpage-summary" }, [
    metric("Bills tracked", String(fx.bills.length), null),
    metric("Overdue", String(overdue), null),
    metric("Due soon", String(dueSoon), null),
    metric("Total due", amountText(totalDue.toFixed(2), "EUR", fx.prefs), null),
  ]);
}
function billsGroupedStatus() {
  const groups = [["Overdue", "overdue"], ["Due soon", "due-soon"], ["Upcoming", "upcoming"]];
  return [billsSummaryRow(), ...groups.map(([label, status]) => {
    const rows = fx.bills.filter((b) => b.status === status);
    return rows.length ? gcard(label, "calendar", el("ul", { class: "stack" }, rows.map(billRow)), { full: true }) : null;
  })];
}
function billsTimeline() {
  const events = [...fx.bills].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  return [billsSummaryRow(), gcard("All bills, in order", "clock", el("ol", { class: "gtimeline" }, events.map((b) => el("li", { class: ["gtimeline__item", b.status === "overdue" ? "gtimeline__item--past" : "gtimeline__item--future"] }, [el("span", { class: "gtimeline__date muted small", text: b.dueDate }), billRow(b)]))), { full: true })];
}
function billsKanban() {
  const groups = [["Overdue", "overdue"], ["Due soon", "due-soon"], ["Upcoming", "upcoming"]];
  return [billsSummaryRow(), el("div", { class: "gkanban" }, groups.map(([label, status]) => gcard(label, "calendar", el("ul", { class: "stack" }, fx.bills.filter((b) => b.status === status).map(billRow)))))];
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
  return [billsSummaryRow(), gcard("All bills", "calendar", el("div", { class: "table-wrap" }, [table]), { full: true })];
}
// BT-013-15: Bills answers "what is due, when, how much must I fund" (Terry's table) — a navy KPI
// strip (overdue/due-soon/upcoming totals) above a real payment timeline, with a plainly labelled
// needs-attention list (never a dead "Record payment" button this Gallery cannot actually act on).
function billsReferenceLedgerfly() {
  const real = fx.bills.filter((b) => b.kind !== "income");
  const overdue = real.filter((b) => b.status === "overdue");
  const dueSoon = real.filter((b) => b.status === "due-soon");
  const upcoming = real.filter((b) => b.status === "upcoming");
  const sum = (list) => list.reduce((s, b) => s + Number(b.amount), 0);
  const kpiStrip = ledgerflyKpiStrip([
    { label: "Overdue", value: amountText((-sum(overdue)).toFixed(2), "EUR", fx.prefs), meta: `${overdue.length} bill${overdue.length === 1 ? "" : "s"}`, emphasize: overdue.length > 0 },
    { label: "Due soon", value: amountText((-sum(dueSoon)).toFixed(2), "EUR", fx.prefs), meta: `${dueSoon.length} bill${dueSoon.length === 1 ? "" : "s"}` },
    { label: "Upcoming", value: amountText((-sum(upcoming)).toFixed(2), "EUR", fx.prefs), meta: `${upcoming.length} bill${upcoming.length === 1 ? "" : "s"}` },
    { label: "Total due", value: amountText((-sum(real)).toFixed(2), "EUR", fx.prefs), meta: "Overdue + due soon + upcoming" },
  ]);
  const ordered = [...fx.bills].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const timeline = gcard("Payment timeline", "calendar", el("ol", { class: "gtimeline" }, ordered.map((b) => el("li", { class: ["gtimeline__item", b.status === "overdue" ? "gtimeline__item--past" : "gtimeline__item--future"] }, [
    el("span", { class: "gtimeline__date muted small", text: b.dueDate }),
    withIcon(b.icon, b.name),
    badge(BILL_STATUS_LABEL[b.status] || b.status, b.status === "overdue" ? "danger" : b.status === "due-soon" ? "warning" : ""),
    el("span", { class: "app__spacer" }),
    amountText(b.kind === "income" ? b.amount : `-${b.amount}`, b.currency, fx.prefs),
  ]))), { full: true });
  const needsAttention = [...overdue, ...dueSoon];
  const actions = gcard("Needs attention", "bell", needsAttention.length
    ? el("ul", { class: "stack" }, needsAttention.map((b) => el("li", { class: "grow" }, [withIcon(b.icon, b.name), el("span", { class: "muted small", text: `Due ${b.dueDate}` }), el("span", { class: "app__spacer" }), badge(b.status === "overdue" ? "Overdue — record or skip" : "Due soon", b.status === "overdue" ? "danger" : "warning")])))
    : el("p", { class: "muted small", text: "Nothing needs attention right now." }), { full: true });
  return [kpiStrip, timeline, actions];
}
const BILLS_RENDERERS = { "grouped-status": billsGroupedStatus, timeline: billsTimeline, "kanban-columns": billsKanban, "compact-table": billsCompactTable, "reference-ledgerfly": billsReferenceLedgerfly };
function renderBills(concept) {
  const fn = BILLS_RENDERERS[concept.billsPattern] || billsGroupedStatus;
  return el("div", { class: "gpage gpage--list" }, [pageTitle("bills"), ...fn()]);
}

// ---- Budget: three genuinely different compositions --------------------------------------------------
// BT-013-13 (2026-09-20): a real summary row (total planned/spent/available — never invented) shared
// by every remaining Budget pattern, coordinating each concept's own Budget page with real context.
function budgetSummaryRow() {
  const planned = fx.budget.lines.reduce((s, l) => s + Number(l.planned), 0);
  const spent = fx.budget.lines.reduce((s, l) => s + Number(l.spent), 0);
  return el("div", { class: "ggrid gpage-summary" }, [
    metric("Total planned", formatAmount(planned.toFixed(2), fx.budget.currency), null),
    metric("Total spent", formatAmount(spent.toFixed(2), fx.budget.currency), null),
    metric("Available", formatAmount((planned - spent).toFixed(2), fx.budget.currency), null),
  ]);
}
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
  return [budgetSummaryRow(), gcard("Planned vs spent, by category", "chart-line", el("div", { class: "stack" }, rows), { full: true })];
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
  return [budgetSummaryRow(), gcard("Budget lines", "target", el("div", { class: "table-wrap" }, [table]), { full: true })];
}
// BT-013-10 (Terry, 2026-09-20): a BESPOKE Budget-page composition for `finexa-budget`, built closely
// against the real Finexa reference image (`.local/refcheck/r02.png`, extracted from
// docs/BudgetTracker-references.html) — its whole Budgets page composition, not one borrowed element.
// Deliberately NOT assembled from the shared budgetPattern vocabulary above: a bold title/subtitle/
// primary-action row, a large planned-vs-spent utilization chart paired with a real upcoming-bills
// summary (replacing the reference's own SaaS-subscription tracking with real BudgetTracker bill
// data — there is no "recurring payments" feature to invent one for), and four category cards each
// with a genuinely different chart type, reusing shared PRIMITIVES (money, amountText, categoryLabel,
// badge, figureTable, barChart, areaChart, radialGauge and the two new ones above) and the real
// canonical `fx.budget.lines` — never a second parallel data model or an invented number.
function budgetReferenceFinexa() {
  const lines = fx.budget.lines.map((l) => {
    const c = cat(l.category);
    const planned = Number(l.planned);
    const spent = Number(l.spent);
    const pct = Math.round((spent / planned) * 100);
    const remaining = Number(l.available);
    const status = pct >= 95 ? { label: "Critical", variant: "danger" }
      : pct >= 80 ? { label: "Almost reached", variant: "warning" }
      : pct >= 50 ? { label: "On track", variant: "" }
      : { label: "Healthy", variant: "shared" };
    return { c, planned, spent, pct, remaining, status };
  });
  const highlightIndex = lines.reduce((best, l, i) => (l.pct > lines[best].pct ? i : best), 0);

  const subhead = el("div", { class: "gfinexa-head" }, [
    el("p", { class: "muted small", text: "Plan, track and control your spending limits with ease." }),
    button("+ Add budget line", () => {}, { variant: "primary", small: true }),
  ]);

  const utilCard = gcard("Budget utilization", "chart-line", [
    el("p", { class: "gchart__legend" }, [
      el("span", { class: "gchart__key gfinexa-key--planned" }), "Planned  ",
      el("span", { class: "gchart__key gfinexa-key--spent" }), "Spent",
    ]),
    dualBarChart(lines, highlightIndex),
    figureTable(lines.map((l) => [l.c.name, formatAmount(l.planned.toFixed(2), fx.budget.currency), formatAmount(l.spent.toFixed(2), fx.budget.currency)]), "Planned versus spent, by category", ["Category", "Planned", "Spent"]),
  ], { full: true });

  const statusGroups = [["overdue", "Overdue"], ["due-soon", "Due soon"], ["upcoming", "Upcoming"]]
    .map(([key, label]) => ({ label, rows: fx.bills.filter((b) => b.status === key) }))
    .filter((g) => g.rows.length);
  const billsTotal = fx.bills.filter((b) => b.kind !== "income").reduce((s, b) => s + Number(b.amount), 0);
  const attentionPct = Math.round((fx.bills.filter((b) => b.status !== "upcoming").length / fx.bills.length) * 100);
  const recurringCard = gcard("Upcoming bills", "calendar", [
    el("div", { class: "gfinexa-recurring__top" }, [
      metric("Bills tracked", String(fx.bills.length), null),
      metric("Monthly total", amountText(billsTotal.toFixed(2), fx.budget.currency, fx.prefs), null),
    ]),
    el("p", { class: "small", text: "Needing attention" }),
    el("div", { class: "gmeter", role: "img", "aria-label": `${attentionPct}% of bills are due soon or overdue` }, [el("div", { class: "gmeter__fill", vars: { "--pct": `${attentionPct}%` } })]),
    el("ul", { class: "stack" }, statusGroups.map((g) => el("li", { class: "grow" }, [
      el("span", { text: `${g.label} (${g.rows.length})` }), el("span", { class: "app__spacer" }),
      amountText(g.rows.filter((b) => b.kind !== "income").reduce((s, b) => s + Number(b.amount), 0).toFixed(2), fx.budget.currency, fx.prefs),
    ]))),
  ]);

  const chartFor = (i, l) => {
    if (i === 0) return barChart([{ value: l.planned }, { value: l.spent }], { width: 160, height: 70 });
    if (i === 1) return areaChart([{ v: l.planned }, { v: l.spent }], [{ key: "v", dash: "solid" }], { width: 160, height: 70 });
    if (i === 2) return radialGauge(Math.min(100, l.pct), `${Math.min(100, l.pct)}% of ${l.c.name}'s budget used`, { size: 76, stroke: 9 });
    return pieDial(l.pct, { size: 76 });
  };
  const categoryCards = lines.slice(0, 4).map((l, i) => gcard(l.c.name, l.c.icon, [
    el("p", { class: "muted small", text: `Total budget: ${formatAmount(l.planned.toFixed(2), fx.budget.currency)}` }),
    el("div", { class: "gfinexa-card__top" }, [
      el("div", {}, [
        el("p", { class: "gfinexa-card__amount" }, [money(l.spent.toFixed(2), fx.budget.currency, fx.prefs)]),
        el("p", { class: "muted small", text: "Spent" }),
      ]),
      el("div", { class: "gfinexa-card__pct" }, [
        el("p", { class: "gfinexa-card__pctvalue", text: `${l.pct}%` }),
        el("p", { class: "muted small", text: "Utilization" }),
      ]),
    ]),
    chartFor(i, l),
    el("div", { class: "gfinexa-card__bottom" }, [
      el("span", { class: "small", text: `Remaining: ${formatAmount(Math.abs(l.remaining).toFixed(2), fx.budget.currency)}` }),
      badge(l.status.label, l.status.variant),
    ]),
  ]));

  return [subhead, el("div", { class: "gfinexa-top" }, [utilCard, recurringCard]), el("div", { class: "gfinexa-cards" }, categoryCards)];
}

// BT-013-15: Budget answers "what remains, and where am I overspending" — a navy KPI strip (planned/
// spent/remaining/over-budget count) above a real planned-vs-spent comparison chart and a category
// breakdown with clear warnings, never colour alone.
function budgetReferenceLedgerfly() {
  const plannedTotal = fx.budget.lines.reduce((s, l) => s + Number(l.planned), 0);
  const spentTotal = fx.budget.lines.reduce((s, l) => s + Number(l.spent), 0);
  const overLines = fx.budget.lines.filter((l) => Number(l.available) < 0);
  const kpiStrip = ledgerflyKpiStrip([
    { label: "Planned", value: money(plannedTotal.toFixed(2), "EUR", fx.prefs), meta: "This month", emphasize: true },
    { label: "Spent", value: amountText((-spentTotal).toFixed(2), "EUR", fx.prefs), meta: "This month" },
    { label: "Remaining", value: amountText((plannedTotal - spentTotal).toFixed(2), "EUR", fx.prefs), meta: "Planned minus spent" },
    { label: "Over budget", value: el("span", { text: String(overLines.length) }), meta: overLines.length ? "categories need attention" : "nothing over" },
  ]);
  const lines = fx.budget.lines.map((l) => ({ c: cat(l.category), planned: Number(l.planned), spent: Number(l.spent) }));
  const worst = lines.reduce((best, l, i) => (l.spent / l.planned > lines[best].spent / lines[best].planned ? i : best), 0);
  const chart = gcard("Planned vs. spent", "chart-line", [
    dualBarChart(lines, worst),
    el("p", { class: "gchart__legend" }, [el("span", { class: "gchart__key gfinexa-key--planned" }), "Planned  ", el("span", { class: "gchart__key gfinexa-key--spent" }), "Spent"]),
    figureTable(lines.map((l) => [l.c.name, l.planned.toFixed(2), l.spent.toFixed(2)]), "Planned versus spent, by category", ["Category", "Planned", "Spent"]),
  ], { full: true });
  const rows = fx.budget.lines.map((l) => {
    const c = cat(l.category);
    const over = Number(l.available) < 0;
    const pct = Math.round((Number(l.spent) / Number(l.planned)) * 100);
    return el("li", { class: "gledgerfly-breakdown__row" }, [
      categoryLabel(c.name, c.color, c.icon),
      el("div", { class: "gmeter", role: "img", "aria-label": `${pct}% of ${c.name}'s budget used` }, [el("div", { class: "gmeter__fill", vars: { "--pct": `${Math.min(100, pct)}%` } })]),
      el("span", { class: "muted small", text: `${pct}%` }),
      over ? badge(`Over by ${formatAmount(Math.abs(Number(l.available)).toFixed(2), "EUR")}`, "danger") : el("span", { class: "muted small", text: `${formatAmount(l.available, "EUR")} left` }),
    ]);
  });
  const breakdown = gcard("Category detail", "chart-pie", el("ul", { class: "stack" }, rows), { full: true });
  return [kpiStrip, chart, breakdown];
}
const BUDGET_RENDERERS = { "envelope-grid": heroEnvelopeGrid, "bar-comparison": budgetBarComparison, "list-progress": budgetListProgress, "reference-finexa": budgetReferenceFinexa, "reference-ledgerfly": budgetReferenceLedgerfly };
function renderBudget(concept) {
  const fn = BUDGET_RENDERERS[concept.budgetPattern] || heroEnvelopeGrid;
  return el("div", { class: "gpage gpage--list" }, [pageTitle("budget"), ...fn()]);
}

// ---- Accounts / Merchants: a page the Gallery was missing entirely (review, 2026-09-18 — the
// design brief names "Accounts/Merchants" as one of the required coordinated views per concept).
// Three genuinely different compositions, each pairing the account list with the managed merchant
// directory, since real BudgetTracker keeps both on view together (app/js/ui/views/accounts.js and
// payees.js are separate pages, but every concept's OWN Accounts view choice is asked to cover both). --
// BT-013-13 (2026-09-20): a real summary row (account count, total balance — never invented) shared by
// every Accounts pattern, coordinating each concept's own Accounts/Merchants page with real context.
function accountsSummaryRow() {
  const total = fx.accounts.reduce((s, a) => s + Number(a.balance), 0);
  return el("div", { class: "ggrid gpage-summary" }, [
    metric("Accounts", String(fx.accounts.length), null),
    metric("Total balance", money(total.toFixed(2), "EUR", fx.prefs), null),
    metric("Merchants tracked", String(fx.merchants.length), null),
  ]);
}
function accountsCardGrid() {
  const cards = fx.accounts.map((a) => el("div", { class: "gminicard" }, [
    withIcon(a.icon, a.name),
    el("div", { class: "gminicard__amount" }, [money(a.balance, a.currency, fx.prefs)]),
    el("div", { class: "muted small", text: a.access === "shared" ? "Shared with workspace" : "Private · yours" }),
  ]));
  const merchantChips = fx.merchants.map((m) => el("span", { class: "badge" }, [withIcon(m.icon, m.name)]));
  return [
    accountsSummaryRow(),
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
    accountsSummaryRow(),
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
  return [accountsSummaryRow(), ...groups, gcard("Merchants", "store", el("div", { class: "row" }, merchantChips), { full: true })];
}
// BT-013-15: for `ledgerfly-forecast`, Merchants is its OWN required page (extraPages) — this page
// focuses purely on "where is my money and what do I owe" (Terry's table): asset/liability grouping,
// balances, recent activity. Never equates a credit limit with available cash (a plain sentence beside
// any credit-type liability, matching the existing invariant this Gallery already holds elsewhere).
function accountsReferenceLedgerfly() {
  const assets = fx.accounts.filter((a) => Number(a.balance) >= 0);
  const liabilities = fx.accounts.filter((a) => Number(a.balance) < 0);
  const totalAssets = assets.reduce((s, a) => s + Number(a.balance), 0);
  const totalLiabilities = liabilities.reduce((s, a) => s + Math.abs(Number(a.balance)), 0);
  const kpiStrip = ledgerflyKpiStrip([
    { label: "Net position", value: money(fx.netPosition.amount, fx.netPosition.currency, fx.prefs), meta: "Assets minus liabilities", emphasize: true },
    { label: "Assets", value: money(totalAssets.toFixed(2), "EUR", fx.prefs), meta: `${assets.length} account${assets.length === 1 ? "" : "s"}` },
    { label: "Liabilities", value: amountText((-totalLiabilities).toFixed(2), "EUR", fx.prefs), meta: `${liabilities.length} account${liabilities.length === 1 ? "" : "s"}` },
    { label: "Accounts", value: el("span", { text: String(fx.accounts.length) }), meta: "Total tracked" },
  ]);
  const groups = el("div", { class: "gwealth-split" }, [
    gcard("Assets", "bank", assets.length ? assets.map((a) => el("div", { class: "row" }, [withIcon(a.icon, a.name), el("span", { class: "app__spacer" }), money(a.balance, a.currency, fx.prefs)])) : el("p", { class: "muted small", text: "No asset accounts." })),
    gcard("What you owe", "loan", liabilities.map((a) => el("div", { class: "stack" }, [
      el("div", { class: "row" }, [withIcon(a.icon, a.name), el("span", { class: "app__spacer" }), amountText(a.balance, a.currency, fx.prefs)]),
      a.type === "credit-card" ? el("p", { class: "muted small", text: "A credit limit is never counted as available cash — only the balance above is owed." }) : null,
    ]))),
  ]);
  const activity = gcard("Recent activity", "receipt", el("ul", { class: "stack" }, fx.transactions.slice(0, 6).map(txRow)), { full: true });
  return [kpiStrip, groups, activity];
}
const ACCOUNTS_RENDERERS = { "card-grid": accountsCardGrid, table: accountsTable, "grouped-by-type": accountsGroupedByType, "reference-ledgerfly": accountsReferenceLedgerfly };
function renderAccounts(concept) {
  const fn = ACCOUNTS_RENDERERS[concept.accountsPattern] || accountsCardGrid;
  const hasOwnMerchants = (concept.extraPages || []).includes("merchants");
  return el("div", { class: "gpage gpage--list" }, [pageTitle("accounts", hasOwnMerchants ? "Accounts" : null), ...fn()]);
}

// BT-013-15: Merchants as its OWN page (extraPages), for concepts whose accounts page above no longer
// folds it in. Answers "who am I spending with, how is that changing" (Terry's table): ranked spend,
// frequency and a trend, from the managed merchant directory — never free text.
function merchantsReferenceLedgerfly() {
  const spendByMerchant = new Map();
  const countByMerchant = new Map();
  for (const t of fx.transactions) {
    if (Number(t.amount) >= 0 || !t.payee) continue;
    spendByMerchant.set(t.payee, (spendByMerchant.get(t.payee) || 0) + -Number(t.amount));
    countByMerchant.set(t.payee, (countByMerchant.get(t.payee) || 0) + 1);
  }
  const ranked = fx.merchants.map((m) => ({ m, spend: spendByMerchant.get(m.id) || 0, count: countByMerchant.get(m.id) || 0 })).sort((a, b) => b.spend - a.spend);
  const totalSpend = ranked.reduce((s, r) => s + r.spend, 0);
  const kpiStrip = ledgerflyKpiStrip([
    { label: "Merchants tracked", value: el("span", { text: String(fx.merchants.length) }), meta: "In the managed directory", emphasize: true },
    { label: "Total spend", value: amountText((-totalSpend).toFixed(2), "EUR", fx.prefs), meta: "Across every merchant" },
    { label: "Top merchant", value: el("span", { text: ranked[0] ? ranked[0].m.name : "—" }), meta: ranked[0] ? formatAmount(ranked[0].spend.toFixed(2), "EUR") : "No spend yet" },
    { label: "Entries with a merchant", value: el("span", { text: String(fx.transactions.filter((t) => t.payee).length) }), meta: "This period" },
  ]);
  const chart = gcard("Spend by merchant", "chart-pie", [
    barChart(ranked.map((r) => ({ value: r.spend })), { width: 520, height: 140 }),
    figureTable(ranked.map((r) => [r.m.name, r.spend.toFixed(2)]), "Spend by merchant", ["Merchant", "Spend"]),
  ], { full: true });
  const rows = ranked.map((r) => el("li", { class: "grow" }, [
    withIcon(r.m.icon, r.m.name),
    el("span", { class: "muted small", text: `${r.count} ${r.count === 1 ? "entry" : "entries"}` }),
    el("span", { class: "app__spacer" }),
    amountText((-r.spend).toFixed(2), "EUR", fx.prefs),
  ]));
  const list = gcard("Merchants, ranked by spend", "store", el("ul", { class: "stack" }, rows), { full: true });
  return [kpiStrip, chart, list];
}
const MERCHANTS_RENDERERS = { "reference-ledgerfly": merchantsReferenceLedgerfly };
function renderMerchants(concept) {
  const fn = MERCHANTS_RENDERERS[concept.merchantsPattern];
  return el("div", { class: "gpage gpage--list" }, [pageTitle("merchants"), ...(fn ? fn() : [el("p", { class: "muted", text: "Merchants is not built for this concept yet." })])]);
}

// BT-013-15: Debt/loan detail as its OWN page (extraPages). Answers "what remains to repay, and what
// changed the balance" (Terry's table): balance movement, principal/interest, payment history and
// supported payoff information with EXPLICIT assumptions — reusing the same illustrative original-
// balance anchor `goal-navigator`'s own Dashboard already uses for this exact account, never a second,
// disagreeing invented figure.
function debtReferenceLedgerfly() {
  const loan = account("acc-loan");
  const detail = fx.debtDetail["acc-loan"];
  const balance = Math.abs(Number(loan.balance));
  const original = Number(detail.originalBalance);
  const paidOff = original - balance;
  const pct = Math.max(0, Math.min(100, Math.round((paidOff / original) * 100)));
  const kpiStrip = ledgerflyKpiStrip([
    { label: "Current balance", value: money(loan.balance, loan.currency, fx.prefs), meta: loan.name, emphasize: true },
    { label: "Paid off", value: el("span", { text: `${pct}%` }), meta: `${formatAmount(paidOff.toFixed(2), loan.currency)} of ${formatAmount(original.toFixed(2), loan.currency)}` },
    { label: "APR (illustrative)", value: el("span", { text: `${detail.apr}%` }), meta: "Assumed for this projection" },
    { label: "Minimum payment", value: money(detail.minimumPayment, loan.currency, fx.prefs), meta: "Per month" },
  ]);
  const progress = gcard("Balance movement", "chart-line", [
    el("div", { class: "gmeter", role: "img", "aria-label": `${pct}% of the original balance paid off` }, [el("div", { class: "gmeter__fill", vars: { "--pct": `${pct}%` } })]),
    el("p", { class: "muted small", text: `Opened ${detail.openedDate}. Original balance ${formatAmount(original.toFixed(2), loan.currency)} is an illustrative anchor, the same one this Gallery's debt-payoff concept already uses for this account — never a second, disagreeing figure.` }),
  ], { full: true });
  const rows = detail.payments.map((p) => el("tr", {}, [
    el("td", { text: p.date }), el("td", { class: "num" }, [money(p.amount, loan.currency, fx.prefs)]),
    el("td", { class: "num" }, [money(p.principal, loan.currency, fx.prefs)]), el("td", { class: "num" }, [money(p.interest, loan.currency, fx.prefs)]),
  ]));
  const table = el("table", { class: "table gtable-dense" }, [
    el("thead", {}, [el("tr", {}, ["Date", "Payment", "Principal", "Interest"].map((h, i) => el("th", { scope: "col", class: i ? "num" : "", text: h })))]),
    el("tbody", {}, rows),
  ]);
  const history = gcard("Payment history (illustrative)", "calendar", el("div", { class: "table-wrap" }, [table]), { full: true });
  return [kpiStrip, progress, history];
}
const DEBT_RENDERERS = { "reference-ledgerfly": debtReferenceLedgerfly };
function renderDebt(concept) {
  const fn = DEBT_RENDERERS[concept.debtPattern];
  return el("div", { class: "gpage gpage--list" }, [pageTitle("debt"), ...(fn ? fn() : [el("p", { class: "muted", text: "Debt/loan detail is not built for this concept yet." })])]);
}

// ---- Shared expenses: three genuinely different compositions (closing the gap the review's own
// "not done" note named — this and Trips were the last two required pages still sharing one
// template across all 15 concepts), plus (review, 2026-09-19) a real EVENT DIRECTORY reflecting the
// now-real BT-009-20 model shipped in the application itself: named events with a real lifecycle
// status, and choosing one narrows "Recent shared expenses" to that event's own — genuinely
// interactive (a click re-renders this page's own container, `mount`, exactly like every other real
// BudgetTracker page), never a live API call. Balances stay combined regardless of the scoped event:
// this fixture has no full balance-computation engine behind it (unlike the real page, which does
// recompute a scoped balance), and showing an invented number here would be dishonest — a plain
// sentence says so, the same "illustrative" honesty the Trips page already holds itself to.
function eventsDirectory(selectedEventId, onSelect) {
  const rows = fx.shared.events.map((e) => {
    const count = fx.shared.expenses.filter((g) => g.eventId === e.id).length;
    const isCurrent = selectedEventId === e.id;
    return el("li", { class: "grow" }, [
      el("span", {}, [withIcon("tag", e.name), e.isDefault ? el("span", { class: "muted small" }, [" (default)"]) : null]),
      badge(e.status === "active" ? "Active" : e.status === "closed" ? "Closed" : "Archived", e.status === "archived" ? "closed" : e.status === "closed" ? "warning" : ""),
      el("span", { class: "muted small", text: `${count} expense${count === 1 ? "" : "s"}` }),
      el("span", { class: "app__spacer" }),
      isCurrent
        ? button("Viewing this event", () => onSelect(null), { small: true, variant: "primary", attrs: { "aria-label": `Stop viewing ${e.name} — show every event combined` } })
        : button("View", () => onSelect(e.id), { small: true, attrs: { "aria-label": `View only ${e.name}` } }),
    ]);
  });
  return gcard("Events", "tag", [
    el("p", { class: "field__help", text: "Events organize expenses; they do not change who can see them (illustrative — mirrors the real Shared expenses page's own Events card, BT-009-20/21)." }),
    el("ul", { class: "stack" }, rows),
  ], { full: true });
}
// BT-013-13 (2026-09-20): a real summary row (members, expenses in this event, total this event —
// respects whichever event is currently scoped, never a global figure pretending otherwise) shared by
// every remaining Shared pattern, coordinating each concept's own Shared expenses page with context.
function sharedSummaryRow(expenses) {
  const total = expenses.reduce((s, g) => s + Number(g.amount), 0);
  return el("div", { class: "ggrid gpage-summary" }, [
    metric("Members", String(fx.shared.balances.length), null),
    metric("Expenses", String(expenses.length), null),
    metric("Total", amountText(total.toFixed(2), fx.shared.currency, fx.prefs), null),
  ]);
}
function sharedBalanceList(expenses) {
  return [
    sharedSummaryRow(expenses),
    gcard("Balances", "users", fx.shared.balances.map((b) => el("div", { class: "row" }, [el("span", { text: b.name }), el("span", { class: "app__spacer" }), amountText(b.net, fx.shared.currency, fx.prefs)]))),
    gcard("Recent shared expenses", "receipt", expenses.length ? el("ul", { class: "stack" }, expenses.map((g) => el("li", { class: "grow" }, [el("span", { class: "muted small", text: g.date }), el("span", { text: g.description }), el("span", { class: "muted small", text: `paid by ${g.payer}` }), el("span", { class: "app__spacer" }), amountText(`-${g.amount}`, fx.shared.currency, fx.prefs)]))) : el("p", { class: "muted small", text: "No expenses in this event." }), { full: true }),
  ];
}
function sharedLedgerTable(expenses) {
  const rows = expenses.map((g) => el("tr", {}, [
    el("td", { text: g.date }), el("td", { text: g.description }), el("td", { text: g.payer }),
    el("td", { class: "num" }, [amountText(`-${g.amount}`, fx.shared.currency, fx.prefs)]),
  ]));
  const table = el("table", { class: "table gtable-dense" }, [
    el("thead", {}, [el("tr", {}, ["Date", "Description", "Paid by", "Amount"].map((h) => el("th", { scope: "col", class: h === "Amount" ? "num" : "", text: h })))]),
    el("tbody", {}, rows),
  ]);
  const balanceRow = fx.shared.balances.map((b) => el("span", { class: "badge" }, [`${b.name}: `, amountText(b.net, fx.shared.currency, fx.prefs)]));
  return [
    sharedSummaryRow(expenses),
    gcard("Balances", "users", el("div", { class: "row" }, balanceRow)),
    gcard("Shared expenses", "receipt", el("div", { class: "table-wrap" }, [table]), { full: true }),
  ];
}
function sharedSettlementFocus(expenses) {
  const owes = fx.shared.balances.filter((b) => Number(b.net) < 0);
  const owed = fx.shared.balances.filter((b) => Number(b.net) > 0);
  const suggestions = owes.flatMap((from) => owed.map((to) => el("li", { class: "grow" }, [
    el("span", { text: `${from.name} → ${to.name}` }), el("span", { class: "app__spacer" }),
    amountText(String(Math.min(Math.abs(Number(from.net)), Number(to.net)).toFixed(2)), fx.shared.currency, fx.prefs),
  ])));
  return [
    sharedSummaryRow(expenses),
    gcard("Settle up", "scale", suggestions.length ? el("ul", { class: "stack" }, suggestions) : el("p", { class: "muted", text: "Everyone is settled up." }), { full: true }),
    gcard("Recent shared expenses", "receipt", expenses.length ? el("ul", { class: "stack" }, expenses.slice(0, 3).map((g) => el("li", { class: "grow" }, [el("span", { text: g.description }), el("span", { class: "app__spacer" }), amountText(`-${g.amount}`, fx.shared.currency, fx.prefs)]))) : el("p", { class: "muted small", text: "No expenses in this event." })),
  ];
}
// BT-013-11 (2026-09-20): a BESPOKE Shared-expenses composition for `household-hub`, built closely
// against a real reference UI kit's own group-expense screens (`.local/refcheck/r04.png`, extracted
// from docs/BudgetTracker-references.html) — a bold total-bill figure, member avatars ordered by who
// is owed, and a real expense list styled as individual cards, not one borrowed element. Deliberately
// NOT assembled from the shared sharedPattern vocabulary above; reuses shared PRIMITIVES (amountText,
// figureTable-style honesty) and the real canonical `fx.shared` fixture, never an invented balance.
// `expenses` is passed in by `renderShared`'s own event-scoping state machine — this renderer honours
// whichever event is currently selected exactly like every other sharedPattern already does.
function initialsOf(name) {
  const clean = name.replace(/\(.*?\)/g, "").trim();
  return clean.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}
function sharedReferenceGroupsplit(expenses) {
  const total = expenses.reduce((s, g) => s + Number(g.amount), 0);
  const ordered = [...fx.shared.balances].sort((a, b) => Number(b.net) - Number(a.net));
  const avatarRow = el("div", { class: "ggroupsplit-avatars" }, ordered.map((b) => el("div", { class: "ggroupsplit-avatar" }, [
    el("span", { class: "ggroupsplit-avatar__initials", "aria-hidden": "true", text: initialsOf(b.name) }),
    el("span", { class: "small", text: b.name }),
    amountText(b.net, fx.shared.currency, fx.prefs),
  ])));
  const totalCard = gcard("Group total", "users", [
    el("p", { class: "ggroupsplit-total" }, [amountText(`-${total.toFixed(2)}`, fx.shared.currency, fx.prefs)]),
    el("p", { class: "muted small", text: `${expenses.length} expense${expenses.length === 1 ? "" : "s"} in this event` }),
    avatarRow,
  ], { full: true });
  const cards = expenses.map((g) => el("div", { class: "ggroupsplit-card" }, [
    el("div", { class: "ggroupsplit-card__top" }, [
      el("strong", { text: g.description }),
      amountText(`-${g.amount}`, fx.shared.currency, fx.prefs),
    ]),
    el("p", { class: "muted small", text: `${g.date} · Paid by ${g.payer}` }),
  ]));
  const listCard = gcard("Expenses", "receipt", cards.length ? el("div", { class: "ggroupsplit-list" }, cards) : el("p", { class: "muted small", text: "No expenses in this event." }), { full: true });
  return [totalCard, listCard];
}
// BT-013-15: Shared expenses answers TWO questions on two views of the SAME page (Terry: "Preserve the
// distinction between event directory and event detail"). The DIRECTORY (`eventsDirectory()` above,
// shared by every pattern) already shows which events are active, closed or being viewed; when no
// event is selected this renderer adds the real combined balances and recent activity. When ONE event
// IS selected, this is the DETAIL: real per-event participant balances (`fx.splitBalances`, never the
// combined figure), who owes whom, and that event's own expenses — a genuinely different, richer view
// from the directory, not merely a narrowed list.
function sharedReferenceLedgerfly(expenses, selectedEvent) {
  const totalExpenses = fx.shared.expenses.reduce((s, g) => s + Number(g.amount), 0);
  const outstanding = fx.shared.balances.filter((b) => Number(b.net) < 0).reduce((s, b) => s - Number(b.net), 0);
  const kpiStrip = ledgerflyKpiStrip([
    { label: "Events", value: el("span", { text: String(fx.shared.events.length) }), meta: `${fx.shared.events.filter((e) => e.status === "active").length} active`, emphasize: true },
    { label: "Members", value: el("span", { text: String(fx.shared.balances.length) }), meta: "In this workspace" },
    { label: "Total expenses", value: amountText((-totalExpenses).toFixed(2), fx.shared.currency, fx.prefs), meta: "Across every event" },
    { label: "Outstanding", value: amountText((-outstanding).toFixed(2), fx.shared.currency, fx.prefs), meta: "Still to settle" },
  ]);
  if (!selectedEvent) {
    return [
      kpiStrip,
      gcard("Balances", "users", fx.shared.balances.map((b) => el("div", { class: "row" }, [el("span", { text: b.name }), el("span", { class: "app__spacer" }), amountText(b.net, fx.shared.currency, fx.prefs)]))),
      gcard("Recent shared expenses", "receipt", el("ul", { class: "stack" }, expenses.map((g) => el("li", { class: "grow" }, [el("span", { class: "muted small", text: g.date }), el("span", { text: g.description }), el("span", { class: "muted small", text: `paid by ${g.payer}` }), el("span", { class: "app__spacer" }), amountText(`-${g.amount}`, fx.shared.currency, fx.prefs)]))), { full: true }),
    ];
  }
  const balances = fx.splitBalances(expenses);
  const owes = balances.filter((b) => Number(b.net) < 0);
  const owed = balances.filter((b) => Number(b.net) > 0);
  const settled = balances.every((b) => Math.abs(Number(b.net)) < 0.01);
  const suggestions = owes.flatMap((from) => owed.map((to) => el("li", { class: "grow" }, [
    el("span", { text: `${from.name} → ${to.name}` }), el("span", { class: "app__spacer" }),
    amountText(String(Math.min(Math.abs(Number(from.net)), Number(to.net)).toFixed(2)), fx.shared.currency, fx.prefs),
  ])));
  return [
    kpiStrip,
    gcard(`${selectedEvent.name} — who owes whom`, "users", [
      badge(settled ? "Settled" : "Outstanding", settled ? "shared" : "warning"),
      el("ul", { class: "stack" }, balances.map((b) => el("li", { class: "grow" }, [el("span", { text: b.name }), el("span", { class: "app__spacer" }), amountText(b.net, fx.shared.currency, fx.prefs)]))),
    ], { full: true }),
    gcard("Settle up", "scale", suggestions.length ? el("ul", { class: "stack" }, suggestions) : el("p", { class: "muted small", text: "Everyone is settled up for this event." }), { full: true }),
    gcard(`${selectedEvent.name} — expenses`, "receipt", el("ul", { class: "stack" }, expenses.map((g) => el("li", { class: "grow" }, [el("span", { class: "muted small", text: g.date }), el("span", { text: g.description }), el("span", { class: "muted small", text: `paid by ${g.payer}, split ${g.splitAmong.length} way${g.splitAmong.length === 1 ? "" : "s"}` }), el("span", { class: "app__spacer" }), amountText(`-${g.amount}`, fx.shared.currency, fx.prefs)]))), { full: true }),
  ];
}
const REAL_EVENT_SCOPED_PATTERNS = new Set(["reference-ledgerfly"]);
const SHARED_RENDERERS = { "balance-list": sharedBalanceList, "ledger-table": sharedLedgerTable, "settlement-focus": sharedSettlementFocus, "reference-groupsplit": sharedReferenceGroupsplit, "reference-ledgerfly": sharedReferenceLedgerfly };
function renderShared(concept) {
  const page = el("div", { class: "gpage gpage--list" });
  let selectedEventId = null;
  function paint() {
    const fn = SHARED_RENDERERS[concept.sharedPattern] || sharedBalanceList;
    const selectedEvent = selectedEventId ? fx.shared.events.find((e) => e.id === selectedEventId) : null;
    const expenses = selectedEvent ? fx.shared.expenses.filter((g) => g.eventId === selectedEvent.id) : fx.shared.expenses;
    // BT-013-15: patterns in REAL_EVENT_SCOPED_PATTERNS compute a genuine per-event balance
    // (`fx.splitBalances`) for their own detail view, so the older "balances stay combined" honesty
    // disclosure — still true and still shown for every OTHER pattern, which do not — does not apply.
    mount(page,
      pageTitle("shared"),
      eventsDirectory(selectedEventId, (id) => { selectedEventId = id; paint(); }),
      (selectedEvent && !REAL_EVENT_SCOPED_PATTERNS.has(concept.sharedPattern)) ? el("p", { class: "field__help", text: `Showing only "${selectedEvent.name}"'s own shared expenses. Balances above stay combined across every event in this illustrative preview.` }) : null,
      ...fn(expenses, selectedEvent),
    );
  }
  paint();
  return page;
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
// BT-013-13 (2026-09-20): a real summary row (trip count, combined budget/spent — never invented)
// shared by every Trips pattern, coordinating each concept's own Trips page with real context.
function tripsSummaryRow() {
  const budget = fx.trips.reduce((s, t) => s + Number(t.budget), 0);
  const spent = fx.trips.reduce((s, t) => s + Number(t.spent), 0);
  return el("div", { class: "ggrid gpage-summary" }, [
    metric("Trips", String(fx.trips.length), null),
    metric("Combined budget", formatAmount(budget.toFixed(2), fx.trips[0].currency), null),
    metric("Combined spent", formatAmount(spent.toFixed(2), fx.trips[0].currency), null),
  ]);
}
function tripsCardGrid() {
  return [tripsSummaryRow(), el("div", { class: "ggrid ggrid--metrics" }, fx.trips.map((t) => gcard(t.name, t.icon, tripCard(t, { withName: false }))))];
}
function tripsList() {
  return [tripsSummaryRow(), gcard("Trips", "suitcase", el("ul", { class: "stack" }, fx.trips.map((t) => el("li", { class: "grow" }, [
    withIcon(t.icon, t.name), el("span", { class: "muted small", text: t.dateRange }), el("span", { class: "app__spacer" }),
    el("span", { class: "small", text: `${t.spent} of ${t.budget} ${t.currency}` }),
  ]))), { full: true })];
}
function tripsTimeline() {
  const sorted = [...fx.trips].sort((a, b) => (a.dateRange < b.dateRange ? -1 : 1));
  return [tripsSummaryRow(), gcard("Trips, in order", "clock", el("ol", { class: "gtimeline" }, sorted.map((t) => el("li", { class: "gtimeline__item gtimeline__item--future" }, [
    el("span", { class: "gtimeline__date muted small", text: t.dateRange }), withIcon(t.icon, t.name), el("span", { class: "muted small" }, [` — ${t.spent} of ${t.budget} ${t.currency}`]),
  ]))), { full: true })];
}
// BT-013-15: Trips stays illustrative (BT-010 hold) — the SAME KPI-strip identity, still clearly
// labelled by TRIPS_NOTE above whatever this renders.
function tripsReferenceLedgerfly() {
  const budget = fx.trips.reduce((s, t) => s + Number(t.budget), 0);
  const spent = fx.trips.reduce((s, t) => s + Number(t.spent), 0);
  const kpiStrip = ledgerflyKpiStrip([
    { label: "Trips", value: el("span", { text: String(fx.trips.length) }), meta: "Illustrative", emphasize: true },
    { label: "Combined budget", value: money(budget.toFixed(2), fx.trips[0].currency, fx.prefs), meta: "Across every trip" },
    { label: "Combined spent", value: amountText((-spent).toFixed(2), fx.trips[0].currency, fx.prefs), meta: "Across every trip" },
    { label: "Remaining", value: amountText((budget - spent).toFixed(2), fx.trips[0].currency, fx.prefs), meta: "Budget minus spent" },
  ]);
  return [kpiStrip, gcard("Trips", "suitcase", el("div", { class: "ggrid ggrid--metrics" }, fx.trips.map((t) => gcard(t.name, t.icon, tripCard(t, { withName: false })))), { full: true })];
}
const TRIPS_RENDERERS = { "card-grid": tripsCardGrid, list: tripsList, timeline: tripsTimeline, "reference-ledgerfly": tripsReferenceLedgerfly };
function renderTrips(concept) {
  const fn = TRIPS_RENDERERS[concept.tripsPattern] || tripsCardGrid;
  return el("div", { class: "gpage gpage--list" }, [pageTitle("trips"), el("p", { class: "field__help", text: TRIPS_NOTE }), ...fn()]);
}

// REAL interactive controls (review, 2026-09-19: before this, Settings was a read-only label/badge
// list — exactly the "no silent no-op controls" requirement this Gallery otherwise holds itself to).
// Each call builds its own FRESH, request-scoped copy of the sample settings (never the shared
// fixture array itself, and never a mutation visible to any other simultaneously-rendered frame —
// a thumbnail, the main preview and a "Compare" pane never leak state into each other) and wires up
// the exact same control the real production Workspace settings card uses for a boolean or choice
// setting (`pickerSelect` inside `field`, app/js/ui/settingsform.js) — reusing the real mechanism,
// never a lookalike. Changing a control here visibly updates this preview's own state and nothing
// else: no API call is ever made, and "Preview only" is said beside every control so nobody mistakes
// it for a real change to their workspace.
function settingsControls(sample) {
  const local = sample.map((s) => ({ ...s }));
  return local.map((s) => {
    const options = s.type === "boolean" ? [{ value: "true", label: "On" }, { value: "false", label: "Off" }] : (s.options || []).map((o) => ({ value: String(o.value), label: o.label }));
    const pick = pickerSelect(options, String(s.value), {}, {});
    pick.addEventListener("change", () => {
      s.value = s.type === "boolean" ? pick.value === "true" : ((s.options || []).find((o) => String(o.value) === pick.value) || { value: s.value }).value;
    });
    return { s, control: field(s.label, pick, { help: "Preview only — nothing here is saved." }) };
  });
}
function workspaceSettingsFlatList() {
  const rows = settingsControls(fx.settingsSample);
  return [gcard("Workspace settings (illustrative)", "building", el("div", { class: "stack" }, rows.map((r) => r.control)), { full: true })];
}
// Mirrors the REAL responsive two-column settings layout shipped in the application itself (item 5,
// settingsform.js/components.css .settings-group__body) — reusing the exact same class names, so a
// concept that chooses this pattern previews the production mechanism, not a lookalike.
function workspaceSettingsTwoColumnGrouped() {
  const rows = settingsControls(fx.settingsSample);
  return [gcard("Workspace settings (illustrative)", "building", el("div", { class: "settings-group__body" }, rows.map((r) => el("div", { class: "setting" }, [r.control]))), { full: true })];
}
const WORKSETTINGS_RENDERERS = { "flat-list": workspaceSettingsFlatList, "two-column-grouped": workspaceSettingsTwoColumnGrouped };
function renderWorkspaceSettings(concept) {
  const fn = WORKSETTINGS_RENDERERS[concept.settingsPattern] || workspaceSettingsFlatList;
  return el("div", { class: "gpage gpage--list" }, [pageTitle("worksettings"), ...fn()]);
}

// BT-013-14 (2026-09-20): My Settings — a genuinely SEPARATE required page from Workspace Settings
// (never the same page pretending to cover both), preserving the real production distinction: applies
// only to the person viewing it, never to anyone else in any workspace (app/js/ui/views/settings.js's
// own opening sentence). Reuses the exact same real control mechanism and the concept's own chosen
// `settingsPattern` shape (shared structure is fine — Terry's own words — the CONTENT is what differs).
function mySettingsFlatList() {
  const rows = settingsControls(fx.mySettingsSample);
  return [gcard("My settings (illustrative)", "user", el("div", { class: "stack" }, rows.map((r) => r.control)), { full: true })];
}
function mySettingsTwoColumnGrouped() {
  const rows = settingsControls(fx.mySettingsSample);
  return [gcard("My settings (illustrative)", "user", el("div", { class: "settings-group__body" }, rows.map((r) => el("div", { class: "setting" }, [r.control]))), { full: true })];
}
const MYSETTINGS_RENDERERS = { "flat-list": mySettingsFlatList, "two-column-grouped": mySettingsTwoColumnGrouped };
function renderMySettings(concept) {
  const fn = MYSETTINGS_RENDERERS[concept.settingsPattern] || mySettingsFlatList;
  return el("div", { class: "gpage gpage--list" }, [pageTitle("mysettings"), ...fn()]);
}

const PAGE_RENDERERS = { dashboard: renderDashboard, transactions: renderTransactions, bills: renderBills, budget: renderBudget, accounts: renderAccounts, shared: renderShared, trips: renderTrips, mysettings: renderMySettings, worksettings: renderWorkspaceSettings, merchants: renderMerchants, debt: renderDebt };

// ---- the frame: nav + page, driven by the concept's own composition parameters --------------------
// `pages` already includes the concept's own `extraPages` (renderConceptFrame merges them in below) —
// "Accounts" reads without "/ Merchants" whenever Merchants is present as its own separate nav item.
function renderNav(concept, activeId, onNavigate, pages) {
  const hasOwnMerchants = pages.includes("merchants");
  const items = pages.map((id) => el("button", {
    type: "button", class: ["gnav__item", id === activeId ? "gnav__item--active" : ""], "aria-current": id === activeId ? "page" : null,
    onClick: () => onNavigate(id),
  }, [withIcon(PAGE_ICON[id], id === "accounts" && hasOwnMerchants ? "Accounts" : PAGE_LABEL[id])]));
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
export function renderConceptFrame(concept, pageId, onNavigate, { requiredPages = Object.keys(PAGE_LABEL), colorOverride = null } = {}) {
  // BT-013-15: a concept's own `extraPages` (Merchants, Debt/loan detail — declared only by the
  // concepts that build them) are appended to the required set for nav purposes ONLY here, never by
  // changing the global REQUIRED_PAGES the other twelve concepts are tested against.
  const pages = [...requiredPages, ...(concept.extraPages || [])];
  const page = (PAGE_RENDERERS[pageId] || renderDashboard)(concept, onNavigate);
  return el("div", {
    class: "gframe", dataset: { nav: concept.navStyle, density: concept.density, card: concept.cardStyle, page: pageId, voice: concept.typeVoice, chart: concept.chartEmphasis, concept: concept.id },
    // Each concept's own colour identity (review, 2026-09-19), scoped to this frame only via CSS
    // custom properties never set outside it — see the accentLight/accentDark comment in
    // api/_shared/layouts.js and the --g-accent rules in gallery.css. BT-013-15 (2026-09-20): a
    // signed-in site administrator's OWN personal override (`galleryDesignColors`,
    // api/preferences/handler.js) takes precedence when present — never a workspace setting, never
    // applied to anyone else, and it changes nothing about the concept's OWN declared defaults.
    vars: {
      "--g-accent-light": (colorOverride && colorOverride.light) || concept.accentLight || null,
      "--g-accent-dark": (colorOverride && colorOverride.dark) || concept.accentDark || null,
    },
    "aria-label": `${concept.name} preview, ${PAGE_LABEL[pageId] || pageId} page`,
  }, [
    renderNav(concept, pageId, onNavigate, pages),
    el("div", { class: "gframe__main" }, [page]),
  ]);
}

export { PAGE_LABEL, PAGE_ICON };
