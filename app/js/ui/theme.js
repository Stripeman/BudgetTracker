// Theme and colour mode, ported from TaskTracker app/js/ui/theme.js (T: main a1ec150).
//
// Two independent axes:
//   * MODE  — system / light / dark. "system" keeps following the OS.
//   * THEME — the palette (accent only); every palette defines light and dark tokens in CSS.
// Both are attributes on <html>; everything else is CSS. Nothing about presentation is ever
// written into financial data.
//
// BudgetTracker adaptations: cache keys are `bt.mode`/`bt.theme` (a first-paint cache only — the
// account preference on the server is canonical and is applied after /api/me), and the palette
// list is the subset BudgetTracker's server accepts (api/_shared/site.js PALETTES), with the same
// ids, labels and swatches as TaskTracker.

export const MODES = Object.freeze(["system", "light", "dark"]);

export const THEMES = Object.freeze([
  { id: "midnight", label: "Midnight", swatch: "#3b82f6" },
  { id: "slate", label: "Slate", swatch: "#64748b" },
  { id: "forest", label: "Forest", swatch: "#10b981" },
  { id: "solar", label: "Solar", swatch: "#f59e0b" },
  { id: "teal", label: "Teal", swatch: "#14b8a6" },
  { id: "rose", label: "Rose", swatch: "#f43f5e" },
  { id: "amber", label: "Amber", swatch: "#eab308" },
  { id: "indigo", label: "Indigo", swatch: "#7678f3" },
]);

const STORAGE_KEY_MODE = "bt.mode";
const STORAGE_KEY_THEME = "bt.theme";

export const DEFAULT_MODE = "system";
export const DEFAULT_THEME = "midnight";

function safeStorage(storage) {
  // Private browsing and blocked storage make localStorage throw on access.
  return {
    get(key) { try { return storage ? storage.getItem(key) : null; } catch (e) { return null; } },
    set(key, value) { try { if (storage) storage.setItem(key, value); } catch (e) { /* not persisted */ } },
  };
}

export function createThemeController(options = {}) {
  const root = options.root;
  if (!root || typeof root.setAttribute !== "function") throw new Error("createThemeController requires a root element.");
  const storage = safeStorage(options.storage);
  const media = options.media || null;
  const listeners = new Set();

  const normalizeMode = (value) => (MODES.includes(value) ? value : DEFAULT_MODE);
  const normalizeTheme = (value) => (THEMES.some((t) => t.id === value) ? value : DEFAULT_THEME);

  let mode = normalizeMode(storage.get(STORAGE_KEY_MODE) || options.defaultMode || DEFAULT_MODE);
  let theme = normalizeTheme(storage.get(STORAGE_KEY_THEME) || options.defaultTheme || DEFAULT_THEME);

  const systemPrefersDark = () => !!(media && media.matches);
  const resolvedMode = () => (mode === "system" ? (systemPrefersDark() ? "dark" : "light") : mode);

  function apply() {
    root.setAttribute("data-mode", resolvedMode());
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-color-scheme", resolvedMode());
    for (const listener of listeners) listener({ mode, theme, resolved: resolvedMode() });
  }

  if (media && typeof media.addEventListener === "function") {
    media.addEventListener("change", () => { if (mode === "system") apply(); });
  }
  apply();

  return {
    getMode: () => mode,
    getTheme: () => theme,
    getResolvedMode: () => resolvedMode(),
    modes: MODES,
    themes: THEMES,
    setMode(next) { mode = normalizeMode(next); storage.set(STORAGE_KEY_MODE, mode); apply(); return mode; },
    setTheme(next) { theme = normalizeTheme(next); storage.set(STORAGE_KEY_THEME, theme); apply(); return theme; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

export function browserThemeController(win = globalThis) {
  return createThemeController({
    root: win.document.documentElement,
    storage: win.localStorage,
    media: typeof win.matchMedia === "function" ? win.matchMedia("(prefers-color-scheme: dark)") : null,
  });
}
