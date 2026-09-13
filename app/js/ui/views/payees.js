// Merchants (payees) with their authorized history: gross purchases, refunds and net per currency,
// entry count and last date. "View history" opens Transactions filtered to that merchant.
import { el, mount } from "../dom.js";
import { pageHead, stateView, badge, button } from "../components.js";
import { sliceFor } from "../../core/store.js";

export function createView(ctx) {
  const box = el("div");
  const element = el("section", {}, [pageHead("Merchants and payees"), el("p", { class: "muted", text: "Totals include only entries you are allowed to see." }), box]);
  void ctx.store.actions.refreshPayees();
  function update(state) {
    const payees = sliceFor(state, "payees");
    const s = stateView(payees, { empty: "No payees yet. They are created when you record an entry.", isEmpty: (d) => !d.payees.length });
    if (s) { mount(box, s); return; }
    mount(box, el("div", { class: "table-wrap" }, [el("table", { class: "table" }, [
      el("thead", {}, [el("tr", {}, ["Merchant", "Spent", "Refunds", "Net", "Entries", "Last", ""].map((h) => el("th", { scope: "col", class: ["Spent", "Refunds", "Net", "Entries"].includes(h) ? "num" : "", text: h })))]),
      el("tbody", {}, payees.data.payees.flatMap((p) => {
        const stats = p.stats.length ? p.stats : [null];
        return stats.map((st, i) => el("tr", {}, [
          el("td", {}, i === 0 ? [el("strong", { text: p.name }), " ", p.visibility === "shared" ? badge("Shared", "shared") : badge("Private", "private"), p.referenceOnly ? el("div", { class: "muted small", text: "Seen through an entry shared with you" }) : null] : []),
          el("td", { class: "num", text: st ? `${st.currency} ${st.gross}` : "—" }),
          el("td", { class: "num", text: st ? `${st.currency} ${st.refunds}` : "—" }),
          el("td", { class: "num", text: st ? `${st.currency} ${st.net}` : "—" }),
          el("td", { class: "num", text: st ? String(st.count) : "0" }),
          el("td", { text: st ? st.lastDate : "" }),
          el("td", {}, i === 0 ? [button("View history", () => ctx.navigate("transactions", { payeeId: p.id }), { small: true })] : []),
        ]));
      })),
    ])]));
  }
  return { element, update };
}
