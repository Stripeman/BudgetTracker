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
import { initials } from "./components.js";
import { createThemePicker } from "./themepicker.js";
import { createWorkspacePicker } from "./workspacepicker.js";
import { createStagingMenuEntry, openPersonalStagingEditor } from "./staginglink.js";
import { AUTH } from "../core/api.js";
import { ROUTES, navRoutes } from "../core/router.js";
import { sharedExpensesOn } from "../core/workspacesettings.js";
import { Status } from "../core/store.js";

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
import { renderLanding, createOnboarding, openNewWorkspace } from "./views/landing.js";
import { messageFor } from "../core/errors.js";

const VIEWS = { dashboard, group, transactions, bills, planning, accounts, payees, settings, workspace, join };

// Shared expenses turned off (workspace settings, Terry 2026-09-14): the page says so and loads nothing;
// the server refuses /api/group as well. Nothing recorded is removed.
const SHARED_EXPENSES_OFF = {
  createView(ctx) {
    const site = ctx.state && ctx.state.site;
    const siteOff = !!(site && site.modules && site.modules.sharedExpenses === false);
    return {
      element: el("section", {}, [
        el("div", { class: "page-head" }, [el("h1", { text: "Shared expenses" })]),
        el("p", { class: "notice", text: siteOff
          ? "Shared expenses are turned off for this site by the site administrator. Nothing recorded has been removed."
          : "Shared expenses are turned off in this workspace. Nothing recorded has been removed; an owner or manager can turn them on again in Workspace settings." }),
      ]),
      update() {},
    };
  },
};

export function createShell({ mountPoint, store, router, theme, api }) {
  const header = el("header", { class: "app__header" });
  const nav = el("nav", { class: "app__nav", "aria-label": "Sections" });
  const main = el("main", { class: "app__main", id: "main", tabindex: "-1" });
  const footer = el("footer", { class: "app__footer" });
  let view = null;
  let viewKey = "";
  let navigated = false;
  let menu = null;
  let wsPicker = null;

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

  function renderHeader(state) {
    brandName.textContent = (state.site && state.site.branding && state.site.branding.name) || "BudgetTracker";
    const items = [brand];
    if (state.workspaces.length) items.push(workspacePicker(state));
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

  // Sections depend on the workspace: Shared expenses only while it is on (its setting, bounded by the site).
  function renderNav(route, state) {
    const ws = state.workspaces.find((w) => w.id === state.selectedWorkspaceId);
    mount(nav, ...navRoutes(ws || null, state.site).map((r) => el("a", { href: `#${r.path}`, "aria-current": r.id === route.id ? "page" : null, text: r.label })));
  }

  function renderFooter(state) {
    const app = state.app || {};
    const env = app.environment || "unconfigured";
    mount(footer,
      el("span", { text: `BudgetTracker ${app.version || ""}${app.commit ? ` · ${app.commit.slice(0, 7)}` : ""}` }),
      el("span", { class: "badge badge--env", text: env }),
      el("span", { text: "Financial records are private by default. Site administrators cannot see them." }));
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
      clear(mountPoint); mountPoint.appendChild(renderLanding()); menu = null;
      if (wsPicker) { wsPicker.destroy(); wsPicker = null; }
      document.title = "BudgetTracker — sign in"; return;
    }
    if (!mountPoint.contains(main)) mount(mountPoint, header, nav, main, footer);
    renderHeader(state);
    renderFooter(state);
    // Without a workspace there are no sections to navigate, so the nav is hidden (UX-011). My
    // settings stays reachable from the account menu: personal preferences, and for a site
    // administrator the icon catalogue (BT-011-05), need no workspace.
    const onboarding = !state.workspaces.length && route.id !== "join" && route.id !== "settings";
    nav.hidden = onboarding || (!state.workspaces.length && route.id === "settings");
    if (onboarding) {
      if (viewKey !== "onboarding") { viewKey = "onboarding"; view = createOnboarding(ctx()); mount(main, view.element); document.title = "Create a workspace · BudgetTracker"; }
      return;
    }
    renderNav(route, state);
    renderView(state, route);
  }

  store.subscribe(render);
  router.subscribe(render);
  return { render };
}
