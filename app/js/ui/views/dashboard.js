// Dashboard: net position by currency (only balances the viewer may see), split into their own
// money, shared accounts and accounts others shared with them; accounts; recent entries; and the
// primary "Add expense" action when at least one account accepts new entries.
import { el, mount } from "../dom.js";
import { pageHead, stateView, money, accessBadge, button } from "../components.js";
import { sliceFor } from "../../core/store.js";
import { ACCOUNT_TYPE_LABELS, formatDate } from "../../core/format.js";
import { openQuickEntry, canAddEntries } from "./transactions.js";

export function createView(ctx) {
  const totals = el("div", { class: "grid grid--cards" });
  const accountsBox = el("div");
  const recent = el("div");
  const actions = el("div", { class: "page-head__actions" });
  const element = el("section", {}, [
    el("div", { class: "page-head" }, [el("h1", { text: "Dashboard" }), actions]),
    totals,
    el("div", { class: "grid grid--two" }, [
      el("section", { class: "card", "aria-labelledby": "dash-accounts" }, [el("h2", { class: "card__title", id: "dash-accounts", text: "Accounts" }), accountsBox]),
      el("section", { class: "card", "aria-labelledby": "dash-recent" }, [el("h2", { class: "card__title", id: "dash-recent", text: "Recent entries" }), recent]),
    ]),
  ]);
  void ctx.store.actions.refreshTransactions({ limit: 8 });

  function update(state) {
    const prefs = state.preferences;
    const dateFormat = prefs && prefs.effective && prefs.effective.dateFormat;
    const accounts = sliceFor(state, "accounts");
    const txns = sliceFor(state, "transactions");
    mount(actions, canAddEntries(state)
      ? button("Add expense", () => openQuickEntry(ctx), { variant: "primary" })
      : el("p", { class: "muted small", text: "You can view this workspace but not add entries." }));
    const accState = stateView(accounts, { empty: "No accounts yet. Add one from Accounts.", isEmpty: (d) => !d.accounts.length });
    if (accState) { mount(totals); mount(accountsBox, accState); } else {
      mount(totals, ...accounts.data.totals.map((t) => {
        // Tolerates an API without the breakdown (a rollout or cached assets can briefly pair a
        // newer frontend with an older API): the headline still renders, the lines are omitted.
        const b = t.breakdown || {};
        const lines = [["Yours", b.own], ["Shared accounts", b.shared], ["Shared with you", b.granted]]
          .filter(([, v]) => typeof v === "string" && !/^-?0(\.0+)?$/.test(v));
        return el("div", { class: "card" }, [
          el("p", { class: "card__title", text: `Net position (${t.currency})` }),
          el("div", { class: "card__value" }, [money(t.amount, t.currency, prefs)]),
          lines.length > 1 ? el("ul", { class: "breakdown" }, lines.map(([label, v]) => el("li", {}, [el("span", { text: label }), money(v, t.currency, prefs)]))) : null,
          el("p", { class: "card__meta", text: "Only accounts whose balance you can see are included." }),
        ]);
      }));
      mount(accountsBox, el("ul", { class: "stack" }, accounts.data.accounts.filter((a) => !a.deletedAt).map((a) => el("li", { class: "row" }, [
        el("span", { text: a.name }), el("span", { class: "muted small", text: ACCOUNT_TYPE_LABELS[a.type] || a.type }), accessBadge(a),
        el("span", { class: "app__spacer" }),
        a.balance !== undefined ? money(a.balance, a.currency, prefs) : el("span", { class: "muted small", text: "Balance not shared with you" }),
      ]))));
    }
    const txState = stateView(txns, { empty: "No entries yet. Use “Add expense” to record one.", isEmpty: (d) => !d.transactions.length });
    if (txState) mount(recent, txState);
    else mount(recent, el("ul", { class: "stack" }, txns.data.transactions.slice(0, 8).map((t) => el("li", { class: "row" }, [
      el("span", { class: "muted small", text: formatDate(t.date, dateFormat) }),
      el("span", { text: t.payeeName || (t.kind === "transfer" ? "Transfer" : "—") }),
      el("span", { class: "app__spacer" }),
      money(t.amount, t.currency, prefs, { masked: false }),
    ]))));
  }
  return { element, update };
}
