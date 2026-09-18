// BT-011-05 — THE ICON REGISTRY. Every icon in the interface comes from here, by a stable id; views
// never draw their own. The ids match the server catalogue (api/_shared/icons.js) and a test keeps
// the two lists equal.
//
// Conventions follow TaskTracker's `icon()` helper (T: main a1ec150, app/js/ui/dom.js): a 24 × 24
// viewBox, `stroke="currentColor"`, no fill, stroke width 1.8, round caps and joins, sized in `em`,
// `aria-hidden="true"` and `focusable="false"`, so an icon takes the colour of its text in every
// theme and palette and never carries meaning on its own. DOCUMENTED ADAPTATIONS: an unknown id
// draws the fallback icon instead of throwing (records can outlive a catalogue entry), and an icon
// can be given an accessible name when it stands alone. The artwork is original simple geometry,
// not copied from TaskTracker or any icon set.
//
// SAFETY: icons are built element by element with createElementNS; there is no markup parsing.
// Custom icons arrive from the server as shape data that was validated on upload, and are checked
// again here against the same allow-list before a single element is created.
import { el, svgEl } from "./dom.js";

const p = (d) => ["path", { d }];
const c = (cx, cy, r) => ["circle", { cx, cy, r }];
const rect = (x, y, width, height, rx = 0) => ["rect", { x, y, width, height, rx }];
const poly = (points) => ["polygon", { points }];

const ART = {
  fallback: [c(12, 12, 9.5), p("M9.2 9.3a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.6-2.8 4"), p("M12 17.4h.01")],
  "money-in": [p("M12 20V5"), p("M5.5 11.5 12 5l6.5 6.5")],
  "money-out": [p("M12 4v15"), p("M18.5 12.5 12 19l-6.5-6.5")],
  transfer: [p("M7 4 3 8l4 4"), p("M3 8h17"), p("M17 12l4 4-4 4"), p("M21 16H4")],
  reversal: [p("M9 14 4 9l5-5"), p("M4 9h10.5a5.5 5.5 0 0 1 0 11H11")],
  // No money moved (BT-009 recheck N3): two parallel lines between two short bars, no arrowheads,
  // like |==| — for an amount owed for a shared expense.
  "no-money-moved": [p("M4 7.5v9"), p("M20 7.5v9"), p("M7 10h10"), p("M7 14h10")],
  // An arrow leaving a box: the link opens in a new tab (BT-011-06).
  external: [p("M14 4h6v6"), p("M20 4l-8.5 8.5"), p("M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10")],
  home: [p("M3 11.5 12 4l9 7.5"), p("M5.5 10v10h13V10"), p("M10 20v-5.5h4V20")],
  bolt: [poly("13 2.5 4.5 13.5 11.5 13.5 10.5 21.5 19.5 10.5 12.5 10.5 13 2.5")],
  cart: [p("M2.5 3.5h2.8l2.4 11a1.8 1.8 0 0 0 1.8 1.4h8a1.8 1.8 0 0 0 1.7-1.3l1.8-6.6H6.1"), c(9.5, 20, 1.4), c(17.5, 20, 1.4)],
  utensils: [p("M6.5 2.5v19"), p("M3.5 2.5v5.5a3 3 0 0 0 6 0V2.5"), p("M17.5 21.5v-19c-2.4 1.2-3.6 3.8-3.6 7.3v4.2h3.6")],
  car: [p("M4.5 16.5H3v-4.8l2.1-4.9h13.8l2.1 4.9v4.8h-1.5"), p("M3 11.7h18"), c(7.5, 16.5, 2), c(16.5, 16.5, 2), p("M9.5 16.5h5")],
  heart: [p("M12 20.5 4.2 12.8a4.9 4.9 0 0 1 6.9-7l.9.9.9-.9a4.9 4.9 0 0 1 6.9 7z")],
  shield: [p("M12 21.5s7.5-3.6 7.5-9.5V5.5L12 2.8 4.5 5.5V12c0 5.9 7.5 9.5 7.5 9.5z"), p("M9 12l2 2 4-4")],
  film: [rect(3, 4, 18, 16, 2), p("M7.5 4v16"), p("M16.5 4v16"), p("M3 9h4.5"), p("M3 15h4.5"), p("M16.5 9H21"), p("M16.5 15H21")],
  bag: [p("M5.5 7.5h13l1 13.5h-15z"), p("M9 10V6.5a3 3 0 0 1 6 0V10")],
  plane: [p("M21 15.5v-2l-8-5V3.8a1.5 1.5 0 0 0-3 0v4.7l-8 5v2l8-2.5v5l-2 1.5v1.5l3.5-1 3.5 1v-1.5l-2-1.5v-5z")],
  book: [p("M12 6.5C10 5 7 4.5 3 5v14c4-.5 7 0 9 1.5 2-1.5 5-2 9-1.5V5c-4-.5-7 0-9 1.5z"), p("M12 6.5v14")],
  gift: [rect(3, 8, 18, 4.5, 1), p("M5 12.5V21h14v-8.5"), p("M12 8v13"), p("M12 8C10.5 4.5 6.5 4.3 6.5 6.4S10.2 8 12 8z"), p("M12 8c1.5-3.5 5.5-3.7 5.5-1.6S13.8 8 12 8z")],
  receipt: [p("M5.5 2.5v19l2.2-1.4 2.1 1.4 2.2-1.4 2.2 1.4 2.1-1.4 2.2 1.4v-19l-2.2 1.4-2.1-1.4-2.2 1.4-2.2-1.4-2.1 1.4z"), p("M9 8h6"), p("M9 11.5h6"), p("M9 15h3.5")],
  percent: [p("M19 5 5 19"), c(7, 7, 2.5), c(17, 17, 2.5)],
  briefcase: [rect(2.5, 7, 19, 13.5, 2), p("M8.5 7V5a1.8 1.8 0 0 1 1.8-1.8h3.4A1.8 1.8 0 0 1 15.5 5v2"), p("M2.5 12.5h19")],
  coins: [p("M4 7c0-1.4 3.6-2.5 8-2.5s8 1.1 8 2.5-3.6 2.5-8 2.5S4 8.4 4 7z"), p("M4 7v5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V7"), p("M4 12v5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-5")],
  tag: [p("M20.4 13.4l-7 7a1.9 1.9 0 0 1-2.7 0L2.5 12.2V2.5h9.7l8.2 8.2a1.9 1.9 0 0 1 0 2.7z"), c(7.3, 7.3, 1.4)],
  wifi: [p("M2.5 9a14 14 0 0 1 19 0"), p("M5.5 12.5a9.5 9.5 0 0 1 13 0"), p("M8.7 16a5 5 0 0 1 6.6 0"), p("M12 19.6h.01")],
  phone: [rect(6.5, 2.5, 11, 19, 2.2), p("M10.8 18h2.4")],
  droplet: [p("M12 3.2l5.3 5.4a7.5 7.5 0 1 1-10.6 0z")],
  flame: [p("M12 21.5a6.8 6.8 0 0 0 6.8-6.8c0-3.8-2.8-5.9-3.9-8.9-1 2-2 2.9-2.9 2.9 0-2.1-.9-4.1-2.9-6.2 0 4-4 6.6-4 11.9a6.9 6.9 0 0 0 6.9 7.1z")],
  coffee: [p("M16.5 9h1.2a3.3 3.3 0 0 1 0 6.6h-1.2"), p("M3.5 9h13v7.5a4 4 0 0 1-4 4h-5a4 4 0 0 1-4-4z"), p("M7 2.5v3"), p("M10.5 2.5v3"), p("M14 2.5v3")],
  fuel: [p("M3.5 21.5V4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v17"), p("M2.5 21.5h13"), p("M3.5 10h11"), p("M14.5 8h2a1.8 1.8 0 0 1 1.8 1.8v6.7a1.6 1.6 0 0 0 3.2 0V8.5l-3-3")],
  train: [rect(5, 3, 14, 13.5, 3), p("M5 10.5h14"), p("M9 14h.01"), p("M15 14h.01"), p("M8.5 21l2-4.5"), p("M15.5 21l-2-4.5")],
  paw: [c(5, 10.5, 1.8), c(9, 6, 1.8), c(15, 6, 1.8), c(19, 10.5, 1.8), p("M12 12c-2.8 0-5.5 3.7-5.5 6.2a1.9 1.9 0 0 0 2.8 1.6 5.6 5.6 0 0 1 5.4 0 1.9 1.9 0 0 0 2.8-1.6C17.5 15.7 14.8 12 12 12z")],
  dumbbell: [p("M6.5 6v12"), p("M17.5 6v12"), p("M3.5 9v6"), p("M20.5 9v6"), p("M6.5 12h11")],
  music: [p("M9 18V5.5l11-2v12.5"), c(6, 18, 3), c(17, 16, 3)],
  bank: [p("M3 9.5 12 3.5l9 6"), p("M3 9.5h18"), p("M5.5 10v7.5"), p("M10 10v7.5"), p("M14 10v7.5"), p("M18.5 10v7.5"), p("M3 20.5h18")],
  "piggy-bank": [p("M4 12a7 5.5 0 0 1 13.5-2H20v4h-1.8a7 5.5 0 0 1-2.7 2.7V20h-3v-2h-3v2h-3v-3.6A5.5 5.5 0 0 1 4 12z"), p("M10 7.5h3"), p("M15.5 11h.01")],
  wallet: [p("M19.5 7.5V5a1.5 1.5 0 0 0-1.5-1.5H5A2.5 2.5 0 0 0 5 8.5h15.5v12H5a2.5 2.5 0 0 1-2.5-2.5V6"), p("M16 13h5v4h-5a2 2 0 0 1 0-4z")],
  cash: [rect(2.5, 6, 19, 12, 2), c(12, 12, 2.6), p("M6 12h.01"), p("M18 12h.01")],
  "credit-card": [rect(2.5, 5, 19, 14, 2), p("M2.5 10h19"), p("M6 15h4")],
  loan: [c(15.5, 7.5, 4), p("M15.5 6v3"), p("M2.5 14h3l4 1.5h4a1.5 1.5 0 0 1 0 3h-4.5"), p("M13 18.5l6-2.2a1.6 1.6 0 0 1 1.6 2.7l-7.1 3.5H2.5")],
  mortgage: [p("M3 11.5 12 4l9 7.5"), p("M5.5 10v10h13V10"), p("M14.5 12.5l-5 5"), c(10, 13, 1), c(14, 17, 1)],
  store: [p("M3.5 9 5.5 4h13l2 5z"), p("M4.5 9v11.5h15V9"), p("M9.5 20.5v-6h5v6"), p("M3.5 9a2.8 2.8 0 0 0 5.6 0 2.9 2.9 0 0 0 5.8 0 2.8 2.8 0 0 0 5.6 0")],
  "chart-line": [p("M3.5 3.5v17h17"), p("M7 15l4-4.5 3 3 6-6.5"), p("M16 7h4v4")],
  diamond: [poly("6.5 3.5 17.5 3.5 21.5 9 12 20.5 2.5 9"), p("M2.5 9h19"), p("M9.5 3.5 8 9l4 11.5L16 9l-1.5-5.5")],
  scale: [p("M12 3.5v17"), p("M7 20.5h10"), p("M4 7h16"), p("M6.5 7l-3 7a3 3 0 0 0 6 0z"), p("M17.5 7l-3 7a3 3 0 0 0 6 0z")],
  building: [p("M4.5 21V5l7.5-2.5L19.5 5v16"), p("M2.5 21h19"), p("M8.5 8h2"), p("M13.5 8h2"), p("M8.5 12h2"), p("M13.5 12h2"), p("M10.5 21v-4.5h3V21")],
  user: [c(12, 8, 4), p("M4.5 21a7.5 7.5 0 0 1 15 0")],
  users: [c(9, 8, 3.5), p("M2.5 20.5a6.5 6.5 0 0 1 13 0"), p("M15.5 4.7a3.5 3.5 0 0 1 0 6.6"), p("M17.5 13.8a6.5 6.5 0 0 1 4 6.7")],
  repeat: [p("M17 2.5l3.5 3.5L17 9.5"), p("M3.5 11V9.5A3.5 3.5 0 0 1 7 6h13.5"), p("M7 21.5 3.5 18 7 14.5"), p("M20.5 13v1.5A3.5 3.5 0 0 1 17 18H3.5")],
  calendar: [rect(3, 4.5, 18, 17, 2), p("M3 9.5h18"), p("M8 2.5v4"), p("M16 2.5v4"), p("M7.5 13.5h.01"), p("M12 13.5h.01"), p("M16.5 13.5h.01")],
  "id-card": [rect(2.5, 5, 19, 14, 2), c(8.5, 11, 2.2), p("M5.3 16a3.3 3.3 0 0 1 6.4 0"), p("M14.5 10h4.5"), p("M14.5 14h3.5")],
  target: [c(12, 12, 9), c(12, 12, 5.2), c(12, 12, 1.4)],
  filter: [poly("3 4.5 21 4.5 14 12.8 14 19.5 10 21.5 10 12.8")],
  "chart-pie": [p("M20.5 13A8.5 8.5 0 1 1 11 3.5V13z"), p("M14.5 3.3A8.5 8.5 0 0 1 20.7 9.5h-6.2z")],
  bell: [p("M6 9a6 6 0 0 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15.5 6 9z"), p("M10.2 20.5a2 2 0 0 0 3.6 0")],
  alert: [p("M12 3.5 21.5 20h-19z"), p("M12 10v4.2"), p("M12 17.2h.01")],
  clock: [c(12, 12, 9), p("M12 7v5.2l3.3 2.3")],
  globe: [c(12, 12, 9), p("M3 12h18"), p("M12 3a13.5 13.5 0 0 1 0 18 13.5 13.5 0 0 1 0-18z")],
  suitcase: [rect(6, 6, 12, 13, 2), p("M9.5 6V3.5h5V6"), p("M10 9v7"), p("M14 9v7"), p("M9 19v2"), p("M15 19v2")],
  // The compact record-actions menu trigger (BT-015, Terry, 2026-09-18: "a four-dot icon arranged in
  // two rows and two columns, visually like '::'"): four small filled dots, never text/punctuation.
  more: [["circle", { cx: 8, cy: 8, r: 1.7, fill: "currentColor", stroke: "none" }], ["circle", { cx: 16, cy: 8, r: 1.7, fill: "currentColor", stroke: "none" }], ["circle", { cx: 8, cy: 16, r: 1.7, fill: "currentColor", stroke: "none" }], ["circle", { cx: 16, cy: 16, r: 1.7, fill: "currentColor", stroke: "none" }]],
};

const LABELS = {
  fallback: "Unknown", "money-in": "Money in", "money-out": "Money out", transfer: "Transfer", reversal: "Refund or reversal",
  "no-money-moved": "No money moved",
  external: "Opens in a new tab", home: "Home", bolt: "Energy", cart: "Groceries", utensils: "Dining", car: "Car", heart: "Health", shield: "Protection",
  film: "Entertainment", bag: "Shopping", plane: "Travel", book: "Education", gift: "Gift", receipt: "Receipt", percent: "Interest",
  briefcase: "Work", coins: "Coins", tag: "Tag", wifi: "Internet", phone: "Phone", droplet: "Water", flame: "Heating", coffee: "Coffee",
  fuel: "Fuel", train: "Train", paw: "Pets", dumbbell: "Fitness", music: "Music", bank: "Bank", "piggy-bank": "Savings", wallet: "Wallet",
  cash: "Cash", "credit-card": "Card", loan: "Loan", mortgage: "Mortgage", store: "Store", "chart-line": "Investment", diamond: "Valuable",
  scale: "Balance", building: "Office", user: "Person", users: "Group", repeat: "Recurring", calendar: "Calendar", "id-card": "Membership",
  target: "Goal", filter: "Filter", "chart-pie": "Report", bell: "Bell", alert: "Warning", clock: "Clock", globe: "Globe", suitcase: "Trip",
  more: "More actions",
};

export const FALLBACK = "fallback";
export const BUILT_IN_IDS = Object.freeze(Object.keys(ART));
export const SYSTEM_IDS = Object.freeze(["fallback", "money-in", "money-out", "transfer", "reversal", "no-money-moved", "external", "more"]);

// The same allow-list the server applies to uploads (api/_shared/icon-svg.js).
const SHAPES = Object.freeze({ path: ["d"], circle: ["cx", "cy", "r"], rect: ["x", "y", "width", "height", "rx", "ry"], line: ["x1", "y1", "x2", "y2"], polyline: ["points"], polygon: ["points"] });
// Whitespace limited to space, tab, CR and LF, as on the server (SEC-I5).
const SAFE_VALUE = /^[MmLlHhVvCcSsQqTtAaZz0-9., \t\r\n+\-eE]{1,2000}$/;

let catalog = { disabled: new Set(), custom: new Map(), defaults: null, typeIcons: {} };

// Installs the catalogue from GET /api/icons, with the workspace's type icons. Custom icons whose
// data is not plain shape data are ignored (they draw the fallback), whatever the server sent.
export function setCatalog(view, typeIcons = {}) {
  const disabled = new Set(((view && view.builtIn) || []).filter((i) => !i.enabled).map((i) => i.id));
  const custom = new Map();
  for (const icon of (view && view.custom) || []) {
    const shapes = safeShapes(icon.shapes);
    if (shapes && typeof icon.id === "string" && /^ico_[A-Za-z0-9_-]{6,64}$/.test(icon.id)) custom.set(icon.id, { label: String(icon.label || "Custom icon"), status: icon.status, shapes });
  }
  catalog = { disabled, custom, defaults: (view && view.defaults) || null, typeIcons: { ...(typeIcons || {}) } };
}

// Resets the workspace's type icons synchronously on a workspace switch, keeping the site
// catalogue, so another workspace's choices never linger (security review SEC-I3).
export function setTypeIcons(typeIcons = {}) {
  catalog = { ...catalog, typeIcons: { ...(typeIcons || {}) } };
}

// The icon a record of this kind and type gets when none is chosen on it: the workspace's icon for
// the type, else the built-in default (the server applies the same rule in api/_shared/icons.js).
export function defaultIconFor(kind, type) {
  const chosen = catalog.typeIcons[`${kind}.${type}`];
  return chosen || builtInIconFor(kind, type);
}

// The built-in default alone, ignoring the workspace's type icons (what "Default" means there).
export function builtInIconFor(kind, type) {
  const d = catalog.defaults && catalog.defaults[kind];
  if (typeof d === "string") return d;
  return (d && d[type]) || FALLBACK;
}

function safeShapes(shapes) {
  if (!Array.isArray(shapes) || !shapes.length || shapes.length > 32) return null;
  const out = [];
  for (const s of shapes) {
    if (!s || !Object.prototype.hasOwnProperty.call(SHAPES, s.type) || !s.attrs || typeof s.attrs !== "object") return null;
    const attrs = {};
    for (const [k, v] of Object.entries(s.attrs)) {
      if (!SHAPES[s.type].includes(k) || typeof v !== "string" || !SAFE_VALUE.test(v)) return null;
      attrs[k] = v;
    }
    out.push([s.type, attrs]);
  }
  return out;
}

export const isKnown = (id) => Object.prototype.hasOwnProperty.call(ART, id) || catalog.custom.has(id);
export const resolve = (id) => (isKnown(id) ? id : FALLBACK);

export function iconLabel(id) {
  if (Object.prototype.hasOwnProperty.call(LABELS, id)) return LABELS[id];
  const custom = catalog.custom.get(id);
  return custom ? custom.label : LABELS.fallback;
}

// An icon element. Decorative by default (aria-hidden); give `label` only when the icon is the
// only thing naming something, and it becomes role="img" with that name.
export function icon(id, { label = null, className = "" } = {}) {
  const shown = resolve(id);
  const shapes = ART[shown] || catalog.custom.get(shown).shapes;
  const svg = svgEl("svg", {
    class: ["icon", className].filter(Boolean).join(" "), viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", focusable: "false",
    "aria-hidden": label ? null : "true", role: label ? "img" : null, "aria-label": label || null, "data-icon": shown,
  });
  for (const [tag, attrs] of shapes) svg.appendChild(svgEl(tag, attrs));
  return svg;
}

// Text with its icon to the left. The text always names the thing; the icon never stands alone.
export function withIcon(id, content, { className = "" } = {}) {
  return el("span", { class: ["iconlabel", className].filter(Boolean).join(" ") }, [icon(id), typeof content === "string" ? el("span", { text: content }) : content]);
}

// Money direction (BT-011-05): an arrow says only whether money comes in (upward) or goes out
// (downward) — never both ways (Terry, 2026-09-13). A transfer leg is in or out by its own sign;
// refunds and reversals keep a return arrow. Decided from the entry itself. An amount owed to others
// for a shared expense (`payable`), or its reversal, moved no money, so it gets the no-money-moved
// mark (two lines, no heads) instead of an arrow, beside the words "No money moved" (BT-009 recheck N3).
export function directionOf(t) {
  // No money moved: an amount owed, or a share someone else paid (BT-009 recheck N3 and L4).
  if (t.kind === "payable" || t.paidBySomeoneElse) return "no-money-moved";
  if ((t.links && t.links.reverses) || t.kind === "refund") return "reversal";
  const minor = t.amountMinor !== undefined ? t.amountMinor : Number(String(t.amount || "0").replace(/[^0-9.-]/g, ""));
  return minor >= 0 ? "money-in" : "money-out";
}

// Picker entries for the theme-picker pattern: every icon that may be chosen now, plus the current
// one if it has since been switched off or retired (shown truthfully, never silently replaced).
// `inherited` adds a first entry that returns the record to its default.
export function iconEntries({ current = null, inherited = null } = {}) {
  const entries = [];
  if (inherited) entries.push({ id: "", label: `Default (${iconLabel(inherited)})`, icon: inherited });
  for (const id of BUILT_IN_IDS) {
    if (SYSTEM_IDS.includes(id) || catalog.disabled.has(id)) continue;
    entries.push({ id, label: LABELS[id], icon: id });
  }
  for (const [id, custom] of catalog.custom) if (custom.status === "active") entries.push({ id, label: custom.label, icon: id });
  if (current && !entries.some((e) => e.id === current)) entries.push({ id: current, label: `${iconLabel(current)} (no longer offered)`, icon: current });
  return entries;
}
