// NO DROPDOWN MAY SHIFT SURROUNDING CONTENT (Terry, 2026-09-18, screenshots of the Icon picker in
// Add Bill, Add Budget, Add Account and Add Merchant: "Opening the Icon dropdown creates a large
// gap and pushes subsequent fields down. This is unacceptable throughout the application.").
//
// Root cause (confirmed by reading the source, not guessed): `createThemePicker`
// (app/js/ui/themepicker.js), the shared control behind the Icon, Theme/Appearance and category
// Colour pickers, opened its list as a normal-flow sibling of its own toggle — core/popover.js's
// own header comment already named this as pre-existing, unfixed debt ("the theme and icon pickers
// open in normal flow"). Fixed at the root, in the shared component (app/js/ui/overlay.js, extracted
// from commandpicker.js so both share the identical engine): the list is now a `position: fixed`
// overlay, portaled to the nearest dialog or the body, positioned below the toggle or above when
// there is no room, capped and scrolled inside itself, and following the toggle on scroll/resize —
// never a normal-flow sibling any more, on ANY of its callers, not four isolated CSS patches.
//
// dropdown.mjs already covers the command picker's own overlay contract exhaustively (Category,
// Account, Status, Merchant, Workspace, …) and re-passed unmodified after the extraction (proof the
// shared engine did not change command-picker behaviour). This scenario is the dedicated proof for
// the ACTUAL regression Terry reported: the Icon/Theme/Colour picker, on every form named in his
// screenshots plus the Workspace Appearance picker, on desktop and mobile.
import { createWorkspace, firstRecord } from "../harness/fixtures.mjs";

export const name = "overlay";
export const title = "No dropdown may shift surrounding content: the Icon/Theme/Colour picker is now a floating overlay (Add Bill, Add Budget, Add Account, Add Merchant, Workspace Appearance), verified on desktop and mobile";
export const needsBrowser = true;

const MODAL = "!!document.querySelector('.modal')";
const LISTBOX_OPEN = "!!document.querySelector('[role=\"listbox\"]:not([hidden])')";

// Everything below the Icon field that must never move: here, the dialog's own footer (Save/
// Cancel) — the most visible, concrete proof of "pushes subsequent fields down" from the report.
const footerGeometry = () => `(() => {
  const footer = document.querySelector('.modal__foot');
  const visible = (b) => !b.hidden && !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length);
  const save = footer ? [...footer.querySelectorAll('button, [type=submit]')].find((b) => visible(b) && b.classList.contains('btn--primary')) || [...footer.querySelectorAll('button, [type=submit]')].find(visible) : null;
  const modal = document.querySelector('.modal');
  return {
    footerTop: footer ? Math.round(footer.getBoundingClientRect().top) : null,
    saveTop: save ? Math.round(save.getBoundingClientRect().top) : null,
    modalHeight: modal ? Math.round(modal.getBoundingClientRect().height) : null,
  };
})()`;

async function checkNoReflow(s, t, { open, formName, iconValue }) {
  await open();
  await s.waitFor(MODAL, { what: `the ${formName} dialog` });
  const before = await s.evaluate(footerGeometry());
  const iconTrigger = await s.locate({ css: ".themepick__toggle", scope: ".modal" });
  await s.mouseClick(iconTrigger.x, iconTrigger.y);
  await s.waitFor(LISTBOX_OPEN, { what: `the Icon list to open in ${formName}` });
  const opened = await s.evaluate(footerGeometry());
  const shot = await s.shot(`overlay-${formName.toLowerCase().replace(/\s+/g, "-")}-open`);
  t.check(`${formName}: opening the Icon dropdown moves nothing else — the footer/Save button and the dialog's own height are unchanged`, {
    expected: before, actual: opened,
  });
  // The panel itself must be a real overlay: fixed position, not a normal-flow box.
  const panelStyle = await s.evaluate("(() => { const l = document.querySelector('[role=\"listbox\"]:not([hidden])'); return l ? getComputedStyle(l).position : null; })()");
  t.check(`${formName}: the open Icon panel is positioned "fixed" (a real overlay), not in normal document flow`, { expected: "fixed", actual: panelStyle });
  // Closing (Escape) preserves the field's own value and does not close the dialog.
  await s.press("Escape");
  await s.waitFor(`!(${LISTBOX_OPEN})`, { what: `the Icon list to close in ${formName}` });
  t.check(`${formName}: Escape closes only the Icon list, the dialog stays open`, { expected: true, actual: await s.evaluate(MODAL) });
  const closed = await s.evaluate(footerGeometry());
  t.check(`${formName}: after closing, the footer is exactly where it started (nothing left behind)`, { expected: before, actual: closed });
  const stillHasIcon = await s.evaluate("(() => { const t = document.querySelector('.themepick__toggle'); const svg = t && t.querySelector('svg'); return svg ? svg.getAttribute('data-icon') : null; })()");
  if (iconValue !== undefined) {
    t.check(`${formName}: the field's own icon value survived opening and closing without picking anything`, { expected: iconValue, actual: stillHasIcon });
  }
  t.note(`${formName}: screenshot ${shot}`);
  await s.press("Escape");
  await s.waitFor(`!(${MODAL})`, { what: `the ${formName} dialog to close` });
}

export async function run(h, t) {
  const W = await createWorkspace(h, { name: "E2E Overlay Household", kind: "household" });
  const q = W.q;
  const api = h.api("alice");
  const account = firstRecord(await api.ok("accounts", { method: "POST", query: q, body: { name: "E2E Overlay Checking", type: "checking", currency: "USD", openingBalance: "500.00" } }));
  t.note(`workspace ${W.name}: ${W.id}; account ${account.id}`);

  const { alice } = await h.browsers(["alice"], { prefix: "overlay-" });
  await alice.open("dashboard");
  await alice.useWorkspace(W.name);

  // ---- the four forms from Terry's own screenshots -------------------------------------------------
  await alice.goto("accounts");
  await alice.waitForText("Add account", { scope: "main" });
  await checkNoReflow(alice, t, { formName: "Add account", open: () => alice.click({ role: "button", name: "Add account", scope: ".page-head" }) });

  await alice.goto("bills");
  await alice.waitForText("Add bill", { scope: "main" });
  await checkNoReflow(alice, t, { formName: "Add bill", open: () => alice.click({ role: "button", name: "Add bill" }) });

  await alice.goto("planning");
  await alice.waitForText("Add budget", { scope: "main" });
  await checkNoReflow(alice, t, { formName: "Add budget", open: () => alice.click({ role: "button", name: "Add budget", scope: ".page-head, main" }) });

  await alice.goto("payees");
  await alice.waitForText("Add merchant", { scope: "main" });
  await checkNoReflow(alice, t, { formName: "Add merchant", open: () => alice.click({ role: "button", name: "Add merchant" }) });

  // ---- long option lists scroll inside a height-limited panel, never growing the page ---------------
  await alice.click({ role: "button", name: "Add merchant" });
  await alice.waitFor(MODAL, { what: "the Add merchant dialog" });
  const iconTrigger = await alice.locate({ css: ".themepick__toggle", scope: ".modal" });
  await alice.mouseClick(iconTrigger.x, iconTrigger.y);
  await alice.waitFor(LISTBOX_OPEN, { what: "the Icon list to open" });
  const scrolling = await alice.evaluate("(() => { const l = document.querySelector('[role=\"listbox\"]:not([hidden])'); const r = l.getBoundingClientRect(); return { scrollable: l.scrollHeight > l.clientHeight, withinViewport: r.top >= 0 && r.bottom <= innerHeight, maxHeightSet: getComputedStyle(l).maxHeight !== 'none' }; })()");
  t.check("the Icon list (50+ entries) scrolls inside its own height-limited panel, entirely within the viewport, never growing the page", {
    expected: { scrollable: true, withinViewport: true, maxHeightSet: true }, actual: scrolling,
  });
  await alice.press("Escape");
  await alice.press("Escape");
  await alice.waitFor(`!(${MODAL})`, { what: "the dialog to close" });

  // ---- opens upward when there is no room below (a short viewport, the trigger near the bottom) ----
  const { alice: short } = await h.browsers(["alice"], { prefix: "overlay-short-", width: 1024, height: 420 });
  await short.open("dashboard");
  await short.useWorkspace(W.name);
  await short.goto("payees");
  await short.waitForText("Add merchant", { scope: "main" });
  await short.click({ role: "button", name: "Add merchant" });
  await short.waitFor(MODAL, { what: "the Add merchant dialog" });
  const shortTrigger = await short.locate({ css: ".themepick__toggle", scope: ".modal" });
  await short.mouseClick(shortTrigger.x, shortTrigger.y);
  await short.waitFor(LISTBOX_OPEN, { what: "the Icon list to open in a short viewport" });
  const flipped = await short.evaluate(`(() => {
    const l = document.querySelector('[role="listbox"]:not([hidden])');
    const r = l.getBoundingClientRect();
    const t = document.querySelector('.themepick__toggle').getBoundingClientRect();
    return { panelBottom: Math.round(r.bottom), panelTop: Math.round(r.top), triggerTop: Math.round(t.top), triggerBottom: Math.round(t.bottom), viewportHeight: innerHeight, insideViewport: r.top >= 0 && r.bottom <= innerHeight };
  })()`);
  const shotFlip = await short.shot("overlay-opens-upward");
  t.check("in a short viewport, the Icon list opens ABOVE its toggle (or is fully visible below) — never clipped off the bottom of the screen", {
    expected: true, actual: flipped.insideViewport && (flipped.panelBottom <= flipped.triggerTop + 1 || flipped.panelBottom <= flipped.viewportHeight),
  });
  t.note(`geometry: ${JSON.stringify(flipped)}; screenshot: ${shotFlip}`);
  await short.press("Escape");

  // ---- mobile layout: the same "no reflow" proof at a phone width -----------------------------------
  const { alice: phone } = await h.browsers(["alice"], { prefix: "overlay-phone-", width: 390, height: 844 });
  await phone.open("dashboard");
  await phone.useWorkspace(W.name);
  await phone.goto("bills");
  await phone.waitForText("Add bill", { scope: "main" });
  await phone.click({ role: "button", name: "Add bill" });
  await phone.waitFor(MODAL, { what: "the Add bill dialog on a phone" });
  const phoneBefore = await phone.evaluate(footerGeometry());
  const phoneTrigger = await phone.locate({ css: ".themepick__toggle", scope: ".modal" });
  await phone.mouseClick(phoneTrigger.x, phoneTrigger.y);
  await phone.waitFor(LISTBOX_OPEN, { what: "the Icon list to open on a phone" });
  const phoneOpened = await phone.evaluate(footerGeometry());
  const phonePanel = await phone.evaluate("(() => { const l = document.querySelector('[role=\"listbox\"]:not([hidden])'); const r = l.getBoundingClientRect(); return { insideViewport: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; })()");
  const shotPhone = await phone.shot("overlay-mobile-add-bill");
  t.check("on a 390 px phone layout, opening the Icon dropdown still moves nothing else, and the panel stays fully inside the viewport", {
    expected: { footer: phoneBefore, panel: { insideViewport: true } }, actual: { footer: phoneOpened, panel: phonePanel },
  });
  t.note(`screenshot: ${shotPhone}`);

  // ---- keyboard navigation, visible focus and touch remain intact on the floated panel ---------------
  const list = await phone.evaluate("!!document.querySelector('[role=\"listbox\"]:not([hidden])')");
  await phone.press("ArrowDown");
  const activeAfterArrow = await phone.evaluate("(() => { const a = document.activeElement; return a && a.getAttribute('role'); })()");
  t.check("keyboard navigation (ArrowDown) still moves focus among real, focusable options inside the floated panel", { expected: { list: true, activeRole: "option" }, actual: { list, activeRole: activeAfterArrow } });
  await phone.press("Escape");
  await phone.waitFor(`!(${LISTBOX_OPEN})`, { what: "the Icon list to close" });
  t.check("Escape closed only the Icon list; the Add bill dialog is still open", { expected: true, actual: await phone.evaluate(MODAL) });
  await phone.press("Escape");
  await phone.waitFor(`!(${MODAL})`, { what: "the dialog to close" });

  // ---- outside-click dismissal on the floated panel still works -------------------------------------
  await alice.goto("bills");
  await alice.waitForText("Add bill", { scope: "main" });
  await alice.click({ role: "button", name: "Add bill" });
  await alice.waitFor(MODAL, { what: "the Add bill dialog" });
  const outsideTrigger = await alice.locate({ css: ".themepick__toggle", scope: ".modal" });
  await alice.mouseClick(outsideTrigger.x, outsideTrigger.y);
  await alice.waitFor(LISTBOX_OPEN, { what: "the Icon list to open" });
  const heading = await alice.locate({ css: ".modal h2" });
  await alice.mouseClick(heading.x, heading.y);
  await alice.settle();
  t.check("a click outside the Icon panel (on the dialog's own title) dismisses it without closing the dialog", {
    expected: { open: false, dialog: true }, actual: { open: await alice.evaluate(LISTBOX_OPEN), dialog: await alice.evaluate(MODAL) },
  });
  await alice.press("Escape");
  await alice.waitFor(`!(${MODAL})`, { what: "the dialog to close" });

  // ---- the personal Settings "Colour palette" picker: the same createThemePicker, outside any
  // modal entirely, with a whole other card ("Display and privacy") right after it ---------------------
  const APPEARANCE = 'section[aria-labelledby="set-appearance"]';
  await alice.goto("settings");
  await alice.waitForText("Colour palette", { scope: "main" });
  // My Settings' own async-loaded sections (category colours/icon catalogue, deleted workspaces —
  // BT-017) can still be settling their own show/hide state for a moment after "Colour palette"
  // itself is already visible; wait for the network to go quiet before taking the baseline
  // measurement, so a real no-reflow proof is never confused with this page's own unrelated,
  // already-in-flight layout settling (the same class of measurement-timing fix as Checkpoint AH's
  // contrast-check false positive — a test-methodology fix, not a product change).
  await alice.settle();
  const belowCard = () => "(() => { const h = document.getElementById('set-display'); return h ? Math.round(h.getBoundingClientRect().top) : null; })()";
  // `locate()` itself does `scrollIntoView({ block: "center" })` on the trigger before computing
  // click coordinates (session.mjs's pageLocate) — a deliberate, existing harness behaviour for
  // reliable clicking, not a product no-reflow bug. Root-caused, not guessed: instrumented with
  // window.scrollY before/after and confirmed the page's OWN scroll position moved (0 -> 18),
  // never its width or document height, exactly matching this. Locating the trigger BEFORE taking
  // the baseline measurement (rather than after, as this check previously did) means both the
  // "before" and "after opening" measurements are taken at the SAME, already-settled scroll
  // position, so the harness's own click-preparation scroll is never mistaken for the dropdown
  // itself moving the page (BT-017's new intro paragraph, which pushed this trigger slightly
  // further from centre than before, is what exposed this pre-existing measurement gap).
  const paletteTrigger = await alice.locate({ css: ".themepick__toggle", scope: APPEARANCE });
  const paletteBefore = await alice.evaluate(belowCard());
  await alice.mouseClick(paletteTrigger.x, paletteTrigger.y);
  await alice.waitFor(LISTBOX_OPEN, { what: "the Colour palette list to open" });
  const paletteOpened = await alice.evaluate(belowCard());
  const paletteStyle = await alice.evaluate("(() => { const l = document.querySelector('[role=\"listbox\"]:not([hidden])'); return l ? getComputedStyle(l).position : null; })()");
  const shotPalette = await alice.shot("overlay-settings-colour-palette");
  t.check("My settings: opening the Colour palette list (outside any modal) does not move the next card down, and the panel is a real fixed overlay", {
    expected: { nextCardTop: paletteBefore, position: "fixed" }, actual: { nextCardTop: paletteOpened, position: paletteStyle },
  });
  t.note(`screenshot: ${shotPalette}`);
  await alice.press("Escape");
  await alice.waitFor(`!(${LISTBOX_OPEN})`, { what: "the Colour palette list to close" });
  const paletteClosed = await alice.evaluate(belowCard());
  t.check("My settings: after closing, the next card is back exactly where it started", { expected: paletteBefore, actual: paletteClosed });

  await alice.settle();
  t.check("alice: no exceptions, console errors or failed requests in the browser", { expected: [], actual: alice.problems() });
}
