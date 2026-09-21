// BT-013-16 (Terry, 2026-09-21): the real, user-facing workspace Layout Picker — "using the designs
// already created", as the normal way a workspace chooses its appearance from now on. Lives as a card
// in Workspace Settings (app/js/ui/views/workspace.js); the Design Gallery links here as its entry
// point for the twelve concepts not yet integrated ("Demo only").
//
// UNLIKE the Design Gallery (fictional fixtures only, site administrators only), this reads the real,
// authorized `/api/workspace-layouts` for the CURRENT real workspace: real permissions (canApply/
// canManage come from the caller's own real role), real current layout, real workspace-default and
// personal colours. Applying a layout reuses the EXISTING `PATCH /api/workspaces?id=`
// (`settings.layoutId`) — never a second mutation path — so it is audited, historied and permission-
// checked exactly like every other workspace setting.
//
// Full-size Preview (real workspace data, read-only, Apply/Exit) is a separate, not-yet-built
// increment (BT-013-16 step 3 in PROJECT_STATE.md): the "Preview" button below is present, as Terry's
// card spec asks, but honestly disabled with a stated reason rather than faking a preview that does
// not exist yet.
import { el, mount, announce } from "../dom.js";
import { button, badge } from "../components.js";
import { messageFor } from "../../core/errors.js";
import { createAppearanceCog } from "../gallery/appearancecog.js";

// CSP forbids inline `style` (el() itself refuses it); the thumbnail's colours are passed through
// CSS custom properties instead, read by `.layoutpicker-thumb` in app/styles/components.css.
function thumb(l) {
  return el("div", {
    class: "layoutpicker-thumb", "aria-hidden": "true",
    vars: { "--lp-light": l.accentLight || null, "--lp-dark": l.accentDark || null },
  });
}

// One appearance cog instance, reused verbatim (BT-013-15's control): `label` distinguishes the two
// possible cogs on one card ("my colours" vs "workspace default") for their accessible names.
function makeCog({ l, label, getOverride, onChange, onReset }) {
  return createAppearanceCog({ concept: { name: `${l.name} — ${label}`, accentLight: l.accentLight, accentDark: l.accentDark }, getOverride, onChange, onReset });
}

/**
 * @param {object} ctx  the view context ({ api, store })
 * @returns {{ element: HTMLElement, load: () => Promise<void> }}
 */
export function createLayoutPicker(ctx) {
  const { api, store } = ctx;
  const status = el("p", { class: "field__help", role: "status" });
  const error = el("p", { class: "error-text", role: "alert", hidden: true });
  const grid = el("div", { class: "layoutpicker-grid" });
  const demoGrid = el("div", { class: "layoutpicker-grid layoutpicker-grid--demo" });
  const element = el("div", { class: "stack" }, [
    el("p", { class: "field__help", text: "Choose how this workspace's pages are organised. Applying a layout changes navigation, density and dashboard composition for everyone in the workspace; it never changes financial records, permissions, calculations or filters, and never changes anyone's own light/dark or colour choice." }),
    status, error,
    grid,
    el("h3", { class: "layoutpicker-demoheading", text: "Other designs under review (not yet available to apply)" }),
    el("p", { class: "field__help small", text: "These are shown for reference only. They are not yet built against real data, so there is nothing to preview or apply here." }),
    demoGrid,
  ]);

  let data = null;
  const wsId = () => store.getState().selectedWorkspaceId;

  async function applyLayout(l) {
    error.hidden = true;
    status.textContent = `Applying ${l.name}…`;
    const out = await store.actions.write((ws) => api.request("workspaces", { method: "PATCH", query: { id: ws }, body: { settings: { layoutId: l.id } } }), []);
    if (!out.ok) { status.textContent = ""; error.textContent = messageFor(out.error); error.hidden = false; return; }
    if (store.actions.refreshWorkspaces) await store.actions.refreshWorkspaces();
    status.textContent = `${l.name} applied. Everyone in the workspace now sees this layout.`;
    announce(status.textContent);
    await load();
  }

  async function hideRestore(l, action) {
    error.hidden = true;
    const out = await store.actions.write((ws) => api.patchWorkspaceLayout(ws, { action, layoutId: l.id }), []);
    if (!out.ok) { error.textContent = messageFor(out.error); error.hidden = false; return; }
    announce(action === "hide" ? `${l.name} removed from this workspace's choices.` : `${l.name} restored to this workspace's choices.`);
    await load();
  }

  function renderCard(l) {
    const canApplyNow = data.canApply && !l.current && l.selectable && !l.hidden;
    const badges = [
      l.current ? badge("Currently applied", "shared") : null,
      l.retired ? badge("Retired by the site administrator", "") : null,
      l.hidden ? badge("Removed from this workspace's choices", "") : null,
    ].filter(Boolean);

    const actions = [];
    // The badge above already says "Currently applied" (a clear, single indicator, Terry's item 1) —
    // this button stays labelled "Apply to workspace" throughout, disabled rather than relabelled, so
    // the two pieces of UI never repeat the same words back at each other.
    actions.push(button("Apply to workspace", () => { void applyLayout(l); }, {
      small: true, attrs: canApplyNow ? {} : { disabled: true, "aria-disabled": "true",
        title: l.current ? "This is already the workspace's layout." : !l.selectable ? "This layout has been retired by the site administrator and cannot be newly applied." : l.hidden ? "Restore it to this workspace's choices first." : "Only owners and managers can apply a layout." },
    }));
    // Not the ghost variant: a disabled ghost button (transparent border/background) reads as nearly
    // invisible next to a solid Apply button (real-browser screenshot review, this checkpoint) —
    // Preview keeps a visible border like every other real action here.
    actions.push(button("Preview", () => {}, { small: true, attrs: { disabled: true, "aria-disabled": "true", title: "Full-size preview with this workspace's own data arrives in a following update." } }));
    if (data.canManage && !l.system) {
      actions.push(l.hidden
        ? button("Restore to this workspace", () => { void hideRestore(l, "restore"); }, { small: true, variant: "ghost" })
        : button("Remove from this workspace's choices", () => { void hideRestore(l, "hide"); }, { small: true, variant: "ghost" }));
    }

    const cogs = [];
    if (l.colorable) {
      const personalCog = makeCog({
        l, label: "my colours", getOverride: () => l.personalColors,
        onChange: async (next) => {
          const out = await store.actions.savePreferences({ galleryDesignColors: { [l.id]: next } });
          if (out.ok) { l.personalColors = next; }
          return out;
        },
        onReset: async () => {
          const out = await store.actions.savePreferences({ galleryDesignColors: { [l.id]: null } });
          if (out.ok) l.personalColors = null;
          return out;
        },
      });
      cogs.push(el("div", { class: "field" }, [el("p", { class: "field__label", text: "My colours" }), personalCog.element]));
      if (data.canManage) {
        const workspaceCog = makeCog({
          l, label: "workspace default", getOverride: () => l.workspaceColors,
          onChange: async (next) => {
            const out = await store.actions.write((ws) => api.patchWorkspaceLayout(ws, { action: "colors", layoutId: l.id, colors: next }), []);
            if (out.ok) l.workspaceColors = next;
            return out;
          },
          onReset: async () => {
            const out = await store.actions.write((ws) => api.patchWorkspaceLayout(ws, { action: "colors", layoutId: l.id, colors: null }), []);
            if (out.ok) l.workspaceColors = null;
            return out;
          },
        });
        const publishBtn = button("Use my colours as the workspace default", async () => {
          error.hidden = true;
          const out = await store.actions.write((ws) => api.patchWorkspaceLayout(ws, { action: "publish-personal-colors", layoutId: l.id }), []);
          if (!out.ok) { error.textContent = messageFor(out.error); error.hidden = false; return; }
          announce(`${l.name}: your colours are now the workspace default.`);
          await load();
        }, { small: true, variant: "ghost", attrs: l.personalColors ? {} : { disabled: true, "aria-disabled": "true", title: "Set your own colours for this layout first." } });
        cogs.push(el("div", { class: "field" }, [el("p", { class: "field__label", text: "Workspace default colours" }), workspaceCog.element]), publishBtn);
      }
    }

    return el("article", { class: "layoutpicker-card", "aria-labelledby": `lp-${l.id}` }, [
      thumb(l),
      el("h3", { id: `lp-${l.id}`, text: l.name }),
      badges.length ? el("div", { class: "row" }, badges) : null,
      el("div", { class: "row" }, actions),
      ...cogs,
    ]);
  }

  function renderDemoCard(d) {
    return el("article", { class: "layoutpicker-card layoutpicker-card--demo" }, [
      thumb(d),
      el("h3", { text: d.name }),
      badge("Demo only", ""),
      el("p", { class: "field__help small", text: d.tagline }),
    ]);
  }

  function render() {
    mount(grid, ...data.layouts.map(renderCard));
    mount(demoGrid, ...data.demoLayouts.map(renderDemoCard));
    status.textContent = "";
  }

  async function load() {
    try {
      data = await api.workspaceLayouts(wsId());
      render();
    } catch (err) {
      mount(grid, el("p", { class: "error-text", role: "alert", text: messageFor(err) }));
    }
  }

  return { element, load };
}
