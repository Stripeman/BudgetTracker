// Site-admin workspace directory and administrative permanent deletion (BT-014-03/04). Site-admin
// only, both server-side (`GET/POST /api/analytics` is 401/403 for anyone else) and here — the
// page shows and fetches nothing unless the signed-in person is a site administrator, extending
// the same small site-admin surface as Usage (analytics.js) and the Design Gallery rather than a
// new nav paradigm.
//
// HARD BOUNDARY: the directory returns operational metadata only — id, kind, status, timestamps,
// active member count and email, per-dataset record COUNTS and an approximate document size. Never
// a workspace name, balance, account, transaction, merchant, budget or contact. This view never
// tries to add one. Member email is a deliberate exception (Terry, 2026-09-17) to the earlier
// "no name or email" boundary — see api/analytics/handler.js's directory() comment.
import { el, mount } from "../dom.js";
import { pageHead, badge } from "../components.js";
import { messageFor } from "../../core/errors.js";
import { openDeleteDialog } from "../permanentdelete.js";

const WS_KIND_LABEL = { personal: "Personal", household: "Household", group: "Shared-expense group", trip: "Trip" };
const stamp = (iso) => (iso ? String(iso).replace("T", " ").slice(0, 16) : "—");
const bytes = (n) => (n === undefined || n === null ? "—" : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);

function datasetSummary(datasets) {
  if (!datasets) return "—";
  const parts = Object.entries(datasets).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`);
  return parts.length ? parts.join(", ") : "empty";
}

export function createView(ctx) {
  const { api } = ctx;
  const notAdmin = el("p", { class: "muted", text: "The workspace directory is only shown to site administrators." });
  const status = el("p", { class: "field__help", role: "status" });
  const listBox = el("div");
  const content = el("div", { class: "stack", hidden: true }, [
    el("p", { class: "field__help", text: "Operational metadata only — id, kind, status, timestamps, member count/email and record counts. Site administration never sees a workspace's name, balances, accounts, entries, merchants, budgets or contacts. A permanent deletion here can never do anything different to a workspace than its own owner could; it only reaches workspaces you are not a member of." }),
    status,
    listBox,
  ]);
  const element = el("section", {}, [pageHead("Workspaces"), notAdmin, content]);

  let data = null;
  async function load() {
    status.textContent = "Loading…";
    try {
      data = await api.workspaceDirectory();
      status.textContent = data.truncated ? `Showing the first ${data.workspaces.length} workspaces.` : "";
      render();
    } catch (err) {
      status.textContent = "";
      mount(listBox, el("p", { class: "error-text", role: "alert", text: messageFor(err) }));
    }
  }

  function openImpact(ws) {
    openDeleteDialog(ctx, {
      title: `Permanently delete workspace ${ws.id}?`,
      deleteLabel: "Permanently delete workspace",
      fetchImpact: async () => (await api.permanentDeleteImpact("analytics", { workspaceId: ws.id }, {})).impact,
      execute: async (impact, typedConfirmation) => {
        await api.permanentDeleteExecute("analytics", { workspaceId: ws.id }, { impactToken: impact.token, typedConfirmation });
      },
      onDeleted: () => void load(),
    });
  }

  function render() {
    if (!data) return;
    mount(listBox, data.workspaces.length
      ? el("div", { class: "table-wrap" }, [el("table", { class: "table table--cards", "aria-label": "Workspaces" }, [
        el("thead", {}, [el("tr", {}, ["Id", "Kind", "Status", "Members", "Records", "Approx. size", "Created", "Actions"].map((h) => el("th", { scope: "col", text: h })))]),
        el("tbody", {}, data.workspaces.map((ws) => el("tr", {}, [
          el("th", { scope: "row", "data-label": "Id", text: ws.id }),
          el("td", { "data-label": "Kind", text: WS_KIND_LABEL[ws.kind] || ws.kind }),
          el("td", { "data-label": "Status" }, [ws.status === "active" ? badge("Active") : badge(ws.status, "closed")]),
          el("td", { "data-label": "Members" }, [
            el("div", { class: "num", text: String(ws.memberCount) }),
            ws.memberEmails && ws.memberEmails.length ? el("div", { class: "muted small", text: ws.memberEmails.join(", ") }) : null,
          ]),
          el("td", { "data-label": "Records", text: datasetSummary(ws.datasets) }),
          el("td", { "data-label": "Approx. size", class: "num", text: bytes(ws.approxBytes) }),
          el("td", { "data-label": "Created", text: stamp(ws.createdAt) }),
          el("td", { "data-label": "" }, [el("button", { type: "button", class: "btn btn--danger btn--small", "aria-label": `Permanently delete workspace ${ws.id}`, text: "Delete permanently", onClick: () => openImpact(ws) })]),
        ]))),
      ])])
      : el("p", { class: "muted small", text: "No workspaces yet." }));
  }

  let loaded = false;
  function update(state) {
    const isAdmin = !!(state.auth && state.auth.user && state.auth.user.siteAdmin);
    notAdmin.hidden = isAdmin;
    content.hidden = !isAdmin;
    if (isAdmin && !loaded) { loaded = true; void load(); }
  }

  return { element, update };
}
