// DROPDOWN SMOKE (BT-004-04/05): TaskTracker's command picker inside a dialog, driven with REAL key
// presses in Edge. Enter opens the list onto its search box, typing searches, Enter chooses, and
// Escape closes the list BEFORE the dialog; a list without a search box moves by type-ahead.
export const name = "dropdown";
export const title = "Command picker in the Add account dialog: open, search and choose with real keys; Escape closes the list before the dialog";
export const needsBrowser = true;

export async function run(h, t) {
  const { alice } = await h.browsers(["alice"], { prefix: "dropdown-" });
  await alice.open("accounts");
  await alice.click({ role: "button", name: "Add account", scope: ".page-head" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Add account dialog" });
  const currency = { css: ".cmdpick__trigger", label: "Currency", scope: ".modal" };
  try { await alice.locate(currency); } catch { t.skip("command picker in a dialog", "the Add account dialog has no Currency command picker at this commit"); return; }

  await alice.locate({ ...currency, focus: true });
  await alice.press("Enter");
  let state = await alice.pickerState();
  t.check("Enter on the Currency trigger opens its list with the search box focused, inside the open dialog", {
    expected: { open: true, dialog: true, search: true, focus: "cmdpick__search" }, actual: { open: state.open, dialog: state.dialog, search: state.search, focus: state.focus },
  });
  const focused = await alice.axFocused();
  const listboxes = await alice.axFind("listbox", "Currency");
  t.check("accessibility tree: focus is on a combobox named Search currency, and a listbox named Currency is present", {
    expected: { focused: { role: "combobox", name: "Search currency" }, listboxes: 1 },
    actual: { focused: focused ? { role: focused.role, name: focused.name } : null, listboxes: listboxes.length },
  });
  await alice.typeKeys("gb");
  state = await alice.pickerState();
  t.check("typing g, b (real key presses) leaves only GBP", { expected: { rows: ["GBP"], active: "GBP" }, actual: { rows: state.rows, active: state.active } });
  await alice.shot("1-currency-search");
  await alice.press("Enter");
  state = await alice.pickerState();
  const chosen = (await alice.locate(currency)).name;
  t.check("Enter chooses GBP, closes the list, keeps the dialog and returns focus to the trigger", {
    expected: { open: false, dialog: true, trigger: "Currency: GBP. Search and choose.", focusOnTrigger: true },
    actual: { open: state.open, dialog: state.dialog, trigger: chosen, focusOnTrigger: /cmdpick__trigger/.test(String(state.focus)) },
  });

  await alice.press("Enter");
  state = await alice.pickerState();
  t.check("Enter opens the list again", { expected: true, actual: state.open });
  await alice.press("Escape");
  state = await alice.pickerState();
  t.check("the first Escape closes only the list: the dialog stays open, focus on the trigger", {
    expected: { open: false, dialog: true, focusOnTrigger: true }, actual: { open: state.open, dialog: state.dialog, focusOnTrigger: /cmdpick__trigger/.test(String(state.focus)) },
  });
  await alice.press("Escape");
  state = await alice.pickerState();
  t.check("the second Escape closes the dialog", { expected: false, actual: state.dialog });
  await alice.shot("2-after-escapes");

  // A short list without a search box: type-ahead, as a native select.
  await alice.click({ role: "button", name: "Add account", scope: ".page-head" });
  await alice.waitFor("!!document.querySelector('.modal')", { what: "the Add account dialog again" });
  const type = { css: ".cmdpick__trigger", label: "Type", scope: ".modal" };
  await alice.locate({ ...type, focus: true });
  await alice.press("Enter");
  state = await alice.pickerState();
  if (state.search) {
    t.skip("type-ahead in a list without a search box", "the Type list has a search box at this commit");
  } else {
    await alice.press("s");
    state = await alice.pickerState();
    t.check("in the Type list (no search box) the key s moves to an option starting with S", { expected: true, actual: { open: state.open, active: state.active, pass: state.open && /^s/i.test(String(state.active)) }.pass });
    await alice.press("Escape");
    state = await alice.pickerState();
    t.check("Escape closes the Type list and keeps the dialog", { expected: { open: false, dialog: true }, actual: { open: state.open, dialog: state.dialog } });
  }
  await alice.press("Escape");
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: alice.problems() });
}
