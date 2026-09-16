// Composition root. Theme first (so the first paint is styled), then the store, router and shell.
// After /api/me the server's EFFECTIVE preference (personal → site default → built-in) is applied
// to the theme controller; the local cache only serves the first paint.
import { browserThemeController } from "./ui/theme.js";
import { createApiClient } from "./core/api.js";
import { createStore } from "./core/store.js";
import { createRouter } from "./core/router.js";
import { createShell } from "./ui/shell.js";
import { setCatalog, setTypeIcons } from "./ui/icons.js";
import { sliceFor } from "./core/store.js";
import { installUnloadWarning } from "./core/unsaved.js";

// Closing or reloading the tab with unsaved changes makes the browser ask (UX review of eefd115, finding 3).
installUnloadWarning(window);

const theme = browserThemeController(window);
const api = createApiClient();
const store = createStore({ api });
// The icon catalogue is installed BEFORE the shell subscribes, so every render already draws custom
// icons and the workspace's type icons (BT-011-05).
let appliedIcons = null;
store.subscribe((state) => {
  const data = sliceFor(state, "icons").data;
  if (data === appliedIcons) return;
  appliedIcons = data;
  // While another workspace's icons load (or if they fail), its type icons are cleared at once.
  if (data) setCatalog(data.catalog, data.typeIcons); else setTypeIcons({});
});
const router = createRouter(window);
const shell = createShell({ mountPoint: document.getElementById("app"), store, router, theme, api });

let appliedPrefs = null;
store.subscribe((state) => {
  const prefs = state.preferences;
  if (!prefs || prefs === appliedPrefs) return;
  appliedPrefs = prefs;
  if (prefs.effective.themeMode && prefs.effective.themeMode !== theme.getMode()) theme.setMode(prefs.effective.themeMode);
  if (prefs.effective.themePalette && prefs.effective.themePalette !== theme.getTheme()) theme.setTheme(prefs.effective.themePalette);
});

router.start();
store.actions.init().then(() => shell.render());
