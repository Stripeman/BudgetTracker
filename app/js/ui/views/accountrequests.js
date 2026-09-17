// Account requests (BT-014-17, Terry 2026-09-17: "a feature that the site admin can turn off or on
// that enables a request account feature that the site admin approves"). Site-admin only, both
// server-side (GET/PUT /api/site-settings, GET/POST /api/analytics are 401/403 for anyone else) and
// here — the page shows and fetches nothing unless the signed-in person is a site administrator,
// the same pattern as Usage, Design Gallery and Workspaces.
//
// HARD BOUNDARY, deliberately relaxed from the Workspaces directory's own rule: showing a pending
// account's real email and name here is the point — an approval queue is meaningless without
// knowing who is asking. Never anything financial; never a workspace's own contents.
import { el, mount } from "../dom.js";
import { pageHead, badge } from "../components.js";
import { messageFor } from "../../core/errors.js";

const stamp = (iso) => (iso ? String(iso).replace("T", " ").slice(0, 16) : "—");

export function createView(ctx) {
  const { api } = ctx;
  const notAdmin = el("p", { class: "muted", text: "Account requests are only shown to site administrators." });
  const toggleStatus = el("p", { class: "field__help", role: "status" });
  const queueStatus = el("p", { class: "field__help", role: "status" });
  const checkbox = el("input", { type: "checkbox", id: "account-requests-toggle" });
  const queueBox = el("div");
  const content = el("div", { class: "stack", hidden: true }, [
    el("section", { class: "card" }, [
      el("h2", { class: "card__title", text: "Turn account requests on or off" }),
      el("p", { class: "field__help", text: "Off (the default): anyone who signs in can use BudgetTracker immediately. On: a brand-new account waits here for a site administrator to approve it before it can create or join a workspace. Turning this on never affects anyone already using BudgetTracker; turning it off never auto-approves anyone already waiting." }),
      el("div", { class: "field field--inline" }, [checkbox, el("label", { for: "account-requests-toggle", text: "Require site-administrator approval for new accounts" })]),
      toggleStatus,
    ]),
    el("section", { class: "card", "aria-labelledby": "account-requests-queue" }, [
      el("h2", { class: "card__title", id: "account-requests-queue", text: "Waiting for approval" }),
      queueStatus,
      queueBox,
    ]),
  ]);
  const element = el("section", {}, [pageHead("Account requests"), notAdmin, content]);

  async function loadToggle() {
    try {
      const data = await api.siteSettings();
      checkbox.checked = !!data.settings.accountRequestsEnabled;
    } catch (err) {
      toggleStatus.textContent = messageFor(err);
    }
  }

  checkbox.addEventListener("change", () => {
    void (async () => {
      const next = checkbox.checked;
      toggleStatus.textContent = "Saving…";
      try {
        await api.saveSiteSettings({ accountRequestsEnabled: next });
        toggleStatus.textContent = next ? "On: new accounts now wait for approval." : "Off: new accounts are approved immediately.";
      } catch (err) {
        checkbox.checked = !next;
        toggleStatus.textContent = messageFor(err);
      }
    })();
  });

  let queue = null;
  async function loadQueue() {
    queueStatus.textContent = "Loading…";
    try {
      queue = await api.pendingAccounts();
      queueStatus.textContent = queue.truncated ? `Showing the first ${queue.pending.length}.` : "";
      renderQueue();
    } catch (err) {
      queueStatus.textContent = "";
      mount(queueBox, el("p", { class: "error-text", role: "alert", text: messageFor(err) }));
    }
  }

  function act(subject, action) {
    void (async () => {
      try {
        await (action === "approve" ? api.approveAccount(subject) : api.rejectAccount(subject));
        await loadQueue();
      } catch (err) {
        queueStatus.textContent = messageFor(err);
      }
    })();
  }

  function renderQueue() {
    if (!queue) return;
    mount(queueBox, queue.pending.length
      ? el("div", { class: "table-wrap" }, [el("table", { class: "table table--cards", "aria-label": "Accounts waiting for approval" }, [
        el("thead", {}, [el("tr", {}, ["Email", "Name", "Requested", "Actions"].map((h) => el("th", { scope: "col", text: h })))]),
        el("tbody", {}, queue.pending.map((p) => el("tr", {}, [
          el("th", { scope: "row", "data-label": "Email", text: p.email || "—" }),
          el("td", { "data-label": "Name", text: p.name || "—" }),
          el("td", { "data-label": "Requested", text: stamp(p.createdAt) }),
          el("td", { "data-label": "" }, [
            el("button", { type: "button", class: "btn btn--primary btn--small", "aria-label": `Approve ${p.email || p.subject}`, text: "Approve", onClick: () => act(p.subject, "approve") }),
            el("button", { type: "button", class: "btn btn--danger btn--small", "aria-label": `Reject ${p.email || p.subject}`, text: "Reject", onClick: () => act(p.subject, "reject") }),
          ]),
        ]))),
      ])])
      : el("p", { class: "muted small", text: "Nobody is waiting for approval." }));
  }

  let loaded = false;
  function update(state) {
    const isAdmin = !!(state.auth && state.auth.user && state.auth.user.siteAdmin);
    notAdmin.hidden = isAdmin;
    content.hidden = !isAdmin;
    if (isAdmin && !loaded) { loaded = true; void loadToggle(); void loadQueue(); }
  }

  return { element, update };
}
