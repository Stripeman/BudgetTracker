// Ported from TaskTracker app/js/ui/popup.js (T: main fb24a41), unchanged in behaviour. BudgetTracker
// had no shared dismissal registry; the command picker (app/js/ui/commandpicker.js) is its first
// member. The theme, icon and merchant pickers keep their own dismissal: they open in normal flow,
// inside their field, rather than over the page.
//
// HOW A POPUP IS DISMISSED — one rule, registered once, obeyed by every control that opens a panel
// over the page.
//
// FOCUS IS THE WRONG SIGNAL FOR A POINTER. It answers "where did the keyboard go", and a click on
// inert text moves the keyboard nowhere at all. The right signal is the press itself, watched once
// at the document, which is what this module does. A control's own `focusout` handler keeps its own
// job — a TAB out of a popup is somebody leaving it — and focus that went nowhere is not somebody
// leaving, because the pointer path handles the pointer.
//
// THE FIVE PROMISES (app/test/popupdismiss.test.js):
//
//   1. A press outside the popup closes it.
//   2. A press inside it — including on its own trigger — does not.
//   3. Opening one popup closes whichever was already open.
//   4. Escape closes the popup and never the dialog around it. (Each control still owns this,
//      because it has to stop the event, and stopping is a property of where you listen.)
//   5. Dismissing changes nothing. A popup closes; it never writes a value.
//
// MOUSEDOWN, NOT CLICK. A control that commits on `mousedown` — every palette row does, because the
// search box blurs first otherwise — must see its own press before anything dismisses the panel
// underneath it. Touch is covered by the compatibility mouse events every browser still sends.
//
// POPUPS NEST, AND THE RULE HAS TO KNOW IT. A popup that contains another's anchor is not a rival
// and is not closed when the inner one opens or is used.
//
// ONE LISTENER, whatever the population. It is attached when the first popup in a document
// registers and removed when the last one goes.
//
// BUDGETTRACKER ADAPTATION (BT-004-05). A popup whose control left the page WHILE OPEN is closed as
// its registration is pruned, instead of leaving its floating panel on the body with nothing to
// dismiss it — the command picker's panel lives on the body, so a view that re-renders, or a dialog
// that closes, would otherwise strand it. `closeDetachedPopups()` runs that sweep on demand; the
// modal calls it as it closes.

// Every live popup, in registration order. Small by construction.
const popups = new Set();

// Per DOCUMENT, because the test harness installs a fresh one for every case. Weak, so a document
// that goes away takes its bookkeeping with it.
const attached = new WeakMap();

/**
 * @param {object} popup
 * @param {(node: any) => boolean} popup.contains
 *        whether a node belongs to this popup. It must answer TRUE FOR THE TRIGGER as well as for
 *        the panel, or the trigger's own press would close it and its click re-open it.
 * @param {() => void} popup.close     dismiss it. Must not restore focus and must not change the value.
 * @param {() => boolean} popup.isOpen
 * @param {() => any} popup.ownerDocument  the document to watch.
 * @param {() => any} [popup.anchor]   the control's node IN THE DOCUMENT TREE — not its floating panel.
 * @returns {{opened: () => void, destroy: () => void}}
 */
export function registerPopup({ contains, close, isOpen, ownerDocument, anchor = null } = {}) {
  if (typeof contains !== "function" || typeof close !== "function" || typeof isOpen !== "function") {
    throw new Error("registerPopup needs contains(), close() and isOpen().");
  }
  const entry = { contains, close, isOpen, ownerDocument, anchor, wasAttached: false };
  // A CONTROL THAT WENT AWAY TAKES ITS REGISTRATION WITH IT. Nothing guarantees destroy() is called
  // when a dialog's overlay is simply removed, so departed registrations are pruned here.
  prune();
  popups.add(entry);
  attach(documentOf(entry));

  return {
    // Called by the control AFTER it has opened, so "one at a time" is enforced from the one
    // place that knows about all of them.
    opened() {
      entry.wasAttached = true;
      const mine = anchorOf(entry);
      for (const other of popups) {
        if (other === entry || !other.isOpen()) continue;
        // NOT A RIVAL: the panel this one opened INSIDE.
        if (mine && other.contains(mine)) continue;
        other.close();
      }
    },
    destroy() {
      if (!popups.delete(entry)) return;
      detach(documentOf(entry));
    },
  };
}

// FOR TESTS AND FOR NOTHING ELSE.
export function _popupCount() {
  return popups.size;
}

// Closes and forgets every popup whose control has left its document (see the adaptation above).
export function closeDetachedPopups() {
  prune();
}

// DETACHED IS NOT THE SAME AS NEVER ATTACHED. A control registers while it is still being built —
// the caller appends `element` afterwards — so "not in the document" is the normal state for a
// moment, and dropping it then would unregister every popup at birth.
function prune() {
  for (const entry of Array.from(popups)) {
    const doc = documentOf(entry);
    const anchor = anchorOf(entry);
    const inDocument = !!(anchor && doc && doc.body && doc.body.contains(anchor));
    if (inDocument) {
      entry.wasAttached = true;
      continue;
    }
    if (!entry.wasAttached) continue;
    // Its panel goes with it (adaptation above). close() neither moves focus nor writes a value.
    try {
      if (entry.isOpen()) entry.close();
    } catch (e) { /* a control that is already torn down has nothing left to close */ }
    popups.delete(entry);
    detach(doc);
  }
}

function anchorOf(entry) {
  try {
    return typeof entry.anchor === "function" ? entry.anchor() : null;
  } catch (e) {
    return null;
  }
}

function documentOf(entry) {
  try {
    return typeof entry.ownerDocument === "function" ? entry.ownerDocument() : null;
  } catch (e) {
    return null;
  }
}

function attach(doc) {
  if (!doc || typeof doc.addEventListener !== "function") return;
  const state = attached.get(doc);
  if (state) {
    state.count += 1;
    return;
  }
  const handler = (event) => dismissOutside(doc, event);
  doc.addEventListener("mousedown", handler);
  attached.set(doc, { handler, count: 1 });
}

function detach(doc) {
  if (!doc) return;
  const state = attached.get(doc);
  if (!state) return;
  state.count -= 1;
  if (state.count > 0) return;
  if (typeof doc.removeEventListener === "function") doc.removeEventListener("mousedown", state.handler);
  attached.delete(doc);
}

function dismissOutside(doc, event) {
  const target = event && event.target;
  // A snapshot, because closing one popup may destroy another.
  prune();
  const live = Array.from(popups).filter((entry) => documentOf(entry) === doc);

  // Who the press belongs to — and then who is HOSTING them.
  const keep = new Set(target ? live.filter((entry) => entry.contains(target)) : []);
  for (const owner of Array.from(keep)) {
    const anchor = anchorOf(owner);
    if (!anchor) continue;
    for (const entry of live) if (entry.contains(anchor)) keep.add(entry);
  }

  for (const entry of live) {
    // ALREADY CLOSED IS NOT ASKED TO CLOSE.
    if (!entry.isOpen()) continue;
    if (keep.has(entry)) continue;
    // What was pressed is passed on (adaptation, a11y review finding 2): the registry still never moves
    // focus, but the control may, when the press landed on something that cannot take focus.
    entry.close({ reason: "outside", target });
  }
}
