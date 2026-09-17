// Dashboard: net position by currency (only balances the viewer may see), split into their own
// money, shared accounts and accounts others shared with them; accounts; recent entries; and the
// primary "Add expense" action when at least one account accepts new entries.
import { el, mount } from "../dom.js";
import { pageHead, stateView, money, accessBadge, button, transferLabel, categoryLabel } from "../components.js";
import { sliceFor } from "../../core/store.js";
import { ACCOUNT_TYPE_LABELS, formatDate, todayIso, startOfWeekIso, startOfMonthIso } from "../../core/format.js";
import { openQuickEntry, canAddEntries, addEntriesBlocked, entryAmount } from "./transactions.js";
import { warningText } from "./planning.js";
import { formatAmount } from "../../core/format.js";
import { icon, withIcon } from "../icons.js";
import { openGroupExpense, balanceLabel, shownTables } from "./group.js";
import { sharedExpensesOn } from "../../core/workspacesettings.js";
import { categoryIndex } from "../../core/categories.js";
import { donutChart, moneyFigureTable, chartLegend } from "../charts.js";

// A card title with its icon (BT-011-05); the words name the card, the icon is decoration.
const titled = (id, iconId, text, tag = "h2") => el(tag, { class: "card__title", id }, [withIcon(iconId, text)]);

// A shared-expense group or a trip needs no account (Terry, 2026-09-14; BT-009): its dashboard leads
// to Shared expenses, instead of asking for an account. The balance card follows the one rule for
// Shared expenses (the workspace setting, bounded by the site), so a household sees it too — the page
// and its dashboard summary are shown or hidden together (workspace settings, Terry 2026-09-14).
const SHARED_KINDS = new Set(["group", "trip"]);
const workspaceOf = (state) => (state.workspaces || []).find((w) => w.id === state.selectedWorkspaceId) || null;

export function createView(ctx) {
  const totals = el("div", { class: "grid grid--cards" });
  const weekBox = el("div", { class: "grid grid--cards" });
  const alerts = el("div");
  const shared = el("div");
  const accountsBox = el("div");
  const recent = el("div");
  const spendingBox = el("div");
  const merchantsBox = el("div");
  const actions = el("div", { class: "page-head__actions" });
  const element = el("section", {}, [
    el("div", { class: "page-head" }, [el("h1", { text: "Dashboard" }), actions]),
    alerts,
    shared,
    totals,
    weekBox,
    el("div", { class: "grid grid--two" }, [
      el("section", { class: "card", "aria-labelledby": "dash-spending" }, [titled("dash-spending", "chart-pie", "Spending by category"), spendingBox]),
      el("section", { class: "card", "aria-labelledby": "dash-merchants" }, [titled("dash-merchants", "store", "Top merchants"), merchantsBox]),
    ]),
    el("div", { class: "grid grid--two" }, [
      el("section", { class: "card", "aria-labelledby": "dash-accounts" }, [titled("dash-accounts", "bank", "Accounts"), accountsBox]),
      el("section", { class: "card", "aria-labelledby": "dash-recent" }, [titled("dash-recent", "receipt", "Recent entries"), recent]),
    ]),
  ]);
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

  function update(state) {
    const ws = workspaceOf(state);
    const groupOn = !!ws && sharedExpensesOn(ws, state.site);
    loadGroup(state);
    const sharedKind = groupOn && SHARED_KINDS.has(ws.kind);
    const prefs = state.preferences;
    const dateFormat = prefs && prefs.effective && prefs.effective.dateFormat;
    // Needs attention (BT-008): overdue and due-soon bills, and 30-day cash-flow warnings.
    const fmt = (v, c) => formatAmount(v, c, { numberFormat: prefs && prefs.effective && prefs.effective.numberFormat });
    const billData = sliceFor(state, "bills").data;
    const forecast = sliceFor(state, "forecast").data;
    const items = [];
    if (billData && billData.summary.overdue) items.push(el("li", { class: "iconlabel" }, [icon("alert"), el("span", {}, [el("a", { href: "#/bills", text: `${billData.summary.overdue} overdue bill payment${billData.summary.overdue === 1 ? "" : "s"}` }), " — review and record or skip."])]));
    if (billData && billData.summary.dueSoon) items.push(el("li", { class: "iconlabel" }, [icon("clock"), el("a", { href: "#/bills", text: `${billData.summary.dueSoon} bill payment${billData.summary.dueSoon === 1 ? "" : "s"} due soon` })]));
    if (forecast) for (const w of forecast.forecast.warnings) items.push(el("li", { class: "iconlabel" }, [icon("chart-line"), el("a", { href: "#/planning", text: warningText(w, fmt, dateFormat) })]));
    // A shared expense corrected or voided while the viewer's own linked account could not be written to
    // (for example it is closed) leaves their part needing review, without telling them beyond the
    // passive banner on Shared expenses itself (financial recheck of 41494d1, FA-3: correcting stays
    // allowed either way — the corrector must never learn anything about another person's account).
    const groupDataForAlert = groupOn ? sliceFor(state, "group").data : null;
    if (groupDataForAlert && (groupDataForAlert.myLedgers || []).some((l) => l.reviewCount > 0)) {
      items.push(el("li", { class: "iconlabel" }, [icon("users"), el("a", { href: "#/group", text: "Shared expenses needs your attention" })]));
    }
    mount(alerts, items.length ? el("section", { class: "notice notice--warning", "aria-labelledby": "dash-alerts" }, [titled("dash-alerts", "bell", "Needs attention"), el("ul", { class: "stack" }, items)]) : null);
    const accounts = sliceFor(state, "accounts");
    const txns = sliceFor(state, "transactions");
    if (sharedKind && ws.role !== "viewer") {
      mount(actions, button("Add shared expense", () => openGroupExpense(ctx), { variant: "primary" }),
        canAddEntries(state) ? button("Add to an account", () => openQuickEntry(ctx)) : null);
    } else {
      mount(actions, canAddEntries(state)
        ? button("Add expense", () => openQuickEntry(ctx), { variant: "primary" })
        : addEntriesBlocked(state));
    }
    if (groupOn) {
      const g = sliceFor(state, "group");
      const data = g.data;
      // The viewer's balance in every currency where it is open, not only the reporting currency
      // (financial review finding 3).
      const mine = data ? shownTables(data).map((t) => [t, t.rows.find((r) => r.ref === data.permissions.selfRef)]).filter(([, r]) => r && !/^-?0(\.0+)?$/.test(String(r.net))) : [];
      mount(shared, el("section", { class: "card", "aria-labelledby": "dash-shared" }, [
        titled("dash-shared", "users", SHARED_KINDS.has(ws.kind) ? "Your balance in this group" : "Your balance in Shared expenses"),
        data ? el("div", { class: "card__value" }, mine.length ? mine.map(([t, r]) => el("div", {}, [balanceLabel(r, t.currency, fmt, { self: true, subject: "You" })])) : [el("span", { class: "muted", text: "You are settled up" })]) : stateView(g),
        data ? el("p", { class: "card__meta" }, [`${data.expenses.filter((e) => e.status !== "void").length} shared expenses recorded. `, el("a", { href: "#/group", text: "Open Shared expenses" })]) : null,
      ]));
    } else mount(shared);
    const accState = stateView(accounts, {
      empty: sharedKind ? "No accounts, and none are needed to share expenses. Add one only if you want to track your own money here." : "No accounts yet. Add one from Accounts.",
      isEmpty: (d) => !d.accounts.length,
    });
    if (accState) { mount(totals); mount(accountsBox, accState); } else {
      mount(totals, ...accounts.data.totals.map((t) => {
        // Tolerates an API without the breakdown (a rollout or cached assets can briefly pair a
        // newer frontend with an older API): the headline still renders, the lines are omitted.
        const b = t.breakdown || {};
        const lines = [["Yours", b.own], ["Shared accounts", b.shared], ["Shared with you", b.granted]]
          .filter(([, v]) => typeof v === "string" && !/^-?0(\.0+)?$/.test(v));
        return el("div", { class: "card" }, [
          el("p", { class: "card__title" }, [withIcon("scale", `Net position (${t.currency})`)]),
          el("div", { class: "card__value" }, [money(t.amount, t.currency, prefs)]),
          lines.length > 1 ? el("ul", { class: "breakdown" }, lines.map(([label, v]) => el("li", {}, [el("span", { text: label }), money(v, t.currency, prefs)]))) : null,
          el("p", { class: "card__meta", text: "Only accounts whose balance you can see are included." }),
        ]);
      }));
      mount(accountsBox, el("ul", { class: "stack" }, accounts.data.accounts.filter((a) => !a.deletedAt).map((a) => el("li", { class: "row" }, [
        withIcon(a.icon, a.name), el("span", { class: "muted small", text: ACCOUNT_TYPE_LABELS[a.type] || a.type }), accessBadge(a),
        el("span", { class: "app__spacer" }),
        a.balance !== undefined ? money(a.balance, a.currency, prefs) : el("span", { class: "muted small", text: "Balance not shared with you" }),
      ]))));
    }

    // This week's income and expenses (BT-014-14): both figures come straight from the transactions
    // route's own server-computed `summary` (exact minor-unit arithmetic), scoped to this week by
    // `from`/`to` — never summed from individual entries here. Nothing shown for a currency with no
    // activity this week (the same "hide an empty section" rule as Shared expenses above), rather
    // than a misleading row of zeroes for a currency nothing happened in.
    const week = sliceFor(state, "weekActivity");
    const weekSummary = (week.data && week.data.summary) || [];
    mount(weekBox, ...weekSummary.flatMap((s) => [
      el("div", { class: "card" }, [
        el("p", { class: "card__title" }, [withIcon("chart-line", `Income this week (${s.currency})`)]),
        el("div", { class: "card__value" }, [money(s.income, s.currency, prefs)]),
      ]),
      el("div", { class: "card" }, [
        el("p", { class: "card__title" }, [withIcon("cart", `Expenses this week (${s.currency})`)]),
        el("div", { class: "card__value" }, [money(s.gross, s.currency, prefs)]),
      ]),
    ]));

    // Spending by category, this month (BT-014-14): a donut plus a visible legend (colour is never
    // the only signal — every slice names itself and its exact server-computed amount) and a
    // sr-only figure table for anyone the drawing does not reach.
    const catIndex = categoryIndex(state);
    const month = sliceFor(state, "monthActivity");
    const monthSummary = ((month.data && month.data.summary) || []).filter((s) => s.byCategory && s.byCategory.length);
    if (!monthSummary.length) {
      mount(spendingBox, el("p", { class: "muted", text: "No spending recorded yet this month." }));
    } else {
      mount(spendingBox, ...monthSummary.map((s) => {
        const rows = s.byCategory
          .map((c) => {
            const cat = catIndex.get(c.categoryId);
            return { label: cat ? cat.name : "Uncategorized", color: cat ? cat.shownColor : null, amountText: formatAmount(c.amount, s.currency, { numberFormat: prefs && prefs.effective && prefs.effective.numberFormat }), value: Number(c.amount) };
          })
          .sort((a, b) => b.value - a.value);
        return el("div", {}, [
          weekSummary.length || monthSummary.length > 1 ? el("p", { class: "card__meta", text: s.currency }) : null,
          donutChart(rows),
          chartLegend(rows),
          moneyFigureTable(rows, `Spending by category this month, ${s.currency}`),
        ]);
      }));
    }

    // Top merchants (BT-014-14): the same per-payee `stats` the Merchants page already computes and
    // shows (never a new calculation), just sorted by spend descending instead of by name. Each
    // payee's largest currency of activity is shown; multiple currencies are never added together.
    const payeesList = (sliceFor(state, "payees").data || {}).payees || [];
    const topMerchants = payeesList
      .map((p) => ({ p, stat: (p.stats || []).slice().sort((a, b) => Number(b.gross) - Number(a.gross))[0] }))
      .filter((x) => x.stat && Number(x.stat.gross) > 0)
      .sort((a, b) => Number(b.stat.gross) - Number(a.stat.gross))
      .slice(0, 5);
    mount(merchantsBox, topMerchants.length
      ? el("ul", { class: "stack" }, topMerchants.map(({ p, stat }) => el("li", { class: "row" }, [
        withIcon(p.icon || "store", p.name),
        el("span", { class: "muted small", text: `${stat.count} ${stat.count === 1 ? "entry" : "entries"}` }),
        el("span", { class: "app__spacer" }),
        money(stat.gross, stat.currency, prefs),
      ])))
      : el("p", { class: "muted", text: "No merchant activity yet." }));

    const txState = stateView(txns, {
      empty: sharedKind ? "No account entries. Shared expenses are listed on Shared expenses." : "No entries yet. Use “Add expense” to record one.",
      isEmpty: (d) => !d.transactions.length,
    });
    // Merchant icons as in Transactions (UXI-9).
    const merchantIcons = new Map(((sliceFor(state, "payees").data || {}).payees || []).map((p) => [p.id, p.icon || "store"]));
    const accountsById = new Map(((accounts.data || {}).accounts || []).map((a) => [a.id, a]));
    const merchantOf = (t) => (t.payeeName ? withIcon(merchantIcons.get(t.payeeId) || "store", t.payeeName) : t.kind === "transfer" ? transferLabel(t, accountsById) : el("span", { text: "—" }));
    // The entry's own category, coloured (BT-014-14): the same categoryLabel() component already
    // used on Transactions and Planning, never a new colour rule.
    const categoryOf = (t) => (t.categoryId && catIndex.get(t.categoryId) ? categoryLabel(catIndex.get(t.categoryId).name, catIndex.get(t.categoryId).shownColor, catIndex.get(t.categoryId).shownIcon) : null);
    if (txState) mount(recent, txState);
    else mount(recent, el("ul", { class: "stack" }, txns.data.transactions.slice(0, 8).map((t) => el("li", { class: "row" }, [
      el("span", { class: "muted small", text: formatDate(t.date, dateFormat) }),
      merchantOf(t),
      categoryOf(t),
      el("span", { class: "app__spacer" }),
      entryAmount(t, prefs),
    ]))));
  }
  return { element, update };
}
