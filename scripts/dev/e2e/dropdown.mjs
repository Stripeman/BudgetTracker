// DROPDOWN (BT-004-04/05): TaskTracker's command picker, driven with REAL key presses, clicks, wheel
// scrolls and touches in Edge, and read back from the page and the accessibility tree. The first part
// is the harness's original smoke test (open, search, choose, the Escape order, type-ahead). The rest
// checks the fixes of the accessibility and UX reviews of be25017 (branch fix/picker-a11y): the trigger
// is a combobox, results are announced, the panel lives in the dialog, the keys a native select has,
// a press outside gives focus back, the list follows a resized window and a scrolled dialog, it is
// readable at 400 % zoom, and on a touch screen no keyboard pops up unasked.
export const name = "dropdown";
export const title = "Command picker: search and choose with real keys; combobox trigger, announcements, outside press, 400 % zoom, scrolling, touch";
export const needsBrowser = true;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODAL = "!!document.querySelector('.modal')";
const PANEL = "!!document.querySelector('.cmdpick__panel:not([hidden])')";
const addAccount = { role: "button", name: "Add account", scope: ".page-head" };
const currency = { css: ".cmdpick__trigger", label: "Currency", scope: ".modal" };
const type = { css: ".cmdpick__trigger", label: "Type", scope: ".modal" };
const onTrigger = (state) => /cmdpick__trigger/.test(String(state.focus));

// The focused element as the accessibility tree has it: role, name and value.
async function focusedAx(s) {
  const f = await s.axFocused();
  return f ? { role: f.role, name: f.name, value: f.value } : null;
}

async function openAddAccount(s) {
  await s.click(addAccount);
  await s.waitFor(MODAL, { what: "the Add account dialog" });
}

// What the open panel's status region says once typing has paused (it is cleared on every key).
async function announced(s) {
  await s.waitFor("(() => { const n = document.querySelector('.cmdpick__panel .cmdpick__status'); return !!n && n.textContent !== ''; })()", { what: "the result count to be announced", timeout: 4000 });
  return s.evaluate("(() => { const n = document.querySelector('.cmdpick__panel .cmdpick__status'); return { said: n.textContent, role: n.getAttribute('role'), live: n.getAttribute('aria-live') }; })()");
}

// Where the open panel is against the trigger labelled `label`.
const geometry = (label) => `(() => {
  const l = [...document.querySelectorAll('label')].find((x) => x.textContent === ${JSON.stringify(label)});
  const t = l && document.getElementById(l.getAttribute('for'));
  const p = document.querySelector('.cmdpick__panel');
  if (!t) return null;
  const tr = t.getBoundingClientRect();
  const pr = p ? p.getBoundingClientRect() : null;
  return { open: !!p, trigTop: Math.round(tr.top), trigBottom: Math.round(tr.bottom), panelTop: pr && Math.round(pr.top), panelBottom: pr && Math.round(pr.bottom), panelLeft: pr && Math.round(pr.left), panelRight: pr && Math.round(pr.right), vw: innerWidth, vh: innerHeight };
})()`;
// Against its trigger: 4 px below it, or 4 px above it.
const againstTrigger = (g) => !!g && g.open && (Math.abs(g.panelTop - (g.trigBottom + 4)) <= 1 || Math.abs(g.panelBottom - (g.trigTop - 4)) <= 1);

export async function run(h, t) {
  const { alice } = await h.browsers(["alice"], { prefix: "dropdown-" });
  await alice.open("accounts");
  await openAddAccount(alice);
  try { await alice.locate(currency); } catch { t.skip("command picker in a dialog", "the Add account dialog has no Currency command picker at this commit"); return; }

  // ---- the harness's original smoke test, with the combobox trigger -------------------------------
  await alice.locate({ ...currency, focus: true });
  t.check("the closed Currency trigger is a combobox named by its field, its value spoken (a11y finding 6)", {
    expected: { role: "combobox", name: "Currency", value: "EUR" }, actual: await focusedAx(alice),
  });
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
  const inDialog = await alice.evaluate("document.querySelector('.modal').contains(document.querySelector('.cmdpick__panel'))");
  const options = await alice.axFind("option");
  t.check("the open panel is inside the aria-modal dialog, and its options are in the accessibility tree (a11y finding 4)", {
    expected: { inDialog: true, optionsInTree: true }, actual: { inDialog, optionsInTree: options.length >= 3 },
  });
  await alice.typeKeys("gb");
  state = await alice.pickerState();
  t.check("typing g, b (real key presses) leaves only GBP", { expected: { rows: ["GBP"], active: "GBP" }, actual: { rows: state.rows, active: state.active } });
  t.check("once typing pauses, a polite status region in the panel says how many results (a11y finding 3)", {
    expected: { said: "1 result", role: "status", live: "polite" }, actual: await announced(alice),
  });
  await alice.shot("1-currency-search");
  await alice.press("Enter");
  state = await alice.pickerState();
  t.check("Enter chooses GBP, closes the list, keeps the dialog and returns focus to the trigger, whose value is now GBP", {
    expected: { open: false, dialog: true, focused: { role: "combobox", name: "Currency", value: "GBP" } },
    actual: { open: state.open, dialog: state.dialog, focused: await focusedAx(alice) },
  });

  await alice.press("Enter");
  state = await alice.pickerState();
  t.check("Enter opens the list again", { expected: true, actual: state.open });
  await alice.press("Escape");
  state = await alice.pickerState();
  t.check("the first Escape closes only the list: the dialog stays open, focus on the trigger", {
    expected: { open: false, dialog: true, focusOnTrigger: true }, actual: { open: state.open, dialog: state.dialog, focusOnTrigger: onTrigger(state) },
  });
  await alice.press("Escape");
  state = await alice.pickerState();
  t.check("the second Escape closes the dialog", { expected: false, actual: state.dialog });
  await alice.shot("2-after-escapes");

  // A short list without a search box: type-ahead, as a native select.
  await openAddAccount(alice);
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

  // ---- the keys a native select has (a11y finding 7, UX review U3) ---------------------------------
  await sleep(600); // the type-ahead from "s" has expired
  await alice.press("ArrowUp");
  state = await alice.pickerState();
  t.check("ArrowUp on the closed Type trigger opens its list on the chosen type", { expected: { open: true, active: "Checking" }, actual: { open: state.open, active: state.active } });
  await alice.press("Escape");
  await alice.typeKeys("me");
  state = await alice.pickerState();
  t.check("typing m, e on the closed Type trigger opens the list and reaches Merchant credit past Mortgage (multi-letter type-ahead)", {
    expected: { open: true, search: false, active: "Merchant credit" }, actual: { open: state.open, search: state.search, active: state.active },
  });
  await sleep(600);
  await alice.press("Space");
  state = await alice.pickerState();
  t.check("after a pause, Space chooses the active type and focus is back on the trigger, valued Merchant credit", {
    expected: { open: false, focused: { role: "combobox", name: "Type", value: "Merchant credit" } }, actual: { open: state.open, focused: await focusedAx(alice) },
  });
  await alice.locate({ ...currency, focus: true });
  await alice.press("Enter");
  await alice.press("PageDown");
  state = await alice.pickerState();
  t.check("PageDown moves ten currencies down the list (EUR, USD, GBP, CHF, SEK, NOK, DKK, PLN, CZK, HUF, CAD)", { expected: { first: "EUR", active: "CAD" }, actual: { first: state.rows[0], active: state.active } });
  await alice.typeKeys("u");
  const firstMatch = (await alice.pickerState()).active;
  await alice.press("End");
  const box = await alice.evaluate("({ caret: document.activeElement.selectionStart, value: document.activeElement.value })");
  state = await alice.pickerState();
  t.check("End in the search box moves its text cursor, and the list stays on its first match", {
    expected: { caret: 1, value: "u", active: firstMatch }, actual: { caret: box.caret, value: box.value, active: state.active },
  });
  await alice.typeKeys("zz");
  t.check("a search that finds nothing is announced", { expected: "Nothing matches “uzz”.", actual: (await announced(alice)).said });

  // ---- a press outside the list (a11y finding 2) ---------------------------------------------------
  const heading = await alice.locate({ css: ".modal h2" });
  await alice.mouseClick(heading.x, heading.y);
  await sleep(300);
  state = await alice.pickerState();
  const afterPress = await focusedAx(alice);
  t.check("a press on the dialog's title closes the list and puts focus back on the Currency combobox, inside the dialog", {
    expected: { open: false, dialog: true, inside: true, focused: { role: "combobox", name: "Currency" } },
    actual: { open: state.open, dialog: state.dialog, inside: await alice.evaluate("document.querySelector('.modal').contains(document.activeElement)"), focused: afterPress && { role: afterPress.role, name: afterPress.name } },
  });
  await alice.press("Escape");

  // ---- a resized window: the open list is placed again (a11y finding 5, UX review U1) --------------
  await alice.goto("transactions");
  await alice.evaluate("(() => { const f = document.querySelector('.filters-box'); if (f) f.open = true; })()");
  const categoryFilter = await alice.locate({ css: ".cmdpick__trigger", label: "Category", scope: ".filters" });
  await alice.mouseClick(categoryFilter.x, categoryFilter.y);
  await alice.waitFor(PANEL, { what: "the Category filter list" });
  await alice.cdp.send("Emulation.setDeviceMetricsOverride", { width: 820, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  const resized = await alice.evaluate(geometry("Category"));
  t.check("after the window narrows from 1280 to 820 px the open list is inside it (or closed, if its trigger left)", {
    expected: "8 <= left and right <= width - 8", actual: resized, pass: !!resized && (!resized.open || (resized.panelLeft >= 8 && resized.panelRight <= resized.vw - 8)),
  });
  await alice.press("Escape");

  // ---- 400 % zoom: 1280 x 1024 at 400 % is 320 x 256 CSS pixels (a11y finding 1) -------------------
  const { alice: zoomed } = await h.browsers(["alice"], { prefix: "dropdown-zoom-", width: 320, height: 256 });
  await zoomed.open("accounts");
  await openAddAccount(zoomed);
  const zoomCurrency = await zoomed.locate(currency);
  await zoomed.mouseClick(zoomCurrency.x, zoomCurrency.y);
  await zoomed.waitFor(PANEL, { what: "the Currency list at 400 %" });
  const zoom = await zoomed.evaluate("(() => { const p = document.querySelector('.cmdpick__panel').getBoundingClientRect(); const l = document.querySelector('.cmdpick__list').getBoundingClientRect(); const o = document.querySelector('.cmdpick__opt').getBoundingClientRect(); return { inside: p.left >= 0 && p.top >= 0 && p.right <= innerWidth && p.bottom <= innerHeight, listHeight: Math.round(l.height), rowHeight: Math.round(o.height), hints: getComputedStyle(document.querySelector('.cmdpick__foot')).display, viewport: [innerWidth, innerHeight] }; })()");
  t.check("at 320 x 256 (400 % zoom) the list is inside the viewport with at least two and a half readable rows, and the key hints give way", {
    expected: "inside; list height >= 2.5 rows; hints display none", actual: zoom, pass: zoom.inside && zoom.listHeight >= 2.5 * zoom.rowHeight && zoom.hints === "none",
  });
  await zoomed.shot("3-currency-400-percent");

  // ---- a scrolled dialog: the list moves with its trigger, and closes when it leaves (a11y 5, U1) ---
  const { alice: narrow } = await h.browsers(["alice"], { prefix: "dropdown-narrow-", width: 390, height: 600 });
  await narrow.open("bills");
  await narrow.click({ role: "button", name: "Add bill", scope: ".page-head" });
  await narrow.waitFor(MODAL, { what: "the Add bill dialog" });
  const billType = await narrow.locate({ css: ".cmdpick__trigger", label: "Type", scope: ".modal" });
  await narrow.mouseClick(billType.x, billType.y);
  await narrow.waitFor(PANEL, { what: "the bill Type list" });
  const before = await narrow.evaluate(geometry("Type"));
  // Beside the panel (a list without a search box is 15rem wide), over the dialog body.
  const wheelAt = await narrow.evaluate("(() => { const r = document.querySelector('.modal__body').getBoundingClientRect(); return { x: r.right - 12, y: r.top + 60 }; })()");
  await narrow.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: wheelAt.x, y: wheelAt.y, deltaX: 0, deltaY: 40 });
  await sleep(400);
  const after = await narrow.evaluate(geometry("Type"));
  t.check("scrolling the dialog a little moves the open list with its trigger", {
    expected: "4 px against its trigger, before and after the trigger moved", actual: { before, after }, pass: againstTrigger(before) && againstTrigger(after) && after.trigTop !== before.trigTop,
  });
  await narrow.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: wheelAt.x, y: wheelAt.y, deltaX: 0, deltaY: 900 });
  await sleep(500);
  state = await narrow.pickerState();
  const gone = await focusedAx(narrow);
  t.check("scrolling its trigger out of sight closes the list and leaves focus on the trigger", {
    expected: { open: false, focused: { role: "combobox", name: "Type" } }, actual: { open: state.open, focused: gone && { role: gone.role, name: gone.name } },
  });
  await narrow.shot("4-bill-type-scrolled-away");

  // ---- a touch screen: a searched list opens on the list, so no keyboard pops up unasked (UX U2) ---
  const { alice: phone } = await h.browsers(["alice"], { prefix: "dropdown-touch-", width: 390, height: 844 });
  await phone.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await phone.open("accounts");
  const coarse = await phone.evaluate("matchMedia('(pointer: coarse)').matches");
  await openAddAccount(phone);
  const tap = await phone.locate(currency);
  await phone.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tap.x, y: tap.y }] });
  await phone.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(600);
  state = await phone.pickerState();
  t.check("with touch emulation ((pointer: coarse)) a tap opens the Currency list with focus on the list, its search box still offered", {
    expected: { coarse: true, open: true, search: true, focusOnList: true }, actual: { coarse, open: state.open, search: state.search, focusOnList: /cmdpick__list/.test(String(state.focus)) },
  });
  await phone.shot("5-touch-currency");
  await phone.press("u");
  state = await phone.pickerState();
  t.check("typing on an attached keyboard moves to the search box with that letter", {
    expected: { focusOnSearch: true, value: "u" }, actual: { focusOnSearch: /cmdpick__search/.test(String(state.focus)), value: await phone.evaluate("document.activeElement.value") },
  });

  for (const [who, s] of [["alice", alice], ["alice at 400 %", zoomed], ["alice at 390 x 600", narrow], ["alice on a touch screen", phone]]) {
    t.check(`${who}: no exceptions, console errors or failed requests in the browser`, { expected: [], actual: s.problems() });
  }
}
