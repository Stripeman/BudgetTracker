import { el } from "../dom.js";
import { field, input, select, button } from "../components.js";
import { AUTH, newIdempotencyKey } from "../../core/api.js";

// The signed-out page is a real main landmark with the skip link's target (A11Y-013).
export function renderLanding() {
  return el("main", { class: "landing", id: "main", tabindex: "-1" }, [
    el("h1", { class: "landing__title", text: "BudgetTracker" }),
    el("p", { text: "Private budgeting for individuals, households and travel groups." }),
    el("ul", { class: "landing__points" }, [
      el("li", { text: "Your financial records are private by default. Sharing is explicit, per account." }),
      el("li", { text: "Household members see only what is shared with them — never your private accounts." }),
      el("li", { text: "Site administrators run the service but cannot see anyone's finances." }),
    ]),
    el("a", { class: "btn btn--primary", href: AUTH.login("/"), text: "Sign in with Google" }),
  ]);
}

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "CAD", "AUD", "NZD", "JPY", "SGD", "HKD", "INR", "ZAR"];

export function createOnboarding({ store }) {
  const name = input({ required: true, maxlength: "80", placeholder: "For example: Our household" });
  const kind = select([{ value: "personal", label: "Personal" }, { value: "household", label: "Household" }, { value: "group", label: "Shared-expense group" }, { value: "trip", label: "Trip" }], "household");
  const currency = select(CURRENCIES.map((c) => ({ value: c, label: c })), "EUR");
  const error = el("p", { class: "error-text", role: "alert" });
  const key = newIdempotencyKey();
  const create = button("Create workspace", async () => {
    error.textContent = "";
    create.disabled = true;
    try {
      await store.actions.createWorkspace({ name: name.value, kind: kind.value, reportingCurrency: currency.value }, key);
    } catch (err) {
      error.textContent = err.message || "The workspace could not be created.";
    } finally { create.disabled = false; }
  }, { variant: "primary" });
  const element = el("section", { class: "landing" }, [
    el("h1", { text: "Create your first workspace" }),
    el("p", { class: "muted", text: "A workspace holds accounts and budgets. You can keep it personal or invite others later; private accounts stay private either way." }),
    el("p", { class: "notice", text: "Were you invited to someone's workspace? Open the invitation link you were sent — it works only for the Google account it was sent to. Site administrators do not see anyone's finances." }),
    el("div", { class: "stack" }, [field("Name", name), field("Kind", kind), field("Reporting currency", currency), error, create]),
  ]);
  return { element, update() {} };
}
