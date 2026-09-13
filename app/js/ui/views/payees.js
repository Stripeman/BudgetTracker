// Merchants with their authorized history: spent, refunds and net per currency, entry count and
// last date, formatted with the person's number and date preferences. "View history" opens
// Transactions filtered to that merchant.
import { el, mount } from "../dom.js";
import { pageHead, stateView, badge, button, money } from "../components.js";
import { sliceFor } from "../../core/store.js";
import { formatDate } from "../../core/format.js";

export function createView(ctx) {
  const box = el("div");
  const element = el("section", {}, [pageHead("Merchants"), el("p", { class: "muted", text: "Totals include only entries you are allowed to see." }), box]);
  void ctx.store.actions.refreshPayees();
  function update(state) {
    const prefs = state.preferences;
    const dateFormat = prefs && prefs.effective && prefs.effective.dateFormat;
    const payees = sliceFor(state, "payees");
    const s = stateView(payees, { empty: "No merchants yet. They appear when you record an expense.", isEmpty: (d) => !d.payees.length });
    if (s) { mount(box, s); return; }
    const plain = { effective: { ...((prefs && prefs.effective) || {}), balanceMasking: false } };
    mount(box, el("div", { class: "table-wrap" }, [el("table", { class: "table table--cards", "aria-label": "Merchants" }, [
      el("thead", {}, [el("tr", {}, ["Merchant", "Spent", "Refunds", "Net", "Entries", "Last entry", "Actions"].map((h) => el("th", { scope: "col", class: ["Spent", "Refunds", "Net", "Entries"].includes(h) ? "num" : "", text: h })))]),
      el("tbody", {}, payees.data.payees.flatMap((p) => {
        const stats = p.stats.length ? p.stats : [null];
        // Every row names its merchant (additional currencies repeat it quietly) (A11Y-015).
        return stats.map((st, i) => el("tr", {}, [
          el("th", { scope: "row", "data-label": "Merchant" }, i === 0
            ? [el("strong", { text: p.name }), " ", p.visibility === "shared" ? badge("Shared", "shared") : badge("Private", "private"), p.referenceOnly ? el("div", { class: "muted small", text: "Seen through an entry shared with you" }) : null]
            : [el("span", { class: "muted small", text: `${p.name} (${st.currency})` })]),
          el("td", { "data-label": "Spent", class: "num" }, [st ? money(st.gross, st.currency, plain) : "—"]),
          el("td", { "data-label": "Refunds", class: "num" }, [st ? money(st.refunds, st.currency, plain) : "—"]),
          el("td", { "data-label": "Net", class: "num" }, [st ? money(st.net, st.currency, plain) : "—"]),
          el("td", { "data-label": "Entries", class: "num", text: st ? String(st.count) : "0" }),
          el("td", { "data-label": "Last entry", text: st ? formatDate(st.lastDate, dateFormat) : "" }),
          el("td", { "data-label": "" }, i === 0 ? [button("View history", () => ctx.navigate("transactions", { payeeId: p.id }), { small: true, attrs: { "aria-label": `View history for ${p.name}` } })] : []),
        ]));
      })),
    ])]));
  }
  return { element, update };
}
