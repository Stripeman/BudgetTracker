// The Merchant field, using the SAME dropdown component and interaction pattern as Category and
// every other picker in the app (Terry, 2026-09-18, twice: "what i did ask for was the drop down
// to look like that of the category field ... I KEEP CALLING FOR CONSISTENCY"). Built on the shared
// command picker (BT-004-05, app/js/ui/commandpicker.js) via its `allowCustom` extension (A16):
// clicking opens the identical panel every other picker uses, typing searches/filters identically,
// and choosing an existing merchant works identically — this is `pickerSelect()`, nothing bespoke.
//
// The one thing a fixed picklist (Category, Account, Status) never needs: typing a name that
// matches no merchant is kept AS TYPED, never forcing a real merchant record to be created first —
// a bill can be added in one pass, and the typed name resolved later from the Merchants page's
// "Pending merchants" list (BT-014-11, BT-007-01). Replaces the earlier bespoke `merchantpicker.js`
// combobox, which looked like nothing else on the page.
import { pickerSelect } from "./components.js";
import { icon } from "./icons.js";
import { TYPED_OPTION_PREFIX } from "./commandpicker.js";

export { TYPED_OPTION_PREFIX };

// Moved from the retired merchantpicker.js unchanged: used by payees.js to group pending merchant
// names that differ only in case/punctuation/accents under one "Pending merchants" row.
export const normalize = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/&/g, " and ").replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const merchantBadge = (merchants) => (value) => {
  const m = merchants.find((x) => x.id === value);
  return m && m.icon ? icon(m.icon) : null;
};

/**
 * @param {object} o
 * @param {Array<{id, name, icon?}>} o.merchants   choosable merchants (active, usable for this record)
 * @param {{id, name}|null} [o.current]             the record's existing REAL merchant, when linked
 * @param {string} [o.draftName]                    a typed-but-unlinked name already saved — mutually
 *                                                   exclusive with `current` (never both at once)
 * @param {string} [o.placeholder]
 * @param {boolean} [o.allowCustom]  a BILL's own term may be left as a typed, unlinked name (never
 *        forcing a real merchant to be created first, BT-014-11); a real financial record (a
 *        transaction, or recording a bill's actual payment) always needs a real merchant
 *        (BT-007-01), so this defaults to false there.
 * @param {{label: string, onPick: (term: string) => void}} [o.create]
 *        an explicit "create it now" pinned action, the same "+ New X" pattern the Account picker
 *        already uses — independent of `allowCustom`: both may be offered together (a bill's own
 *        editor does), so typing and leaving it is never the ONLY way to resolve it immediately.
 * @returns {HTMLSelectElement} the select — place it with `field()`, exactly like Category/Account
 */
export function createMerchantSelect({ merchants, current = null, draftName = "", placeholder = "Choose a merchant…", allowCustom = false, create = null } = {}) {
  const options = merchants.map((m) => ({ value: m.id, label: m.name }));
  let value = "";
  if (current) {
    value = current.id;
    // The current merchant may not be in the choosable list yet (an account change, or a merchant
    // this record already used before it was closed) — still shown, exactly as merchantpicker.js
    // did before this, never silently dropped.
    if (!options.some((o) => o.value === current.id)) options.push({ value: current.id, label: current.name });
  } else if (draftName) {
    value = `${TYPED_OPTION_PREFIX}${draftName}`;
    options.push({ value, label: draftName });
  }
  // Always searchable, never "auto": unlike a closed picklist (Category, Account), typing IS how a
  // brand-new name is entered here, so the search box must exist even when the merchant list is
  // short — a plain closed list only offers letter-at-a-time type-ahead among EXISTING options,
  // with no surface for free text at all.
  return pickerSelect(options, value, {}, { placeholder, allowCustom, create, search: true, badgeOf: merchantBadge(merchants) });
}

/**
 * Rebuilds the choosable merchant list (an account change) without losing a typed draft in
 * progress — the single reusable draft option (commandpicker.js A16) is left untouched; only the
 * real merchant options are replaced. A previously chosen real merchant that is no longer
 * choosable is cleared, exactly like the Category/Account pickers already do elsewhere.
 */
export function setMerchantOptions(select, merchants) {
  const kept = Array.from(select.querySelectorAll("option")).filter((o) => String(o.getAttribute("value") || "").startsWith(TYPED_OPTION_PREFIX));
  for (const o of Array.from(select.querySelectorAll("option"))) {
    if (!kept.includes(o)) select.removeChild(o);
  }
  for (const m of merchants) {
    const o = document.createElement("option");
    o.setAttribute("value", m.id);
    o.textContent = m.name;
    select.appendChild(o);
  }
  const stillReal = merchants.some((m) => m.id === select.value);
  const isDraft = kept.some((o) => (o.getAttribute("value") || "") === select.value);
  if (!stillReal && !isDraft) select.value = "";
}

/** Reads the current choice: a real merchant id, or a typed draft name — never both at once. */
export function readMerchantSelect(select) {
  const v = select.value;
  if (!v) return { payeeId: null, payeeDraftName: "" };
  if (v.startsWith(TYPED_OPTION_PREFIX)) {
    const opt = Array.from(select.querySelectorAll("option")).find((o) => (o.getAttribute("value") || "") === v);
    return { payeeId: null, payeeDraftName: opt ? opt.textContent : "" };
  }
  return { payeeId: v, payeeDraftName: "" };
}

/** Sets the select to a specific real merchant (after inline/pending creation resolves it). */
export function selectMerchant(select, merchant) {
  if (!Array.from(select.querySelectorAll("option")).some((o) => (o.getAttribute("value") || "") === merchant.id)) {
    const o = document.createElement("option");
    o.setAttribute("value", merchant.id);
    o.textContent = merchant.name;
    select.appendChild(o);
  }
  select.value = merchant.id;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}
