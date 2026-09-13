// Dashboard: net position by currency (only from balances the viewer may see), accounts and the
// most recent entries, plus quick entry.
import { el, mount } from "../dom.js";
import { pageHead, stateView, money, visibilityBadge, button } from "../components.js";
import { sliceFor } from "../../core/store.js";
import { ACCOUNT_TYPE_LABELS, formatDate } from "../../core/format.js";
import { openQuickEntry } from "./transactions.js";

export function createView(ctx) {
  const totals = el("div", { class: "grid grid--cards" });
  const accountsBox = el("div");
  const recent = el("div");
  const add = button("Add expense", () => openQuickEntry(ctx), { variant: "primary" });
  const element = el("section", {}, [
    pageHead("Dashboard", [add]),
    totals,
    el("h2", { class: "sr-only", text: "Accounts" }),
    el("div", { class: "grid grid--two" }, [
      el("section", { class: "card" }, [el("h2", { class: "card__title", text: "Accounts" }), accountsBox]),
      el("section", { class: "card" }, [el("h2", { class: "card__title", text: "Recent entries" }), recent]),
    ]),
  ]);
  void ctx.store.actions.refreshTransactions({ limit: 8 });

  function update(state) {
    const prefs = state.preferences;
    const accounts = sliceFor(state, "accounts");
    const txns = sliceFor(state, "transactions");
    const accState = stateView(accounts, { empty: "No accounts yet.", isEmpty: (d) => !d.accounts.length });
    if (accState) { mount(totals); mount(accountsBox, accState); } else {
      mount(totals, ...accounts.data.totals.map((t) => el("div", { class: "card" }, [
        el("p", { class: "card__title", text: `Net position (${t.currency})` }),
        el("div", { class: "card__value" }, [money(t.amount, t.currency, prefs)]),
        el("p", { class: "card__meta", text: "Accounts you can see balances for." }),
      ])));
      mount(accountsBox, el("ul", { class: "stack" }, accounts.data.accounts.filter((a) => !a.deletedAt).map((a) => el("li", { class: "row" }, [
        el("span", { text: a.name }), el("span", { class: "muted small", text: ACCOUNT_TYPE_LABELS[a.type] || a.type }), visibilityBadge(a.visibility),
        el("span", { class: "app__spacer" }),
        a.balance !== undefined ? money(a.balance, a.currency, prefs) : el("span", { class: "muted small", text: "Balance not shared with you" }),
      ]))));
    }
    const txState = stateView(txns, { empty: "No entries yet. Use “Add expense” to record one.", isEmpty: (d) => !d.transactions.length });
    if (txState) mount(recent, txState);
    else mount(recent, el("ul", { class: "stack" }, txns.data.transactions.slice(0, 8).map((t) => el("li", { class: "row" }, [
      el("span", { class: "muted small", text: formatDate(t.date, prefs && prefs.effective && prefs.effective.dateFormat) }),
      el("span", { text: t.payeeName || (t.kind === "transfer" ? "Transfer" : "—") }),
      el("span", { class: "app__spacer" }),
      money(t.amount, t.currency, prefs, { masked: false }),
    ]))));
  }
  return { element, update };
}
