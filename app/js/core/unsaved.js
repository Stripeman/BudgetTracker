// Unsaved changes across the app (UX/accessibility review of eefd115, finding 3). A card with edits not yet
// saved registers here by a key and the name people know it by; the router asks before leaving the page
// within the app (the shell shows the question), and the browser asks before the tab is closed or reloaded.
// Nothing is saved or thrown away here: this only remembers that something would be lost.
const pending = new Map();

export function trackUnsaved(key, name, dirty) {
  if (dirty) pending.set(key, name); else pending.delete(key);
}

// The names of the places with unsaved changes, in the order they were first changed.
export function unsavedNames() {
  return [...pending.values()];
}

export function clearUnsaved() {
  pending.clear();
}

// The browser's own "Leave site?" question when the tab is closed or reloaded with unsaved changes.
export function installUnloadWarning(win) {
  win.addEventListener("beforeunload", (event) => {
    if (!pending.size) return;
    event.preventDefault();
    event.returnValue = "";
  });
}
