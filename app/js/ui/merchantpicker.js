// Searchable merchant picker (BT-007-01). Merchants are chosen from the managed directory by id —
// never typed as free text — so the control is an ARIA 1.2 combobox: an input that filters a
// listbox of merchants, with the active option announced through aria-activedescendant.
//
// Keyboard: typing filters and opens the list; ArrowDown/ArrowUp move; Enter chooses; Escape
// closes the list (the dialog's Escape waits until the list is closed); Tab leaves. A pointer pick
// keeps focus in the input. The last option, when the text matches no merchant exactly, is
// "Add … as a new merchant", which hands the typed name to `onRequestCreate` so the surrounding
// form can create one inline without losing what was already entered.
//
// The list is rendered in the normal flow under the input (as in TaskTracker's theme picker), so
// it is never clipped by a scrolling dialog body.
import { el } from "./dom.js";
import { uid } from "./components.js";
import { icon } from "./icons.js";

export const normalize = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/&/g, " and ").replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * @param {object} o
 * @param {Array<{id,name,aliases?,visibility?}>} o.merchants  choosable merchants (active, usable)
 * @param {{id,name}|null} [o.current]  the record's existing merchant, shown even if no longer choosable
 * @param {(m: object|null) => void} [o.onChange]
 * @param {((name: string) => void)|null} [o.onRequestCreate]
 */
export function createMerchantPicker({ merchants, current = null, onChange = () => {}, onRequestCreate = null, id = uid("merchant") }) {
  const listId = `${id}-list`;
  let items = merchants.slice();
  let selected = current;
  let shown = [];
  let rows = [];
  let active = -1;
  let open = false;

  const input = el("input", {
    class: "field__input", id, type: "text", role: "combobox", autocomplete: "off", spellcheck: "false",
    "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": listId,
    placeholder: "Search your merchants",
  });
  input.value = selected ? selected.name : "";
  const list = el("ul", { class: "combo__list", id: listId, role: "listbox", "aria-label": "Matching merchants", hidden: true });

  const query = () => input.value.trim();
  const hasExact = () => shown.some((m) => normalize(m.name) === normalize(query()));
  const canCreate = () => !!onRequestCreate && !!query() && !hasExact();
  const count = () => shown.length + (canCreate() ? 1 : 0);

  function filter() {
    const n = normalize(query());
    const all = n ? items.filter((m) => [m.name, ...(m.aliases || [])].some((x) => normalize(x).includes(n))) : items;
    return all.slice(0, 50);
  }

  function render() {
    shown = filter();
    rows = shown.map((m, i) => el("li", {
      id: `${id}-opt-${i}`, role: "option", class: ["combo__option", i === active ? "combo__option--active" : ""],
      "aria-selected": selected && selected.id === m.id ? "true" : "false", dataset: { index: String(i) },
    }, [icon(m.icon || "store"), el("span", { text: m.name }), m.visibility === "private" ? el("span", { class: "muted small", text: " · private" }) : null]));
    if (canCreate()) {
      rows.push(el("li", {
        id: `${id}-opt-new`, role: "option", class: ["combo__option", "combo__option--create", active === shown.length ? "combo__option--active" : ""],
        "aria-selected": "false", dataset: { index: String(shown.length) }, text: `Add “${query()}” as a new merchant`,
      }));
    }
    if (rows.length) list.replaceChildren(...rows);
    // Announced as a disabled option, so a screen reader hears the empty result (A11Y2-008).
    else list.replaceChildren(el("li", { class: "combo__empty", role: "option", "aria-disabled": "true", "aria-selected": "false", id: `${id}-opt-none`, text: "No matching merchants." }));
    const activeRow = active >= 0 ? rows[active] : null;
    if (activeRow) {
      input.setAttribute("aria-activedescendant", activeRow.id);
      if (typeof activeRow.scrollIntoView === "function") activeRow.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }

  function setOpen(next) {
    open = !!next;
    list.hidden = !open;
    input.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open) { active = -1; input.removeAttribute("aria-activedescendant"); } else render();
  }

  function choose(index) {
    if (index === shown.length && canCreate()) { const name = query(); setOpen(false); onRequestCreate(name); return; }
    const m = shown[index];
    if (!m) return;
    selected = m;
    input.value = m.name;
    setOpen(false);
    onChange(m);
  }

  input.addEventListener("input", () => {
    if (selected && input.value !== selected.name) { selected = null; onChange(null); }
    active = -1;
    setOpen(true);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      active = Math.min(active + 1, count() - 1);
      render();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (open && count()) { active = Math.max(active - 1, 0); render(); }
    } else if (e.key === "Enter") {
      if (open && active >= 0) { e.preventDefault(); choose(active); }
    } else if (e.key === "Escape") {
      if (open) { e.preventDefault(); setOpen(false); }
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  });
  input.addEventListener("blur", () => setOpen(false));
  // Keep focus in the input on a pointer pick so the blur above does not close the list first.
  list.addEventListener("mousedown", (e) => e.preventDefault());
  list.addEventListener("click", (e) => {
    const row = e.target && e.target.closest ? e.target.closest("[data-index]") : null;
    if (row) choose(Number(row.dataset.index));
  });

  return {
    element: el("div", { class: "combo" }, [input, list]),
    input,
    getValue: () => (selected ? selected.id : null),
    getSelected: () => selected,
    setItems(next) { items = next.slice(); if (open) render(); },
    select(m) { selected = m; input.value = m ? m.name : ""; setOpen(false); onChange(m); },
  };
}
