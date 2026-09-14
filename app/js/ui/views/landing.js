import { el, announce } from "../dom.js";
import { field, input, pickerSelect, button } from "../components.js";
import { openModal } from "../modal.js";
import { AUTH, newIdempotencyKey } from "../../core/api.js";
import { messageFor } from "../../core/errors.js";

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
const KINDS = [{ value: "personal", label: "Personal" }, { value: "household", label: "Household" }, { value: "group", label: "Shared-expense group" }, { value: "trip", label: "Trip" }];

// The fields of a new workspace, shared by the first-workspace page and the "New workspace…"
// dialog, so both ask the same questions the same way. The dropdowns are TaskTracker's command
// picker (BT-004-05): Kind is a short fixed list, so it has no search box; currencies are searched.
function workspaceFields({ kind = "household", placeholder = "For example: Our household" } = {}) {
  const name = input({ required: true, maxlength: "80", placeholder });
  const kindSelect = pickerSelect(KINDS, kind, {}, { search: false });
  const currency = pickerSelect(CURRENCIES.map((c) => ({ value: c, label: c })), "EUR");
  return {
    name,
    controls: [field("Name", name), field("Kind", kindSelect), field("Reporting currency", currency)],
    values: () => ({ name: name.value.trim(), kind: kindSelect.value, reportingCurrency: currency.value }),
  };
}

export function createOnboarding({ store }) {
  const f = workspaceFields();
  const error = el("p", { class: "error-text", role: "alert" });
  const key = newIdempotencyKey();
  const create = button("Create workspace", async () => {
    error.textContent = "";
    create.disabled = true;
    try {
      await store.actions.createWorkspace(f.values(), key);
    } catch (err) {
      error.textContent = messageFor(err);
    } finally { create.disabled = false; }
  }, { variant: "primary" });
  const element = el("section", { class: "landing" }, [
    el("h1", { text: "Create your first workspace" }),
    el("p", { class: "muted", text: "A workspace holds accounts and budgets. You can keep it personal or invite others later; private accounts stay private either way." }),
    el("p", { class: "notice", text: "Were you invited to someone's workspace? Open the invitation link you were sent — it works only for the Google account it was sent to. Site administrators do not see anyone's finances." }),
    el("div", { class: "stack" }, [...f.controls, error, create]),
  ]);
  return { element, update() {} };
}

// Another workspace keeps its own accounts, entries, budgets and members apart — a trip, a side
// business or a shared group. Opened from the account menu at any time; the new workspace becomes
// the current one. One idempotency key per opening, so a double click creates one workspace.
// `name` pre-fills the name, when the workspace picker's "+ New workspace “…”" carries what was
// typed into its search box (BT-004-04).
export function openNewWorkspace({ store, name = "" }) {
  const f = workspaceFields({ kind: "personal", placeholder: "For example: Side business" });
  if (typeof name === "string" && name.trim()) f.name.value = name.trim().slice(0, 80);
  const key = newIdempotencyKey();
  const formId = `new-workspace-${key}`;
  // The footer button belongs to the form, so Enter in a field creates the workspace (UX2-006).
  const create = el("button", { type: "submit", class: "btn btn--primary", text: "Create workspace", form: formId });
  const form = el("form", { class: "form-grid", novalidate: true, id: formId }, f.controls);
  const modal = openModal({
    title: "New workspace",
    body: [
      el("p", { class: "muted", text: "A separate place for accounts, entries and budgets you want to track apart — for example a trip, a side business or a shared group. Nothing moves between workspaces; switch between them at the top of the page." }),
      form,
    ],
    actions: [button("Cancel", () => modal.close()), create],
  });
  async function submit() {
    modal.setError("");
    const values = f.values();
    if (!values.name) {
      f.name.setAttribute("aria-invalid", "true");
      f.name.setAttribute("aria-errormessage", modal.errorId);
      modal.setError("Give the workspace a name.");
      f.name.focus();
      return;
    }
    f.name.removeAttribute("aria-invalid");
    modal.setBusy(true);
    try {
      const workspace = await store.actions.createWorkspace(values, key);
      modal.close();
      announce(`${workspace.name} created. You are now in it.`);
    } catch (err) {
      modal.setBusy(false);
      modal.setError(err);
    }
  }
  create.addEventListener("click", (e) => { e.preventDefault(); void submit(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
  return modal;
}
