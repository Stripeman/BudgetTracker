// Dashboard: net position by currency (only balances the viewer may see), split into their own
// money, shared accounts and accounts others shared with them; accounts; recent entries; and the
// primary "Add expense" action when at least one account accepts new entries.
//
// BT-013-16 (Terry, 2026-09-21): the workspace's real, applied layout (`layoutId`, already resolved
// client-side on every workspace summary as `settingValues.layoutId` — no new fetch) picks which
// renderer draws the SAME derived data below. `deriveDashboardData` computes every figure exactly
// once, from the SAME authorized slices every layout reads (CLAUDE.md: "one canonical model,
// calculation... shared by every view"); `renderClassicDashboard` is today's markup, kept verbatim,
// still updating its own stable containers in place (never rebuilt wholesale, so nothing about its
// existing update behaviour, focus stability or DOM identity changes). The three flagship renderers
// (Executive Forecast/`ledgerfly-forecast`, Budget Workspace/`finexa-budget`, Financial
// Overview/`acru-overview`) are new, genuinely different compositions of that same data — not a
// recolour of the classic layout — built with the app's own real chart primitive (`donutChart`,
// app/js/ui/charts.js), never the Design Gallery's fictional-fixture-only rendering path
// (app/js/ui/gallery/compose.js), which this page never imports. Each rebuilds its own tree on every
// update (a disclosed, later-polish limitation for the three new layouts only — see
// PROJECT_STATE.md); Classic's own update path is completely unchanged.
import { el, mount } from "../dom.js";
import { pageHead, stateView, money, accessBadge, button, transferLabel, categoryLabel } from "../components.js";
import { sliceFor } from "../../core/store.js";
import { ACCOUNT_TYPE_LABELS, formatDate, formatAmount, todayIso, startOfWeekIso, startOfMonthIso } from "../../core/format.js";
import { openQuickEntry, canAddEntries, addEntriesBlocked, entryAmount } from "./transactions.js";
import { warningText } from "./planning.js";
import { icon, withIcon } from "../icons.js";
import { openGroupExpense, balanceLabel, shownTables } from "./group.js";
import { sharedExpensesOn } from "../../core/workspacesettings.js";
import { categoryIndex } from "../../core/categories.js";
import { donutChart, moneyFigureTable, chartLegend } from "../charts.js";
import { effectiveLayoutId, layoutAccentVars } from "../../core/layoutmeta.js";

// A card title with its icon (BT-011-05); the words name the card, the icon is decoration.
const titled = (id, iconId, text, tag = "h2") => el(tag, { class: "card__title", id }, [withIcon(iconId, text)]);

// A shared-expense group or a trip needs no account (Terry, 2026-09-14; BT-009): its dashboard leads
// to Shared expenses, instead of asking for an account. The balance card follows the one rule for
// Shared expenses (the workspace setting, bounded by the site), so a household sees it too — the page
// and its dashboard summary are shown or hidden together (workspace settings, Terry 2026-09-14).
const SHARED_KINDS = new Set(["group", "trip"]);
const workspaceOf = (state) => (state.workspaces || []).find((w) => w.id === state.selectedWorkspaceId) || null;


// ---- one derivation, shared by every renderer (CLAUDE.md: one canonical calculation per concept) ---
function deriveDashboardData(state) {
  const ws = workspaceOf(state);
  const groupOn = !!ws && sharedExpensesOn(ws, state.site);
  const sharedKind = groupOn && SHARED_KINDS.has(ws.kind);
  const prefs = state.preferences;
  const dateFormat = prefs && prefs.effective && prefs.effective.dateFormat;
  const fmt = (v, c) => formatAmount(v, c, { numberFormat: prefs && prefs.effective && prefs.effective.numberFormat });

  // Needs attention (BT-008): overdue and due-soon bills, and 30-day cash-flow warnings, plus a
  // shared-expense review flag — as plain facts here; each renderer decides how to show them.
  const billData = sliceFor(state, "bills").data;
  const forecast = sliceFor(state, "forecast").data;
  const groupDataForAlert = groupOn ? sliceFor(state, "group").data : null;
  const alertFacts = {
    overdueBills: (billData && billData.summary.overdue) || 0,
    dueSoonBills: (billData && billData.summary.dueSoon) || 0,
    forecastWarnings: forecast ? forecast.forecast.warnings.map((w) => warningText(w, fmt, dateFormat)) : [],
    groupNeedsReview: !!(groupDataForAlert && (groupDataForAlert.myLedgers || []).some((l) => l.reviewCount > 0)),
  };

  const accounts = sliceFor(state, "accounts");
  const txns = sliceFor(state, "transactions");

  // Shared balance (BT-009): the viewer's balance in every currency where it is open, not only the
  // reporting currency (financial review finding 3).
  let groupCard = null;
  if (groupOn) {
    const g = sliceFor(state, "group");
    const data = g.data;
    const mine = data ? shownTables(data).map((t) => [t, t.rows.find((r) => r.ref === data.permissions.selfRef)]).filter(([, r]) => r && !/^-?0(\.0+)?$/.test(String(r.net))) : [];
    groupCard = {
      slice: g, data, mine,
      title: SHARED_KINDS.has(ws.kind) ? "Your balance in this group" : "Your balance in Shared expenses",
      expenseCount: data ? data.expenses.filter((e) => e.status !== "void").length : 0,
    };
  }

  // This week's income and expenses (BT-014-14): server-computed `summary`, exact minor-unit
  // arithmetic — never summed from individual entries here.
  const week = sliceFor(state, "weekActivity");
  const weekSummary = (week.data && week.data.summary) || [];

  // Spending by category, this month (BT-014-14).
  const catIndex = categoryIndex(state);
  const month = sliceFor(state, "monthActivity");
  const monthSummary = ((month.data && month.data.summary) || []).filter((s) => s.byCategory && s.byCategory.length);
  const spendingByCurrency = monthSummary.map((s) => ({
    currency: s.currency,
    total: s.byCategory.reduce((sum, c) => sum + Number(c.amount), 0),
    rows: s.byCategory
      .map((c) => {
        const cat = catIndex.get(c.categoryId);
        return { label: cat ? cat.name : "Uncategorized", color: cat ? cat.shownColor : null, icon: cat ? cat.shownIcon : null, amountText: formatAmount(c.amount, s.currency, { numberFormat: prefs && prefs.effective && prefs.effective.numberFormat }), value: Number(c.amount) };
      })
      .sort((a, b) => b.value - a.value),
  }));

  // Top merchants (BT-014-14): the same per-payee `stats` the Merchants page already computes.
  const payeesList = (sliceFor(state, "payees").data || {}).payees || [];
  const topMerchants = payeesList
    .map((p) => ({ p, stat: (p.stats || []).slice().sort((a, b) => Number(b.gross) - Number(a.gross))[0] }))
    .filter((x) => x.stat && Number(x.stat.gross) > 0)
    .sort((a, b) => Number(b.stat.gross) - Number(a.stat.gross))
    .slice(0, 5);

  const merchantIcons = new Map(payeesList.map((p) => [p.id, p.icon || "store"]));
  const accountsById = new Map(((accounts.data || {}).accounts || []).map((a) => [a.id, a]));
  const recentTx = txns.data ? txns.data.transactions.slice(0, 8) : [];

  const alertCount = alertFacts.overdueBills + alertFacts.dueSoonBills + alertFacts.forecastWarnings.length + (alertFacts.groupNeedsReview ? 1 : 0);

  return {
    ws, groupOn, sharedKind, prefs, dateFormat, fmt,
    alertFacts, alertCount, accounts, txns, groupCard, weekSummary, spendingByCurrency, topMerchants,
    merchantIcons, accountsById, recentTx, catIndex,
  };
}

// Shared across every layout (Terry: "available actions" must be preserved regardless of layout).
// BT-013-16: while previewing a layout, opening the real entry form would be pointless (any submit
// is refused by the store's own guard) and confusing — the button explains why instead of opening
// it. The guard in app/js/core/store.js `write()` is the real, authoritative safety net regardless.
function renderActions(actionsEl, ctx, state, data) {
  if (state.layoutPreview) {
    mount(actionsEl, button(data.sharedKind && data.ws.role !== "viewer" ? "Add shared expense" : "Add expense", () => {}, {
      variant: "primary", attrs: { disabled: true, "aria-disabled": "true", title: "This is a read-only layout preview. Exit preview to make changes." },
    }));
    return;
  }
  if (data.sharedKind && data.ws.role !== "viewer") {
    mount(actionsEl, button("Add shared expense", () => openGroupExpense(ctx), { variant: "primary" }),
      canAddEntries(state) ? button("Add to an account", () => openQuickEntry(ctx)) : null);
  } else {
    mount(actionsEl, canAddEntries(state)
      ? button("Add expense", () => openQuickEntry(ctx), { variant: "primary" })
      : addEntriesBlocked(state));
  }
}

const buildAlertItems = (facts) => {
  const items = [];
  if (facts.overdueBills) items.push(el("li", { class: "iconlabel" }, [icon("alert"), el("span", {}, [el("a", { href: "#/bills", text: `${facts.overdueBills} overdue bill payment${facts.overdueBills === 1 ? "" : "s"}` }), " — review and record or skip."])]));
  if (facts.dueSoonBills) items.push(el("li", { class: "iconlabel" }, [icon("clock"), el("a", { href: "#/bills", text: `${facts.dueSoonBills} bill payment${facts.dueSoonBills === 1 ? "" : "s"} due soon` })]));
  for (const w of facts.forecastWarnings) items.push(el("li", { class: "iconlabel" }, [icon("chart-line"), el("a", { href: "#/planning", text: w })]));
  if (facts.groupNeedsReview) items.push(el("li", { class: "iconlabel" }, [icon("users"), el("a", { href: "#/group", text: "Shared expenses needs your attention" })]));
  return items;
};

const merchantOfFactory = (data) => (t) => (t.payeeName ? withIcon(data.merchantIcons.get(t.payeeId) || "store", t.payeeName) : t.kind === "transfer" ? transferLabel(t, data.accountsById) : el("span", { text: "—" }));
const categoryOfFactory = (data) => (t) => (t.categoryId && data.catIndex.get(t.categoryId) ? categoryLabel(data.catIndex.get(t.categoryId).name, data.catIndex.get(t.categoryId).shownColor, data.catIndex.get(t.categoryId).shownIcon) : null);

function recentEntriesList(data) {
  const merchantOf = merchantOfFactory(data);
  const categoryOf = categoryOfFactory(data);
  return el("ul", { class: "stack" }, data.recentTx.map((t) => el("li", { class: "row" }, [
    el("span", { class: "muted small", text: formatDate(t.date, data.dateFormat) }),
    merchantOf(t), categoryOf(t),
    el("span", { class: "app__spacer" }),
    entryAmount(t, data.prefs),
  ])));
}

function groupCardNode(data, titled_) {
  const gc = data.groupCard;
  return el("section", { class: "card", "aria-labelledby": "dash-shared" }, [
    titled_("dash-shared", "users", gc.title),
    gc.data ? el("div", { class: "card__value" }, gc.mine.length ? gc.mine.map(([t, r]) => el("div", {}, [balanceLabel(r, t.currency, data.fmt, { self: true, subject: "You" })])) : [el("span", { class: "muted", text: "You are settled up" })]) : stateView(gc.slice),
    gc.data ? el("p", { class: "card__meta" }, [`${gc.expenseCount} shared expenses recorded. `, el("a", { href: "#/group", text: "Open Shared expenses" })]) : null,
  ]);
}

// ---- Classic: today's exact existing markup, kept verbatim ----------------------------------------
function renderClassicDashboard(ctx, state, data, boxes) {
  const { alerts, shared, totals, weekBox, accountsBox, recent, spendingBox, merchantsBox } = boxes;
  const items = buildAlertItems(data.alertFacts);
  mount(alerts, items.length ? el("section", { class: "notice notice--warning", "aria-labelledby": "dash-alerts" }, [titled("dash-alerts", "bell", "Needs attention"), el("ul", { class: "stack" }, items)]) : null);

  if (data.groupOn) mount(shared, groupCardNode(data, titled));
  else mount(shared);

  const accState = stateView(data.accounts, {
    empty: data.sharedKind ? "No accounts, and none are needed to share expenses. Add one only if you want to track your own money here." : "No accounts yet. Add one from Accounts.",
    isEmpty: (d) => !d.accounts.length,
  });
  if (accState) { mount(totals); mount(accountsBox, accState); } else {
    mount(totals, ...data.accounts.data.totals.map((t) => {
      // Tolerates an API without the breakdown (a rollout or cached assets can briefly pair a
      // newer frontend with an older API): the headline still renders, the lines are omitted.
      const b = t.breakdown || {};
      const lines = [["Yours", b.own], ["Shared accounts", b.shared], ["Shared with you", b.granted]]
        .filter(([, v]) => typeof v === "string" && !/^-?0(\.0+)?$/.test(v));
      return el("div", { class: "card" }, [
        el("p", { class: "card__title" }, [withIcon("scale", `Net position (${t.currency})`)]),
        el("div", { class: "card__value" }, [money(t.amount, t.currency, data.prefs)]),
        lines.length > 1 ? el("ul", { class: "breakdown" }, lines.map(([label, v]) => el("li", {}, [el("span", { text: label }), money(v, t.currency, data.prefs)]))) : null,
        el("p", { class: "card__meta", text: "Only accounts whose balance you can see are included." }),
      ]);
    }));
    mount(accountsBox, el("ul", { class: "stack" }, data.accounts.data.accounts.filter((a) => !a.deletedAt).map((a) => el("li", { class: "row" }, [
      withIcon(a.icon, a.name), el("span", { class: "muted small", text: ACCOUNT_TYPE_LABELS[a.type] || a.type }), accessBadge(a),
      el("span", { class: "app__spacer" }),
      a.balance !== undefined ? money(a.balance, a.currency, data.prefs) : el("span", { class: "muted small", text: "Balance not shared with you" }),
    ]))));
  }

  mount(weekBox, ...data.weekSummary.flatMap((s) => [
    el("div", { class: "card" }, [
      el("p", { class: "card__title" }, [withIcon("chart-line", `Income this week (${s.currency})`)]),
      el("div", { class: "card__value" }, [money(s.income, s.currency, data.prefs)]),
    ]),
    el("div", { class: "card" }, [
      el("p", { class: "card__title" }, [withIcon("cart", `Expenses this week (${s.currency})`)]),
      el("div", { class: "card__value" }, [money(s.gross, s.currency, data.prefs)]),
    ]),
  ]));

  if (!data.spendingByCurrency.length) {
    mount(spendingBox, el("p", { class: "muted", text: "No spending recorded yet this month." }));
  } else {
    mount(spendingBox, ...data.spendingByCurrency.map((s) => el("div", {}, [
      data.weekSummary.length || data.spendingByCurrency.length > 1 ? el("p", { class: "card__meta", text: s.currency }) : null,
      donutChart(s.rows), chartLegend(s.rows), moneyFigureTable(s.rows, `Spending by category this month, ${s.currency}`),
    ])));
  }

  mount(merchantsBox, data.topMerchants.length
    ? el("ul", { class: "stack" }, data.topMerchants.map(({ p, stat }) => el("li", { class: "row" }, [
      withIcon(p.icon || "store", p.name),
      el("span", { class: "muted small", text: `${stat.count} ${stat.count === 1 ? "entry" : "entries"}` }),
      el("span", { class: "app__spacer" }),
      money(stat.gross, stat.currency, data.prefs),
    ])))
    : el("p", { class: "muted", text: "No merchant activity yet." }));

  const txState = stateView(data.txns, {
    empty: data.sharedKind ? "No account entries. Shared expenses are listed on Shared expenses." : "No entries yet. Use “Add expense” to record one.",
    isEmpty: (d) => !d.transactions.length,
  });
  if (txState) mount(recent, txState);
  else mount(recent, recentEntriesList(data));
}

// ---- the three flagship renderers: same derived data, genuinely different composition -------------
// Each wrapper carries its layout's accent colour (personal override, from the SAME
// `galleryDesignColors` preference the Gallery's own appearance cog already writes to, else the
// layout's own built-in identity — app/js/core/layoutmeta.js) as CSS custom properties, resolved for
// light/dark by app/styles/components.css `[data-color-scheme]` rules (BT-013-16 item 4). The
// workspace-DEFAULT colour scheme (`doc.settings.layoutColors`, set in the Layout Picker) is not yet
// read here — a disclosed, later step (PROJECT_STATE.md), not silently skipped.
function alertsCard(data, empty) {
  const items = buildAlertItems(data.alertFacts);
  return el("section", { class: "card", "aria-labelledby": "dash-alerts" }, [
    titled("dash-alerts", "bell", "Needs attention"),
    items.length ? el("ul", { class: "stack" }, items) : el("p", { class: "muted small", text: empty }),
  ]);
}
function accountsListCard(data) {
  return el("section", { class: "card", "aria-labelledby": "dash-accounts" }, [
    titled("dash-accounts", "bank", "Accounts"),
    stateView(data.accounts, { empty: data.sharedKind ? "No accounts, and none are needed to share expenses." : "No accounts yet. Add one from Accounts.", isEmpty: (d) => !d.accounts.length })
      || el("ul", { class: "stack" }, data.accounts.data.accounts.filter((a) => !a.deletedAt).map((a) => el("li", { class: "row" }, [
        withIcon(a.icon, a.name), el("span", { class: "app__spacer" }),
        a.balance !== undefined ? money(a.balance, a.currency, data.prefs) : el("span", { class: "muted small", text: "Balance not shared with you" }),
      ]))),
  ]);
}
function recentEntriesCard(data) {
  return el("section", { class: "card", "aria-labelledby": "dash-recent" }, [
    titled("dash-recent", "receipt", "Recent entries"),
    stateView(data.txns, { empty: data.sharedKind ? "No account entries. Shared expenses are listed on Shared expenses." : "No entries yet.", isEmpty: (d) => !d.transactions.length })
      || recentEntriesList(data),
  ]);
}
function spendingCard(data, title = "Spending by category") {
  return el("section", { class: "card", "aria-labelledby": "dash-spending" }, [
    titled("dash-spending", "chart-pie", title),
    !data.spendingByCurrency.length ? el("p", { class: "muted", text: "No spending recorded yet this month." })
      : el("div", { class: "stack" }, data.spendingByCurrency.map((s) => el("div", {}, [
        data.spendingByCurrency.length > 1 ? el("p", { class: "card__meta", text: s.currency }) : null,
        donutChart(s.rows), chartLegend(s.rows), moneyFigureTable(s.rows, `Spending by category this month, ${s.currency}`),
      ]))),
  ]);
}
function merchantsCard(data) {
  return el("section", { class: "card", "aria-labelledby": "dash-merchants" }, [
    titled("dash-merchants", "store", "Top merchants"),
    data.topMerchants.length ? el("ul", { class: "stack" }, data.topMerchants.map(({ p, stat }) => el("li", { class: "row" }, [
      withIcon(p.icon || "store", p.name), el("span", { class: "app__spacer" }), money(stat.gross, stat.currency, data.prefs),
    ]))) : el("p", { class: "muted small", text: "No merchant activity yet." }),
  ]);
}
const primaryTotal = (data) => (data.accounts.data && data.accounts.data.totals && data.accounts.data.totals[0]) || null;

// Executive Forecast (`ledgerfly-forecast`): a KPI strip leads (total balance emphasised, this
// week's income/expenses, items needing attention), then a two-column body — the spending-by-
// category chart and recent entries on the left, top merchants and accounts on the right.
function renderLedgerflyDashboard(ctx, state, data) {
  const total = primaryTotal(data);
  const week = data.weekSummary[0];
  const kpis = [
    { label: "Total balance", value: total ? money(total.amount, total.currency, data.prefs) : el("span", { class: "muted", text: "No accounts yet" }), meta: "Across every account you can see", emphasize: true },
    { label: "Income this week", value: week ? money(week.income, week.currency, data.prefs) : el("span", { text: "—" }), meta: "This period" },
    { label: "Expenses this week", value: week ? money(week.gross, week.currency, data.prefs) : el("span", { text: "—" }), meta: "This period" },
    { label: "Needs attention", value: el("span", { text: String(data.alertCount) }), meta: data.alertCount === 1 ? "item" : "items" },
  ];
  const kpiStrip = el("div", { class: "dashflag-kpis" }, kpis.map((k) => el("div", { class: ["dashflag-kpi", k.emphasize ? "dashflag-kpi--emphasis" : ""] }, [
    el("p", { class: "dashflag-kpi__label", text: k.label }),
    el("p", { class: "dashflag-kpi__value" }, [k.value]),
    el("p", { class: "muted small", text: k.meta }),
  ])));
  return el("div", { class: "dashflag", vars: layoutAccentVars(state, "ledgerfly-forecast") }, [
    kpiStrip,
    el("div", { class: "grid grid--two" }, [
      el("div", { class: "stack" }, [spendingCard(data, "Spending breakdown"), recentEntriesCard(data)]),
      el("div", { class: "stack" }, [merchantsCard(data), accountsListCard(data), data.groupOn ? groupCardNode(data, titled) : null]),
    ]),
  ]);
}

// Budget Workspace (`finexa-budget`): a subhead, then a top pair (spending chart + needs-attention),
// then a row of varied real metric cards — the same "genuinely different card per figure" idea the
// real Budget page already established for this concept.
function renderFinexaDashboard(ctx, state, data) {
  const week = data.weekSummary[0];
  const top5 = data.topMerchants[0];
  const total = primaryTotal(data);
  const cards = [
    el("section", { class: "card" }, [el("p", { class: "card__title", text: "Net position" }), total ? el("div", { class: "card__value" }, [money(total.amount, total.currency, data.prefs)]) : el("p", { class: "muted small", text: "No accounts yet" })]),
    el("section", { class: "card" }, [el("p", { class: "card__title", text: "Income this week" }), week ? el("div", { class: "card__value" }, [money(week.income, week.currency, data.prefs)]) : el("p", { class: "muted small", text: "No activity yet" })]),
    el("section", { class: "card" }, [el("p", { class: "card__title", text: "Expenses this week" }), week ? el("div", { class: "card__value" }, [money(week.gross, week.currency, data.prefs)]) : el("p", { class: "muted small", text: "No activity yet" })]),
    el("section", { class: "card" }, [el("p", { class: "card__title", text: "Top merchant" }), top5 ? el("div", { class: "card__value small" }, [withIcon(top5.p.icon || "store", top5.p.name)]) : el("p", { class: "muted small", text: "No merchant activity yet" })]),
    data.groupOn
      ? el("section", { class: "card" }, [el("p", { class: "card__title", text: "Shared balance" }, ), data.groupCard.mine.length ? el("div", { class: "card__value small" }, data.groupCard.mine.map(([t, r]) => el("div", {}, [balanceLabel(r, t.currency, data.fmt, { self: true, subject: "You" })]))) : el("p", { class: "muted small", text: "You are settled up" })])
      : el("section", { class: "card" }, [el("p", { class: "card__title", text: "Accounts" }), el("div", { class: "card__value" }, [String((data.accounts.data && data.accounts.data.accounts.filter((a) => !a.deletedAt).length) || 0)])]),
  ];
  return el("div", { class: "dashflag", vars: layoutAccentVars(state, "finexa-budget") }, [
    el("div", { class: "dashflag-subhead" }, [el("h2", { text: "Overview" }), el("p", { class: "muted small", text: "Where you stand today, at a glance." })]),
    el("div", { class: "grid grid--two" }, [spendingCard(data), alertsCard(data, "Nothing needs attention right now.")]),
    el("div", { class: "grid grid--cards" }, cards),
  ]);
}

// Financial Overview (`acru-overview`): a hero net-position card with a stat rail beside real
// accounts/recent-entries content, then lower panels for spending, merchants and alerts.
function renderAcruDashboard(ctx, state, data) {
  const total = primaryTotal(data);
  const week = data.weekSummary[0];
  const hero = el("section", { class: "card card--full" }, [
    el("p", { class: "muted small", text: "Overview" }),
    el("div", { class: "dashflag-hero__figure" }, [total ? money(total.amount, total.currency, data.prefs) : el("span", { class: "muted", text: "No accounts yet" })]),
    el("p", { class: "muted small", text: "Net position across every account you can see" }),
    el("div", { class: "dashflag-statrail" }, [
      el("div", {}, [el("p", { class: "muted small", text: "Income this week" }), week ? money(week.income, week.currency, data.prefs) : el("span", { text: "—" })]),
      el("div", {}, [el("p", { class: "muted small", text: "Expenses this week" }), week ? money(week.gross, week.currency, data.prefs) : el("span", { text: "—" })]),
      el("div", {}, [el("p", { class: "muted small", text: "Needs attention" }), el("span", { text: String(data.alertCount) })]),
    ]),
  ]);
  return el("div", { class: "dashflag", vars: layoutAccentVars(state, "acru-overview") }, [
    hero,
    el("div", { class: "grid grid--two" }, [
      el("div", { class: "stack" }, [accountsListCard(data), recentEntriesCard(data)]),
      el("div", { class: "stack" }, [spendingCard(data, "Spending distribution"), merchantsCard(data), data.groupOn ? groupCardNode(data, titled) : alertsCard(data, "Nothing needs attention right now.")]),
    ]),
  ]);
}

const FLAGSHIP_RENDERERS = {
  "ledgerfly-forecast": renderLedgerflyDashboard,
  "finexa-budget": renderFinexaDashboard,
  "acru-overview": renderAcruDashboard,
};

export function createView(ctx) {
  const actions = el("div", { class: "page-head__actions" });
  const bodyHost = el("div");
  const element = el("section", {}, [
    el("div", { class: "page-head" }, [el("h1", { text: "Dashboard" }), actions]),
    bodyHost,
  ]);

  // Classic's own persistent containers, built once — unchanged from before this refactor, so its
  // update behaviour, focus stability and DOM identity are exactly as they were.
  const totals = el("div", { class: "grid grid--cards" });
  const weekBox = el("div", { class: "grid grid--cards" });
  const alerts = el("div");
  const shared = el("div");
  const accountsBox = el("div");
  const recent = el("div");
  const spendingBox = el("div");
  const merchantsBox = el("div");
  const classicTree = el("div", {}, [
    alerts, shared, totals, weekBox,
    el("div", { class: "grid grid--two" }, [
      el("section", { class: "card", "aria-labelledby": "dash-spending" }, [titled("dash-spending", "chart-pie", "Spending by category"), spendingBox]),
      el("section", { class: "card", "aria-labelledby": "dash-merchants" }, [titled("dash-merchants", "store", "Top merchants"), merchantsBox]),
    ]),
    el("div", { class: "grid grid--two" }, [
      el("section", { class: "card", "aria-labelledby": "dash-accounts" }, [titled("dash-accounts", "bank", "Accounts"), accountsBox]),
      el("section", { class: "card", "aria-labelledby": "dash-recent" }, [titled("dash-recent", "receipt", "Recent entries"), recent]),
    ]),
  ]);
  const boxes = { alerts, shared, totals, weekBox, accountsBox, recent, spendingBox, merchantsBox };

  void ctx.store.actions.refreshTransactions({ limit: 8 });
  void ctx.store.actions.refreshBills();
  void ctx.store.actions.refreshForecast({ horizon: "30" });
  // Weekly recap and spending-by-category (BT-014-14): two separate, narrowly-scoped fetches, never
  // the `transactions` slice "Recent entries" already owns. `limit: 1` keeps the response small —
  // only `summary` is used, computed server-side from the FULL filtered set regardless of limit, in
  // exact minor-unit integer arithmetic (never summed from raw amounts on the client).
  void ctx.store.actions.refreshWeekActivity({ from: startOfWeekIso(), to: todayIso(), limit: 1 });
  void ctx.store.actions.refreshMonthActivity({ from: startOfMonthIso(), to: todayIso(), limit: 1 });
  // Shared expenses are loaded once while they are on, including when they are turned on later.
  let groupRequested = false;
  const loadGroup = (state) => {
    if (groupRequested || !sharedExpensesOn(workspaceOf(state), state.site)) return;
    groupRequested = true;
    void ctx.store.actions.refreshGroup();
  };
  loadGroup(ctx.state || ctx.store.getState());

  let mountedLayout = null;

  function update(state) {
    loadGroup(state);
    const data = deriveDashboardData(state);
    renderActions(actions, ctx, state, data);
    const layoutId = effectiveLayoutId(state, data.ws);
    const renderer = FLAGSHIP_RENDERERS[layoutId];
    if (!renderer) {
      if (mountedLayout !== "classic") { mount(bodyHost, classicTree); mountedLayout = "classic"; }
      renderClassicDashboard(ctx, state, data, boxes);
    } else {
      mount(bodyHost, renderer(ctx, state, data));
      mountedLayout = layoutId;
    }
  }
  return { element, update };
}
