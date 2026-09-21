// The application chrome: header (brand, workspace picker, account menu), view navigation, main
// region and a footer that always names the version and environment.
//
// THE ACCOUNT MENU IS BUILT ONCE and refreshed in place, never rebuilt on a store commit. This is
// TaskTracker's lesson from RF-20260909-25: rebuilding the menu on every render made the day/night
// control disappear at the exact moment somebody used it. The control is also subscribed to the
// theme controller, so it redraws when the device switches light/dark while it follows the device
// (A11Y-001).
//
// The menu is a disclosure (button + panel), not an ARIA menu: aria-expanded/aria-controls, closes
// on Escape (focus returns to the button), on an outside click and when focus leaves it.
import { el, mount, clear, focusFirst, announce } from "./dom.js";
import { createDayNightControl } from "./daynight.js";
import { initials, button } from "./components.js";
import { withIcon } from "./icons.js";
import { createThemePicker } from "./themepicker.js";
import { createWorkspacePicker } from "./workspacepicker.js";
import { createStagingMenuEntry, openPersonalStagingEditor } from "./staginglink.js";
import { AUTH } from "../core/api.js";
import { ROUTES, navRoutes } from "../core/router.js";
import { sharedExpensesOn } from "../core/workspacesettings.js";
import { Status } from "../core/store.js";
import { layoutMeta } from "../core/layoutmeta.js";

import * as dashboard from "./views/dashboard.js";
import * as transactions from "./views/transactions.js";
import * as bills from "./views/bills.js";
import * as planning from "./views/planning.js";
import * as accounts from "./views/accounts.js";
import * as payees from "./views/payees.js";
import * as settings from "./views/settings.js";
import * as workspace from "./views/workspace.js";
import * as join from "./views/join.js";
import * as group from "./views/group.js";
import * as analytics from "./views/analytics.js";
import * as gallery from "./views/gallery.js";
import * as adminWorkspaces from "./views/adminworkspaces.js";
import * as accountRequests from "./views/accountrequests.js";
import { renderLanding, createOnboarding, openNewWorkspace } from "./views/landing.js";
import { messageFor } from "../core/errors.js";
import { confirmModal } from "./modal.js";
import { unsavedNames, clearUnsaved } from "../core/unsaved.js";

const VIEWS = { dashboard, group, transactions, bills, planning, accounts, payees, settings, workspace, join, analytics, gallery, "admin-workspaces": adminWorkspaces, "account-requests": accountRequests };

// Shared expenses turned off (workspace settings, Terry 2026-09-14): the page says so and loads nothing;
// the server refuses /api/group as well. Nothing recorded is removed. The message follows the current
// reason (the site's switch or the workspace's setting) on every update.
const SHARED_EXPENSES_OFF = {
  createView(ctx) {
    const notice = el("p", { class: "notice" });
    // A way back (UX/accessibility review of eefd115, finding 9): owners and managers go straight to the
    // setting; everyone else is told whom to ask. A site switch-off is not the workspace's to undo.
    const wayBack = el("div", { class: "row" });
    const view = {
      element: el("section", {}, [el("div", { class: "page-head" }, [el("h1", { text: "Shared expenses" })]), notice, wayBack]),
      update(state) {
        const site = state && state.site;
        const siteOff = !!(site && site.modules && site.modules.sharedExpenses === false);
        const ws = ((state && state.workspaces) || []).find((w) => w.id === state.selectedWorkspaceId);
        const manages = !!ws && (ws.role === "owner" || ws.role === "manager");
        notice.textContent = siteOff
          ? "Shared expenses are turned off for this site by the site administrator. Nothing recorded has been removed."
          : "Shared expenses are turned off in this workspace. Nothing recorded has been removed.";
        mount(wayBack, siteOff ? null : manages
          ? el("a", { class: "btn btn--primary", href: "#/workspace?setting=sharedExpenses", text: "Open Workspace settings" })
          : el("p", { class: "muted", text: "Ask an owner or manager to turn it on." }));
      },
    };
    view.update(ctx.state);
    return view;
  },
};

// A pending or rejected account (BT-014-17, account requests): built once per state, the same
// "static screen, no app chrome" pattern as the signed-out landing page — nothing else to show or
// navigate to either way. Signing out is the only action offered; there is nothing more to do here
// until a site administrator acts.
function renderPendingApproval({ rejected }) {
  return el("main", { class: "landing", id: "main", tabindex: "-1" }, [
    el("h1", { text: rejected ? "Account request not approved" : "Waiting for approval" }),
    el("p", { text: rejected
      ? "A site administrator did not approve your account request. If you believe this is a mistake, contact a site administrator."
      : "A site administrator needs to approve your account before you can use BudgetTracker. There is nothing more to do here — you will be able to continue as soon as that happens." }),
    el("p", {}, [el("a", { class: "btn", href: AUTH.logout, text: "Sign out" })]),
  ]);
}

// Usage (BT-012-01), Design Gallery (BT-013), the Workspaces directory (BT-014-03/04) and Account
// requests (BT-014-17) are not workspace sections, so navRoutes() leaves them out of the main nav
// (like "join"). Terry, 2026-09-17: grouped under one "Site Settings" entry with its own sub-tab
// row, instead of flat top-level items — each route, view, test and URL is unchanged; only how it
// is reached changed.
const SITE_ADMIN_ROUTE_IDS = Object.freeze(new Set(["analytics", "gallery", "admin-workspaces", "account-requests"]));

export function createShell({ mountPoint, store, router, theme, api }) {
  const header = el("header", { class: "app__header" });
  const nav = el("nav", { class: "app__nav", "aria-label": "Sections" });
  const siteAdminNav = el("nav", { class: "app__nav app__nav--sub", "aria-label": "Site administration" });
  // BT-013-16: the full-size Layout Preview banner — present on every page while a preview is
  // active, so "remain active while navigating between pages" is genuinely true (this is shell
  // chrome, not per-view state). Built once, refreshed in place like the header/footer above.
  const previewBanner = el("div", { class: "preview-banner", role: "status", hidden: true });
  const main = el("main", { class: "app__main", id: "main", tabindex: "-1" });
  const footer = el("footer", { class: "app__footer" });
  let view = null;
  let viewKey = "";
  let navigated = false;
  let menu = null;
  let wsPicker = null;
  let landingEl = null;
  let pendingEl = null;
  let pendingKind = null;

  // Leaving a page with unsaved changes asks first (UX/accessibility review of eefd115, finding 3); the
  // browser asks on its own when the tab is closed or reloaded (main.js).
  if (router.setGuard) {
    router.setGuard((hash) => {
      const names = unsavedNames();
      if (!names.length) return true;
      confirmModal({
        title: "Leave without saving?",
        message: `You have unsaved changes in ${names.join(" and ")}. If you leave this page now, they are lost.`,
        confirmLabel: "Leave without saving", danger: true,
        onConfirm: () => { clearUnsaved(); if (router.go) router.go(hash); },
      });
      return false;
    });
  }

  // The skip link targets #main; with hash routing it must move focus, not navigate (A11Y-003).
  document.addEventListener("click", (event) => {
    const link = event.target && event.target.closest ? event.target.closest(".skip-link") : null;
    if (!link) return;
    event.preventDefault();
    const target = document.getElementById("main");
    if (target) target.focus({ preventScroll: false });
  });

  function ctx() {
    return { store, api, router, theme, navigate: router.navigate, state: store.getState() };
  }

  function isLocked(key) {
    const p = store.getState().preferences;
    return !!(p && p.sources && p.sources[key] === "locked");
  }

  // ---- account menu (built once) ----
  function buildMenu(user) {
    const panelId = "account-menu-panel";
    const panel = el("div", { class: "menu__panel", id: panelId, hidden: true, role: "group", "aria-label": "Account and appearance" });
    const initialsText = initials(user.name, user.email);
    // The visible text ("AF") is part of the accessible name (WCAG 2.5.3, A11Y-016).
    const trigger = el("button", { type: "button", class: "avatar", "aria-expanded": "false", "aria-controls": panelId, "aria-label": `${initialsText}, account menu for ${user.name || user.email}`, text: initialsText });
    const dayNight = createDayNightControl({
      theme,
      onChange: (mode) => { void store.actions.savePreferences({ themeMode: mode }); },
      locked: isLocked("themeMode"),
    });
    theme.subscribe(() => dayNight.refresh());
    // TaskTracker's colour-aware palette picker (BT-011-03), the same control as in My settings.
    const palette = createThemePicker({
      value: theme.getTheme(), id: "menu-palette", labelledBy: "menu-palette-label",
      // A failed save puts the previous palette back and says why (A11Y2-006).
      onPick: async (value) => {
        const prev = theme.getTheme();
        theme.setTheme(value);
        const out = await store.actions.savePreferences({ themePalette: value });
        if (out.ok) { announce(`Palette ${(theme.themes.find((t) => t.id === value) || {}).label || value}`); return; }
        theme.setTheme(prev);
        palette.select(prev);
        announce(`The palette could not be saved. ${messageFor(out.error)}`);
      },
    });
    // The staging link (BT-011-06), built once with the menu and refreshed in place. Editing closes
    // the menu and puts focus on its button first, so the dialog gives focus back there when it closes.
    const staging = createStagingMenuEntry({
      getState: () => store.getState(),
      onEdit: () => { setOpen(false); trigger.focus(); openPersonalStagingEditor({ store }); },
    });
    panel.append(
      el("div", { class: "menu__group" }, [el("div", { class: "menu__identity" }, [el("strong", { text: user.name || "Signed in" }), el("div", { class: "muted small", text: user.email })])]),
      el("div", { class: "menu__group" }, [
        el("p", { class: "menu__heading", text: "Appearance" }), dayNight.element,
        el("div", { class: "menu__palette" }, [el("p", { class: "field__label small", id: "menu-palette-label", text: "Colour palette" }), palette.element]),
      ]),
      staging.element,
      el("div", { class: "menu__group" }, [
        // Track something separately in its own workspace; the menu closes and focus returns to its
        // button first, so the dialog gives focus back there when it closes.
        el("button", { type: "button", class: "menu__item", text: "New workspace…", onClick: () => { setOpen(false); trigger.focus(); openNewWorkspace({ store }); } }),
        el("a", { class: "menu__item", href: "#/settings", text: "My settings" }),
        // Usage (BT-012-01), like "My settings", is reached from the account menu — never only from
        // the section nav, which is hidden whenever there is no workspace (UX-011) and is not even
        // populated during onboarding. A site administrator with no workspace of their own (the usual
        // case: site administration is configuration, never membership) would otherwise have no way
        // to reach it at all, found in real-browser testing (BT-004-06).
        user.siteAdmin ? el("a", { class: "menu__item", href: "#/analytics", text: "Usage" }) : null,
        // Design Gallery (BT-013): site administrators only, same reasoning as "Usage" directly above
        // (a site administrator usually has no workspace of their own to reach a section nav from).
        user.siteAdmin ? el("a", { class: "menu__item", href: "#/gallery", text: "Design Gallery" }) : null,
        // Workspace directory and administrative permanent deletion (BT-014-03/04): same reasoning.
        user.siteAdmin ? el("a", { class: "menu__item", href: "#/admin-workspaces", text: "Workspaces" }) : null,
        // Account-request approval (BT-014-17): same reasoning.
        user.siteAdmin ? el("a", { class: "menu__item", href: "#/account-requests", text: "Account requests" }) : null,
        el("a", { class: "menu__item", href: AUTH.logout, text: "Sign out" }),
      ]),
    );
    const root = el("div", { class: "menu" }, [trigger, panel]);
    const setOpen = (open) => { panel.hidden = !open; trigger.setAttribute("aria-expanded", open ? "true" : "false"); };
    trigger.addEventListener("click", () => setOpen(panel.hidden));
    root.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { setOpen(false); trigger.focus(); } });
    root.addEventListener("focusout", (e) => { if (!e.relatedTarget || !root.contains(e.relatedTarget)) setOpen(false); });
    document.addEventListener("click", (e) => { if (!root.contains(e.target)) setOpen(false); });
    return {
      root,
      refresh() {
        dayNight.setLocked(isLocked("themeMode"));
        if (palette.getValue() !== theme.getTheme()) palette.select(theme.getTheme());
        palette.setDisabled(isLocked("themePalette"));
        staging.refresh();
      },
    };
  }

  // THE HEADER'S NODES ARE BUILT ONCE and refreshed in place, like the account menu: `mount()` then
  // leaves the header untouched on a store commit, so nothing in it loses focus or closes under
  // somebody mid-interaction.
  const brandName = el("span");
  const brand = el("a", { class: "app__brand", href: "#/dashboard", "aria-label": "BudgetTracker home" }, [el("img", { src: "/favicon.svg", alt: "" }), brandName]);
  const spacer = el("div", { class: "app__spacer" });

  // The workspace picker (BT-004-04): TaskTracker's command picker with a role badge, search and a
  // pinned "+ New workspace" — where Terry looked for it on preview (2026-09-13), now inside the
  // control rather than as a separate button beside it. Choosing goes through selectWorkspace, which
  // owns the synchronous reset and the generation guard. "New workspace…" stays in the account menu,
  // as TaskTracker keeps it in its profile menu.
  function workspacePicker(state) {
    if (!wsPicker) {
      wsPicker = createWorkspacePicker({
        workspaces: state.workspaces,
        selectedId: state.selectedWorkspaceId,
        onSelect: (id) => { void store.actions.selectWorkspace(id); },
        onCreate: (name) => openNewWorkspace({ store, name }),
        announce,
      });
    } else {
      wsPicker.update({ workspaces: state.workspaces, selectedId: state.selectedWorkspaceId });
    }
    return wsPicker.element;
  }

  // Open workspaces: not a deleted one (an owner keeps seeing a deleted workspace only in My settings'
  // "Deleted workspaces", to bring it back — Terry, 2026-09-14).
  const openWorkspaces = (state) => state.workspaces.filter((w) => w.status !== "archived");

  function renderHeader(state) {
    brandName.textContent = (state.site && state.site.branding && state.site.branding.name) || "BudgetTracker";
    const items = [brand];
    const open = openWorkspaces(state);
    if (open.length) items.push(workspacePicker({ ...state, workspaces: open }));
    items.push(spacer);
    if (!menu) menu = buildMenu(state.auth.user);
    menu.refresh();
    items.push(menu.root);
    // TaskTracker's guarantee: should the header ever be re-mounted, focus that was in the picker
    // goes back to it rather than to the page.
    const pickerHadFocus = !!(wsPicker && wsPicker.hasFocus());
    mount(header, ...items);
    if (pickerHadFocus && !wsPicker.hasFocus()) wsPicker.restoreFocus();
  }

  // Sections depend on the workspace: Shared expenses only while it is on (its setting, bounded by
  // the site).
  // Each nav item shows its icon beside its label (Terry, 2026-09-17): the icon is decorative
  // (aria-hidden, set by icon()/withIcon()) and never the only way to tell items apart — the label
  // is always real text alongside it, same rule as every other icon+label pairing in the app.
  const navLink = (r, currentId) => el("a", { href: `#${r.path}`, "aria-current": r.id === currentId ? "page" : null }, [withIcon(r.icon, r.label)]);

  function renderNav(route, state) {
    const ws = state.workspaces.find((w) => w.id === state.selectedWorkspaceId);
    const items = navRoutes(ws || null, state.site).map((r) => navLink(r, route.id));
    if (state.auth.user && state.auth.user.siteAdmin) {
      // One "Site Settings" entry stands in for all three site-admin routes; it reads as current
      // (aria-current=page) for any of them, and always lands on Workspaces (the first sub-tab).
      const landing = ROUTES.find((r) => r.id === "admin-workspaces");
      items.push(el("a", { href: `#${landing.path}`, "aria-current": SITE_ADMIN_ROUTE_IDS.has(route.id) ? "page" : null }, [withIcon("shield", "Site Settings")]));
    }
    mount(nav, ...items);
  }

  // The site-admin pages' own sub-tab row (Workspaces, Design Gallery, Usage, Account requests),
  // shown only for a site administrator, only while one of them is the current route — never for
  // anyone else, even one who opens the URL directly (each page's own view still refuses them
  // independently either way; this only stops the row itself from appearing). Each is still its own
  // real route/URL/view/test — grouping them under "Site Settings" changed only how they are reached.
  function renderSiteAdminNav(route, state) {
    const show = !!(state.auth.user && state.auth.user.siteAdmin) && SITE_ADMIN_ROUTE_IDS.has(route.id);
    siteAdminNav.hidden = !show;
    if (!show) { mount(siteAdminNav); return; }
    mount(siteAdminNav, ...["admin-workspaces", "gallery", "analytics", "account-requests"].map((id) => navLink(ROUTES.find((r) => r.id === id), route.id)));
  }

  function renderFooter(state) {
    const app = state.app || {};
    const env = app.environment || "unconfigured";
    mount(footer,
      el("span", { text: `BudgetTracker ${app.version || ""}${app.commit ? ` · ${app.commit.slice(0, 7)}` : ""}` }),
      el("span", { class: "badge badge--env", text: env }),
      el("span", { text: "Financial records are private by default. Site administrators cannot see them." }));
  }

  // BT-013-16: the full-size Layout Preview banner, BUILT ONCE and refreshed in place (the header's
  // own established pattern in this file) rather than rebuilt per render, so an in-flight Apply is
  // never orphaned on a stale, already-replaced button by a background store commit arriving mid-
  // request. `state.layoutPreview` is a client-only, ephemeral override (app/js/core/store.js) —
  // never a server write — so "Exit" simply clears it, instantly restoring the real applied layout
  // with no server round trip and no effect on anyone else. "Apply" is the ONE write allowed through
  // while previewing (`allowDuringPreview: true`): the real, existing, audited
  // `PATCH /api/workspaces?id=` settings mechanism, never a second one.
  const previewText = el("span");
  const previewError = el("span", { class: "error-text small", role: "alert" });
  let previewLayoutId = null;
  const previewApplyBtn = button("Apply to workspace", async () => {
    if (!previewLayoutId) return;
    previewApplyBtn.disabled = true;
    previewError.textContent = "";
    const out = await store.actions.write(
      (id) => api.request("workspaces", { method: "PATCH", query: { id }, body: { settings: { layoutId: previewLayoutId } } }),
      [], { allowDuringPreview: true },
    );
    if (!out.ok) { previewApplyBtn.disabled = false; previewError.textContent = messageFor(out.error); return; }
    const appliedName = layoutMeta(previewLayoutId).name;
    if (store.actions.refreshWorkspaces) await store.actions.refreshWorkspaces();
    store.actions.exitLayoutPreview();
    announce(`${appliedName} applied. Everyone in the workspace now sees this layout.`);
  }, { small: true, variant: "primary" });
  const previewExitBtn = button("Exit preview", () => store.actions.exitLayoutPreview(), { small: true, variant: "ghost" });
  previewBanner.append(el("div", { class: "preview-banner__inner" }, [previewText, el("div", { class: "row" }, [previewApplyBtn, previewExitBtn]), previewError]));
  function renderPreviewBanner(state) {
    const preview = state.layoutPreview;
    if (!preview) { previewBanner.hidden = true; previewLayoutId = null; return; }
    const ws = state.workspaces.find((w) => w.id === state.selectedWorkspaceId);
    const meta = layoutMeta(preview.layoutId);
    // A NEW preview session (including re-previewing after a previous one) always starts with a
    // fresh, enabled Apply button and no stale error — these controls are built once and reused
    // across sessions, so nothing from a previous session may leak into this one.
    if (previewLayoutId !== preview.layoutId) { previewApplyBtn.disabled = false; previewError.textContent = ""; }
    previewLayoutId = preview.layoutId;
    previewText.textContent = `Previewing ${meta.name}${ws ? ` for ${ws.name}` : ""} — read-only.`;
    const canApply = !!ws && (ws.role === "owner" || ws.role === "manager");
    previewApplyBtn.hidden = !canApply;
    previewBanner.hidden = false;
  }

  function renderView(state, route) {
    const ws = state.workspaces.find((w) => w.id === state.selectedWorkspaceId);
    const groupOff = route.id === "group" && !sharedExpensesOn(ws || null, state.site);
    const key = `${route.id}|${state.selectedWorkspaceId}|${JSON.stringify(route.params)}|${groupOff ? "off" : "on"}`;
    if (key !== viewKey) {
      if (view && view.destroy) view.destroy();
      viewKey = key;
      const mod = groupOff ? SHARED_EXPENSES_OFF : VIEWS[route.id] || dashboard;
      view = mod.createView({ ...ctx(), params: route.params });
      mount(main, view.element);
      // On in-app navigation focus moves to the new view's heading so a screen reader announces
      // it. Not on the first load of the page: there focus stays at the top of the document, and a
      // browser would otherwise draw a keyboard focus ring round the title after every refresh.
      if (navigated) focusFirst(main);
      navigated = true;
      const label = (ROUTES.find((r) => r.id === route.id) || ROUTES[0]).label;
      document.title = `${label} · BudgetTracker`;
    }
    view.update(state);
  }

  function render() {
    const state = store.getState();
    const route = router.current();
    mountPoint.setAttribute("data-app-status", state.auth.status);
    if (state.auth.status === Status.LOADING) return;
    if (state.auth.status === Status.ERROR) {
      mount(mountPoint, el("main", { class: "landing", id: "main", tabindex: "-1" }, [el("h1", { text: "BudgetTracker is unavailable" }), el("p", { class: "error-text", text: state.auth.error ? messageFor(state.auth.error) : "Please try again shortly." })]));
      return;
    }
    if (!state.auth.user) {
      // Built once and reused across renders while signed out (the same reasoning as the account
      // menu: rebuilding it on every commit would resubscribe the day/night control and refetch the
      // footer's public version/channel for nothing).
      if (!landingEl) landingEl = renderLanding({ theme, api });
      if (!mountPoint.contains(landingEl)) { clear(mountPoint); mountPoint.appendChild(landingEl); }
      menu = null;
      if (wsPicker) { wsPicker.destroy(); wsPicker = null; }
      document.title = "BudgetTracker — sign in"; return;
    }
    landingEl = null;
    // BT-014-17: a pending or rejected account sees only this screen, nothing else — no nav, no
    // workspace picker, no view (a site administrator is never pending/rejected, so this never
    // conflicts with reaching Site Settings to approve someone else).
    if (state.auth.user.pendingApproval || state.auth.user.rejected) {
      const kind = state.auth.user.rejected ? "rejected" : "pending";
      if (!pendingEl || pendingKind !== kind) { pendingKind = kind; pendingEl = renderPendingApproval({ rejected: state.auth.user.rejected }); }
      if (!mountPoint.contains(pendingEl)) { clear(mountPoint); mountPoint.appendChild(pendingEl); }
      menu = null;
      if (wsPicker) { wsPicker.destroy(); wsPicker = null; }
      document.title = `${state.auth.user.rejected ? "Account not approved" : "Waiting for approval"} · BudgetTracker`;
      return;
    }
    pendingEl = null;
    pendingKind = null;
    if (!mountPoint.contains(main)) mount(mountPoint, header, nav, siteAdminNav, previewBanner, main, footer);
    renderHeader(state);
    renderFooter(state);
    renderPreviewBanner(state);
    // Without a workspace there are no sections to navigate, so the nav is hidden (UX-011). My
    // settings stays reachable from the account menu: personal preferences, and for a site
    // administrator the icon catalogue (BT-011-05), need no workspace. Usage, Design Gallery and the
    // Workspaces directory are the same: all three are about the whole site, not any one workspace.
    const onboarding = !openWorkspaces(state).length && route.id !== "join" && route.id !== "settings" && !SITE_ADMIN_ROUTE_IDS.has(route.id);
    nav.hidden = onboarding || (!openWorkspaces(state).length && (route.id === "settings" || SITE_ADMIN_ROUTE_IDS.has(route.id)));
    if (onboarding) {
      if (viewKey !== "onboarding") { viewKey = "onboarding"; view = createOnboarding(ctx()); mount(main, view.element); document.title = "Create a workspace · BudgetTracker"; }
      return;
    }
    renderNav(route, state);
    renderSiteAdminNav(route, state);
    renderView(state, route);
  }

  store.subscribe(render);
  router.subscribe(render);
  return { render };
}
