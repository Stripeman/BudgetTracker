// BT-014-04: the one reusable impact-review / double-confirmation dialog for permanent deletion,
// used identically by every record type (accounts, transactions, merchants, categories, recurring
// bills, budgets, workspace contacts — api/_shared/deletion.js) and, through a second entry point
// below, whole-workspace permanent deletion (owner and site administrator).
//
// Flow: fetch the impact -> show it in plain language, with no enabled path forward while it is
// blocked -> if Shared expenses are involved, offer a download of the authorized data first
// (Terry, 2026-09-17: optional, never itself executes or confirms deletion; a failed download
// keeps the dialog open for retry) -> re-fetch the impact fresh right before the second
// confirmation, so a review left open a while is never acted on stale (the server's own stale-
// token refusal is still the final guard and is surfaced in plain language, not as a generic
// error) -> type the exact confirmation phrase -> execute.
import { el, mount, announce } from "./dom.js";
import { openModal } from "./modal.js";
import { field, input, button } from "./components.js";
import { messageFor } from "../core/errors.js";

function cascadeText(g) {
  const noun = g.type === "recurring" ? "bill" : g.type === "transactions" ? "entr" : g.type;
  const plural = g.count === 1 ? (g.type === "transactions" ? "y" : "") : (g.type === "transactions" ? "ies" : "s");
  return `${g.count} ${noun}${plural} will be permanently deleted with it${g.reason ? ` — ${g.reason}` : ""}.`;
}
function severedText(s) {
  return `${s.count} ${s.type}${s.count === 1 ? "" : "s"} will keep everything else and only lose the link.`;
}
function cleanupText(c) {
  if (c.type === "grant") return `${c.count} access grant${c.count === 1 ? "" : "s"} on it will be removed (they mean nothing without it).`;
  if (c.type === "group-link") return `Its Shared-expenses link will be disconnected. Shared expenses ${c.count === 1 ? "it made" : "they made"} stay exactly as they are for everyone else — only the link to this deleted item is removed.`;
  return `${c.count} related item${c.count === 1 ? "" : "s"} will be cleaned up automatically.`;
}

const DATASET_LABEL = {
  accounts: "account", transactions: "entry", payees: "merchant", categories: "category",
  recurring: "recurring bill", budgets: "budget", contacts: "contact", grants: "access grant",
  invitations: "invitation", groupExpenses: "Shared expense", groupSettlements: "Shared-expenses payment",
  groupLedgers: "Shared-expenses ledger link", members: "member",
};
function datasetPlural(key, count) {
  const noun = DATASET_LABEL[key] || key;
  if (count === 1) return noun;
  return /y$/.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`;
}

// Whole-workspace impact (api/_shared/workspace-deletion.js) has a different shape from a
// per-record impact: dataset COUNTS by key, not cascade/severed/autoCleanup groups.
function workspaceImpactBody(impact) {
  const entries = Object.entries(impact.datasets || {}).filter(([, count]) => count > 0);
  if (!entries.length) return [el("p", { text: "This workspace is empty. It will be permanently deleted alone." })];
  return [
    el("p", { text: "Everything in this workspace will be permanently deleted:" }),
    el("ul", { class: "stack" }, entries.map(([key, count]) => el("li", { text: `${count} ${datasetPlural(key, count)}` }))),
  ];
}

// The impact, in plain language: what is permanently deleted, what only loses a pointer, what
// blocks it. A blocked operation never shows an enabled path forward (BT-014-04 requirement 1).
function impactBody(impact) {
  const rows = [];
  if (impact.blocked) {
    rows.push(el("div", { class: "state state--error", role: "alert" }, [
      el("strong", { text: "This cannot be permanently deleted yet." }),
      el("ul", { class: "stack" }, impact.blockers.map((b) => el("li", { text: b }))),
    ]));
    return rows;
  }
  if (impact.datasets && !impact.cascade) return workspaceImpactBody(impact);
  if (!impact.cascade.length && !impact.severed.length && !(impact.autoCleanup || []).length && !(impact.together || []).length) {
    rows.push(el("p", { text: "Nothing else references this. It will be permanently deleted alone." }));
  }
  if (impact.together && impact.together.length) {
    rows.push(el("p", { text: `Its linked entry (the other leg of the same transfer or reversal) is removed together with it, as one event.` }));
  }
  for (const g of impact.cascade) rows.push(el("p", { text: cascadeText(g) }));
  for (const s of impact.severed) rows.push(el("p", { text: severedText(s) }));
  for (const c of impact.autoCleanup || []) rows.push(el("p", { text: cleanupText(c) }));
  rows.push(el("p", { class: "muted small", text: "Its own history (who created, changed or archived it) survives with the audit trail. This cannot be undone once confirmed." }));
  return rows;
}

// Terry, 2026-09-17: "Before either deletion or disconnection, offer the deleting workspace a
// download of its authorized shared-expense information... Downloading is optional and must not
// execute or confirm deletion... If a download fails, keep the dialog open for retry."
//
// `content` is plain text for CSV/JSON and a base64 string for XLSX/PDF (BT-014-06): the shared
// HTTP responder always JSON-encodes `body`, so binary bytes travel as base64 and are decoded back
// to raw bytes here before building the Blob — see api/_shared/sharedexport.js and
// api/group/handler.js's `exportReport`.
function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export function downloadFile(name, mime, content, encoding = "text") {
  const blob = new Blob([encoding === "base64" ? base64ToBytes(content) : content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function offerGroupDownload(ctx, modal, wsId, onDone) {
  const status = el("p", { class: "muted small", role: "status" });
  const doDownload = async (format) => {
    status.textContent = `Preparing the ${format.toUpperCase()} download…`;
    try {
      const out = await ctx.api.sharedExport(wsId, format);
      downloadFile(out.filename, out.mime, out.content, out.encoding);
      status.textContent = "Downloaded.";
      announce("Shared-expenses information downloaded.");
      onDone();
    } catch (err) {
      modal.setError(`The download failed. ${messageFor(err)} You can try again, or continue without downloading.`);
    }
  };
  return el("div", { class: "stack" }, [
    el("p", { text: "This is linked to Shared expenses. Before continuing, you can download the authorized shared-expense information (participants, dates, descriptions, currencies, amounts, splits, settlements and outstanding balances) for your records." }),
    el("div", { class: "row" }, [
      button("Download as CSV", () => doDownload("csv")),
      button("Download as JSON", () => doDownload("json")),
      button("Download as XLSX", () => doDownload("xlsx")),
      button("Download as PDF", () => doDownload("pdf")),
      button("Continue without downloading", () => onDone(), { variant: "ghost" }),
    ]),
    status,
  ]);
}

// `fetchImpact()` -> impact; `execute(impact, typedConfirmation)` -> server result (throws ApiError
// on failure, including a stale-token 409 the caller should re-fetch on). `wsIdForExport`, when
// given, offers the Shared-expenses download step whenever `impact.groupInvolved` is true.
export function openDeleteDialog(ctx, {
  title, fetchImpact, execute, wsIdForExport = null, deleteLabel = "Permanently delete",
  onDeleted = () => {}, danger = true,
  // An extra acknowledgement screen shown once, after the impact is reviewed and BEFORE the
  // Shared-expenses download offer / confirmation step — used by the whole-workspace flow for its
  // stronger permanent-action warning and the workspace-backup offer. `render(impact, next)` must
  // call `next()` itself when the person is ready to continue (it owns its own footer).
  extraStep = null,
}) {
  const body = el("div", { class: "stack" }, [el("p", { role: "status", text: "Checking what this would affect…" })]);
  const modal = openModal({ title, body: [body], actions: [button("Cancel", () => modal.close())] });

  // Each step's own primary action gets focus once it appears (never left on a control that was
  // just replaced, and never silently on the page body): the same rule openModal itself uses when
  // it first opens, applied again at every step transition inside this one dialog.
  function renderFoot(nodes) {
    const foot = modal.element.querySelector(".modal__foot");
    const wanted = nodes.filter(Boolean);
    // mount() always rebuilds these (button() makes a new node every call), so a fresh Cancel
    // button replaces the old one on every render — focus must move to whichever button is
    // actually mounted, every time, never left implicit. Without this, calling renderFoot([])
    // (both loading interstitials, and permanently in the blocked-record terminal state — no
    // further render ever follows there) silently dropped focus to <body>, outside the open
    // dialog (accessibility review finding, 2026-09-17).
    const cancelBtn = button("Cancel", () => modal.close());
    mount(foot, cancelBtn, ...wanted);
    (wanted.length ? wanted[wanted.length - 1] : cancelBtn).focus();
  }

  async function loadAndShowStep1() {
    modal.setError("");
    mount(body, el("p", { role: "status", text: "Checking what this would affect…" }));
    renderFoot([]);
    let impact;
    try {
      impact = await fetchImpact();
    } catch (err) {
      mount(body, el("div", { class: "state state--error", role: "alert", text: `This could not be checked. ${messageFor(err)}` }));
      renderFoot([button("Try again", () => loadAndShowStep1())]);
      return;
    }
    mount(body, ...impactBody(impact));
    if (impact.blocked) { renderFoot([]); return; }
    renderFoot([button("Continue", () => advance(), { variant: danger ? "danger" : "primary" })]);
  }

  // Re-fetches right before the destructive path, so a review left open a while (or anything that
  // changed underneath it) is never acted on stale; the server's own stale-token refusal at the
  // final confirmation is still the last guard either way.
  async function advance() {
    modal.setError("");
    mount(body, el("p", { role: "status", text: "Checking once more before continuing…" }));
    renderFoot([]);
    let impact;
    try {
      impact = await fetchImpact();
    } catch (err) {
      mount(body, el("div", { class: "state state--error", role: "alert", text: `This could not be checked. ${messageFor(err)}` }));
      renderFoot([button("Try again", () => loadAndShowStep1())]);
      return;
    }
    if (impact.blocked) { mount(body, ...impactBody(impact)); renderFoot([]); return; }
    // Accepts an optional fresher impact (bug fix, 2026-09-17): an extraStep can itself change the
    // workspace document before the user reaches confirmation — taking a backup writes its own
    // audit entry into the workspace doc (api/backups/handler.js), which bumps doc.revision and
    // makes the impact token fetched before it stale. Without re-fetching, confirming would always
    // fail with delete_impact_stale, and its recovery path (loadAndShowStep1) sends the user all
    // the way back to the start, re-showing this same extraStep — an infinite loop for anyone who
    // takes a backup first. extraStep now gets `refreshImpact` to re-fetch and pass the current
    // impact into toConfirm explicitly, so the token it confirms with always matches.
    const toConfirm = (current = impact) => {
      if (current.groupInvolved && wsIdForExport) {
        const offer = offerGroupDownload(ctx, modal, wsIdForExport, () => showConfirmStep(current));
        mount(body, ...impactBody(current), offer);
        renderFoot([]);
        const first = offer.querySelector("button");
        if (first) first.focus();
        return;
      }
      showConfirmStep(current);
    };
    if (extraStep) {
      extraStep(impact, { setBody: (nodes) => mount(body, ...nodes), setFoot: renderFoot, toConfirm, refreshImpact: fetchImpact });
      return;
    }
    toConfirm();
  }

  function showConfirmStep(impact) {
    modal.setError("");
    const typed = input({ autocomplete: "off" });
    const match = () => typed.value.trim().toLowerCase() === String(impact.confirmPhrase || "").trim().toLowerCase();
    const confirmBtn = button(deleteLabel, async () => {
      modal.setError("");
      typed.removeAttribute("aria-errormessage");
      if (!match()) {
        typed.setAttribute("aria-invalid", "true");
        // Links the field to the error text, same pattern as every other inline validation error
        // in this app (accounts.js, transactions.js, group.js, ...) — without it, a screen-reader
        // user who tabs away and back gets only "invalid entry," never the specific message
        // (accessibility review finding, 2026-09-17).
        typed.setAttribute("aria-errormessage", modal.errorId);
        modal.setError(`Type "${impact.confirmPhrase}" exactly to confirm.`);
        typed.focus();
        return;
      }
      typed.removeAttribute("aria-invalid");
      modal.setBusy(true);
      try {
        await execute(impact, typed.value.trim());
        modal.setBusy(false);
        announce("Permanently deleted.");
        modal.close();
        onDeleted();
      } catch (err) {
        modal.setBusy(false);
        if (err && err.code === "delete_impact_stale") {
          modal.setError("What this would affect has changed since you reviewed it. Reviewing it again.");
          await loadAndShowStep1();
          return;
        }
        typed.setAttribute("aria-invalid", "true");
        typed.setAttribute("aria-errormessage", modal.errorId);
        modal.setError(err);
      }
    }, { variant: danger ? "danger" : "primary" });
    mount(body,
      el("p", { text: `Type "${impact.confirmPhrase}" to confirm. This permanently deletes it and cannot be undone.` }),
      field(`Type "${impact.confirmPhrase}" to confirm`, typed));
    renderFoot([confirmBtn]);
    typed.focus();
  }

  loadAndShowStep1();
  return modal;
}

// BT-014-02/04: whole-workspace PERMANENT deletion (owner only), an explicit exception to the
// per-record cascade restriction, built to be UNMISTAKABLY distinct from the existing recoverable
// "Delete workspace" (archive) action already in Settings — Terry's spec's own flagged
// terminology risk. Adds, on top of the generic flow: a strong permanent-action warning, an offer
// to take a restorable encrypted backup first (the existing /api/backups, entirely separate from
// the Shared-expenses download), then the same Shared-expenses download offer and two-step
// confirmation as every other type.
export function openWorkspacePermanentDeleteDialog(ctx, { wsId, onDeleted = () => {} }) {
  return openDeleteDialog(ctx, {
    title: "Permanently delete this workspace",
    deleteLabel: "Permanently delete workspace",
    danger: true,
    fetchImpact: async () => (await ctx.api.permanentDeleteImpact("workspaces", { id: wsId }, {})).impact,
    execute: async (impact, typedConfirmation) => {
      const out = await ctx.store.actions.permanentlyDeleteWorkspace(wsId, impact.token, typedConfirmation);
      if (!out.ok) throw out.error;
    },
    wsIdForExport: wsId,
    extraStep: (impact, { setBody, setFoot, toConfirm, refreshImpact }) => {
      const status = el("p", { class: "muted small", role: "status" });
      const warning = () => el("div", { class: "state state--error permdelete-warning", role: "alert" }, [
        el("strong", { text: "This cannot be undone." }),
        el("p", { text: "Once confirmed, this workspace — its accounts, entries, merchants, categories, bills, budgets, contacts and Shared expenses — is gone for good. This is NOT the recoverable \"Delete workspace\" action in Settings; there is no \"Bring back\" for this." }),
        el("p", { text: "If you have not backed it up, you can take a restorable encrypted backup first." }),
      ]);
      const render = () => setBody([warning(), ...impactBody(impact), status]);
      // Bug fix (2026-09-17): taking a backup writes its own audit entry into the workspace
      // document, which changes what "the impact reviewed" was computed against — re-fetch it
      // fresh before confirming, or the server correctly (but unhelpfully, from the user's side)
      // refuses as stale every time, bouncing the whole dialog back to its very first step. This
      // was previously confirmed with the impact captured before the backup — always stale.
      const backupNow = async () => {
        status.textContent = "Taking a backup…";
        render();
        try {
          await ctx.api.createBackup(wsId);
          status.textContent = "Backup taken. Reviewing what this would affect once more before you confirm…";
          render();
          const fresh = await refreshImpact();
          if (fresh.blocked) { setBody(impactBody(fresh)); setFoot([]); return; }
          status.textContent = "Backup taken. You can restore it later from Workspace → Backups, as long as you still have access to a workspace to restore into.";
          announce("Backup taken.");
          setBody([warning(), ...impactBody(fresh), status]);
          setFoot([button("Continue", () => toConfirm(fresh), { variant: "danger" })]);
        } catch (err) {
          status.textContent = "";
          setBody([warning(), ...impactBody(impact), el("p", { class: "state state--error", role: "alert", text: `The backup could not be taken. ${messageFor(err)} You can try again, or continue without one.` })]);
          setFoot([button("Try the backup again", () => backupNow()), button("Continue without a backup", () => toConfirm(), { variant: "ghost" })]);
        }
      };
      render();
      setFoot([
        button("Take a backup first", () => backupNow()),
        button("Continue without a backup", () => toConfirm(), { variant: "ghost" }),
      ]);
    },
    onDeleted,
  });
}
