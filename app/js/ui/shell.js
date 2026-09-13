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
import { initials, select, commitOnConfirm } from "./components.js";
import { AUTH } from "../core/api.js";
import { ROUTES } from "../core/router.js";
import { Status } from "../core/store.js";

import * as dashboard from "./views/dashboard.js";
import * as transactions from "./views/transactions.js";
import * as accounts from "./views/accounts.js";
import * as payees from "./views/payees.js";
import * as settings from "./views/settings.js";
import * as workspace from "./views/workspace.js";
import * as join from "./views/join.js";
import { renderLanding, createOnboarding } from "./views/landing.js";
import { messageFor } from "../core/errors.js";

const VIEWS = { dashboard, transactions, accounts, payees, settings, workspace, join };

export function createShell({ mountPoint, store, router, theme, api }) {
  const header = el("header", { class: "app__header" });
  const nav = el("nav", { class: "app__nav", "aria-label": "Sections" });
  const main = el("main", { class: "app__main", id: "main", tabindex: "-1" });
  const footer = el("footer", { class: "app__footer" });
  let view = null;
  let viewKey = "";
  let menu = null;

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
    const palette = select(theme.themes.map((t) => ({ value: t.id, label: t.label })), theme.getTheme(), { id: "menu-palette" });
    const paletteCommit = commitOnConfirm(palette, (value) => {
      theme.setTheme(value);
      void store.actions.savePreferences({ themePalette: value });
      announce(`Palette ${palette.options[palette.selectedIndex].text}`);
    });
    panel.append(
      el("div", { class: "menu__group" }, [el("div", { class: "menu__identity" }, [el("strong", { text: user.name || "Signed in" }), el("div", { class: "muted small", text: user.email })])]),
      el("div", { class: "menu__group" }, [
        el("p", { class: "menu__heading", text: "Appearance" }), dayNight.element,
        el("div", { class: "menu__palette" }, [el("label", { class: "field__label small", for: "menu-palette", text: "Colour palette" }), palette]),
      ]),
      el("div", { class: "menu__group" }, [
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
        paletteCommit.reset(theme.getTheme());
        palette.disabled = isLocked("themePalette");
      },
    };
  }

  function renderHeader(state) {
    const brand = el("a", { class: "app__brand", href: "#/dashboard", "aria-label": "BudgetTracker home" }, [el("img", { src: "/favicon.svg", alt: "" }), el("span", { text: (state.site && state.site.branding && state.site.branding.name) || "BudgetTracker" })]);
    const items = [brand];
    if (state.workspaces.length) {
      const picker = select(state.workspaces.map((w) => ({ value: w.id, label: `${w.name}${w.status === "archived" ? " (archived)" : ""}` })), state.selectedWorkspaceId, { "aria-label": "Workspace" });
      commitOnConfirm(picker, (value) => { void store.actions.selectWorkspace(value); });
      items.push(el("div", {}, [picker]));
    }
    items.push(el("div", { class: "app__spacer" }));
    if (!menu) menu = buildMenu(state.auth.user);
    menu.refresh();
    items.push(menu.root);
    mount(header, ...items);
  }

  function renderNav(route) {
    mount(nav, ...ROUTES.filter((r) => !r.hidden).map((r) => el("a", { href: `#${r.path}`, "aria-current": r.id === route.id ? "page" : null, text: r.label })));
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
    const key = `${route.id}|${state.selectedWorkspaceId}|${JSON.stringify(route.params)}`;
    if (key !== viewKey) {
      if (view && view.destroy) view.destroy();
      viewKey = key;
      const mod = VIEWS[route.id] || dashboard;
      view = mod.createView({ ...ctx(), params: route.params });
      mount(main, view.element);
      focusFirst(main);
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
    if (!state.auth.user) { clear(mountPoint); mountPoint.appendChild(renderLanding()); menu = null; document.title = "BudgetTracker — sign in"; return; }
    if (!mountPoint.contains(main)) mount(mountPoint, header, nav, main, footer);
    renderHeader(state);
    renderFooter(state);
    // Without a workspace there are no sections to navigate, so the nav is hidden (UX-011).
    const onboarding = !state.workspaces.length && route.id !== "join";
    nav.hidden = onboarding;
    if (onboarding) {
      if (viewKey !== "onboarding") { viewKey = "onboarding"; view = createOnboarding(ctx()); mount(main, view.element); document.title = "Create a workspace · BudgetTracker"; }
      return;
    }
    renderNav(route);
    renderView(state, route);
  }

  store.subscribe(render);
  router.subscribe(render);
  return { render };
}
