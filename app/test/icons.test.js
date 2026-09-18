// BT-011-05 the icon registry: one list of stable ids shared with the server, TaskTracker's icon
// conventions, a fallback instead of a throw, custom icons drawn only from safe shape data, money
// direction, picker entries and the icon picker built on the theme-picker pattern.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { installDom } from "./domdouble.js";
import { icon, setCatalog, setTypeIcons, BUILT_IN_IDS, SYSTEM_IDS, directionOf, iconEntries, iconLabel, defaultIconFor, builtInIconFor, withIcon } from "../js/ui/icons.js";
import { createIconPicker, iconChange } from "../js/ui/iconpicker.js";
import { categoryLabel, amountWithDirection, transferLabel } from "../js/ui/components.js";
import { escapeBelongsToControl } from "../js/ui/modal.js";
import { DomEvent } from "./domdouble.js";

const require = createRequire(import.meta.url);
const server = require("../../api/_shared/icons.js");

let dom;
beforeEach(() => { dom = installDom(); setCatalog(server.catalogView({ disabled: [], custom: [] })); });
afterEach(() => { setCatalog(null); dom.teardown(); });

const tags = (node) => node.children.map((c) => c.localName);

describe("BT-011-05 icon registry", () => {
  test("the client registry and the server catalogue list exactly the same ids and labels", () => {
    assert.deepEqual([...BUILT_IN_IDS].sort(), server.BUILT_IN.map((i) => i.id).sort());
    for (const i of server.BUILT_IN) assert.equal(iconLabel(i.id), i.label, i.id);
    assert.deepEqual([...SYSTEM_IDS].sort(), [...server.SYSTEM].sort());
    for (const map of [server.DEFAULTS.account, server.DEFAULTS.merchant, server.DEFAULTS.bill, server.DEFAULTS.category, server.CATEGORY_BY_NAME]) {
      for (const id of Object.values(map)) assert.ok(BUILT_IN_IDS.includes(id), `default ${id} has artwork`);
    }
  });

  test("an icon follows TaskTracker's conventions: 24 × 24, currentColor stroke, decorative by default", () => {
    const svg = icon("cart");
    assert.equal(svg.namespaceURI, "http://www.w3.org/2000/svg");
    assert.equal(svg.getAttribute("viewBox"), "0 0 24 24");
    assert.equal(svg.getAttribute("stroke"), "currentColor");
    assert.equal(svg.getAttribute("fill"), "none");
    assert.equal(svg.getAttribute("aria-hidden"), "true");
    assert.equal(svg.getAttribute("focusable"), "false");
    assert.equal(svg.hasAttribute("style"), false);
    assert.ok(svg.children.length > 0);
    const named = icon("cart", { label: "Groceries" });
    assert.deepEqual([named.getAttribute("role"), named.getAttribute("aria-label"), named.hasAttribute("aria-hidden")], ["img", "Groceries", false]);
  });

  test("an unknown or removed id draws the fallback icon instead of failing", () => {
    assert.equal(icon("no-such-icon").getAttribute("data-icon"), "fallback");
    assert.equal(icon("ico_gone123456").getAttribute("data-icon"), "fallback");
    assert.equal(icon(null).getAttribute("data-icon"), "fallback");
    assert.equal(iconLabel("no-such-icon"), "Unknown");
  });

  test("custom icons are drawn only from allowed shapes and values; anything else is ignored", () => {
    setCatalog({
      builtIn: [], defaults: server.DEFAULTS,
      custom: [
        { id: "ico_boat000001", label: "Boat", status: "active", shapes: [{ type: "path", attrs: { d: "M4 12h16" } }, { type: "circle", attrs: { cx: "12", cy: "12", r: "3" } }] },
        { id: "ico_evil000001", label: "Evil", status: "active", shapes: [{ type: "script", attrs: {} }] },
        { id: "ico_evil000002", label: "Evil 2", status: "active", shapes: [{ type: "path", attrs: { d: "M0 0", onclick: "alert(1)" } }] },
        { id: "ico_evil000003", label: "Evil 3", status: "active", shapes: [{ type: "path", attrs: { d: "javascript:alert(1)" } }] },
        { id: "not-a-custom-id", label: "Bad id", status: "active", shapes: [{ type: "path", attrs: { d: "M0 0" } }] },
      ],
    });
    const boat = icon("ico_boat000001");
    assert.deepEqual([boat.getAttribute("data-icon"), tags(boat)], ["ico_boat000001", ["path", "circle"]]);
    assert.equal(boat.children[0].getAttribute("d"), "M4 12h16");
    for (const id of ["ico_evil000001", "ico_evil000002", "ico_evil000003", "not-a-custom-id"]) assert.equal(icon(id).getAttribute("data-icon"), "fallback", id);
  });

  test("money direction: in is up, out is down — never both ways; refunds and reversals return", () => {
    assert.equal(directionOf({ kind: "income", amountMinor: 500 }), "money-in");
    assert.equal(directionOf({ kind: "expense", amountMinor: -500 }), "money-out");
    assert.equal(directionOf({ kind: "adjustment", amount: "-3.00" }), "money-out");
    // Terry, 2026-09-13: a transfer leg shows only whether money leaves or arrives in this account.
    assert.equal(directionOf({ kind: "transfer", amountMinor: -500 }), "money-out");
    assert.equal(directionOf({ kind: "transfer", amountMinor: 500 }), "money-in");
    assert.equal(directionOf({ kind: "refund", amountMinor: 500 }), "reversal");
    assert.equal(directionOf({ kind: "expense", amountMinor: 500, links: { reverses: "txn_1" } }), "reversal");
    assert.deepEqual(tags(icon("money-in")).length > 0 && icon("money-in").getAttribute("data-icon"), "money-in");
  });

  test("defaults: the workspace's type icon first, then the built-in default", () => {
    setCatalog(server.catalogView({ disabled: [], custom: [] }), { "account.checking": "cash" });
    assert.equal(defaultIconFor("account", "checking"), "cash");
    assert.equal(builtInIconFor("account", "checking"), "bank");
    assert.equal(defaultIconFor("bill", "utilities"), "bolt");
    assert.equal(defaultIconFor("budget"), "target");
    assert.equal(defaultIconFor("account", "spaceship"), "fallback");
  });

  test("SEC-I3 a workspace switch clears the previous workspace's type icons at once, keeping the catalogue", () => {
    setCatalog({ ...server.catalogView({ disabled: ["film"], custom: [] }) }, { "account.checking": "cash" });
    setTypeIcons({});
    assert.equal(defaultIconFor("account", "checking"), "bank");
    assert.ok(!iconEntries().some((e) => e.id === "film"), "the site catalogue is kept");
  });
});

describe("BT-011-05 icon pickers", () => {
  test("pickers offer icons that may be chosen now; switched-off and retired icons only as the current value", () => {
    setCatalog({
      ...server.catalogView({ disabled: ["film"], custom: [] }),
      custom: [
        { id: "ico_boat000001", label: "Boat", status: "active", shapes: [{ type: "path", attrs: { d: "M4 12h16" } }] },
        { id: "ico_old0000001", label: "Old", status: "retired", shapes: [{ type: "path", attrs: { d: "M4 12h16" } }] },
      ],
    });
    const ids = iconEntries().map((e) => e.id);
    assert.ok(!ids.includes("film"), "switched off");
    assert.ok(!ids.includes("ico_old0000001"), "retired");
    assert.ok(ids.includes("ico_boat000001"));
    for (const id of SYSTEM_IDS) assert.ok(!ids.includes(id), `${id} is chosen by the app, not by people`);
    const withCurrent = iconEntries({ current: "film", inherited: "cart" });
    assert.deepEqual(withCurrent[0], { id: "", label: "Default (Groceries)", icon: "cart" });
    assert.equal(withCurrent.at(-1).label, "Entertainment (no longer offered)");
  });

  test("the icon picker is the theme-picker listbox with icons; picking the default resets", () => {
    const picked = [];
    const p = createIconPicker({ value: "bag", inherited: "cart", name: "Groceries", onPick: (id) => picked.push(id) });
    const toggle = p.element.querySelector(".themepick__toggle");
    assert.equal(toggle.getAttribute("aria-haspopup"), "listbox");
    assert.match(toggle.getAttribute("aria-labelledby"), /^iconpick-\d+ /);
    assert.equal(toggle.querySelector("svg").getAttribute("data-icon"), "bag");
    assert.equal(toggle.querySelector("svg").getAttribute("aria-hidden"), "true");
    // 2026-09-18: the list is a floating overlay (app/js/ui/overlay.js) — in the document only
    // while open, and appended to the body/dialog, never under the picker's own `element`.
    toggle.click();
    const options = document.querySelectorAll('[role="option"]');
    assert.ok(options.every((o) => o.querySelector("svg")), "every option shows its icon");
    assert.equal(p.getValue(), "bag");
    options.find((o) => o.dataset.theme === "").click();
    assert.deepEqual(picked, [""]);
    assert.equal(p.getValue(), null);
    assert.equal(toggle.querySelector("svg").getAttribute("data-icon"), "cart", "the toggle redraws the icon");
    assert.equal(iconChange("bag", null), null);
    assert.equal(iconChange(null, null), undefined);
    assert.equal(iconChange(null, "cart"), "cart");
  });

  test("UXI-1 Escape in an open picker list, or on its toggle, belongs to the list, not the dialog", () => {
    const p = createIconPicker({ value: null, inherited: "cart", name: "Groceries" });
    document.body.appendChild(p.element);
    const toggle = p.element.querySelector(".themepick__toggle");
    assert.equal(escapeBelongsToControl(toggle), false, "a closed picker leaves Escape to the dialog");
    toggle.click();
    // The open list is a floating overlay (2026-09-18): looked up from the document, not the
    // picker's own `element`, which no longer contains it while open.
    const option = document.querySelectorAll('[role="option"]')[1];
    assert.equal(escapeBelongsToControl(option), true);
    assert.equal(escapeBelongsToControl(toggle), true);
    const esc = Object.assign(new DomEvent("keydown", { bubbles: true, key: "Escape" }), { key: "Escape" });
    toggle.dispatchEvent(esc);
    assert.equal(p.picker.isOpen(), false, "Escape on the toggle closes the list");
    const combo = document.createElement("input");
    combo.setAttribute("role", "combobox");
    combo.setAttribute("aria-expanded", "true");
    assert.equal(escapeBelongsToControl(combo), true);
    assert.equal(escapeBelongsToControl(document.createElement("input")), false);
  });

  test("UXI-2 long picker lists: type-ahead to the next matching name, and PageDown/PageUp", () => {
    const p = createIconPicker({ value: null, inherited: "cart", name: "Groceries" });
    const toggle = p.element.querySelector(".themepick__toggle");
    toggle.click();
    // Floating overlay (2026-09-18): the open list and its options live on the document body (or
    // the nearest dialog), not under the picker's own `element`.
    const list = document.querySelector('[role="listbox"]');
    const options = document.querySelectorAll('[role="option"]');
    const key = (k) => list.dispatchEvent(Object.assign(new DomEvent("keydown", { bubbles: true, key: k }), { key: k }));
    assert.equal(document.activeElement, options[0], "opens on the current (default) entry");
    key("h");
    assert.equal(document.activeElement.textContent, "Home");
    key("h");
    assert.equal(document.activeElement.textContent, "Health", "the same letter moves to the next match");
    key("PageDown");
    assert.equal(options.indexOf(document.activeElement), options.findIndex((o) => o.textContent === "Health") + 5);
    key("PageUp");
    assert.equal(document.activeElement.textContent, "Health");
  });

  test("UXI-3 an icon picker for a category previews its icons in the category colour", () => {
    const p = createIconPicker({ value: null, inherited: "cart", name: "Groceries", tint: "#16a34a" });
    const toggle = p.element.querySelector(".themepick__toggle");
    toggle.click();
    // The list's own option icons are what this checks — they live on the document body while
    // open (2026-09-18 overlay fix), not under the picker's own `element`. A simple class selector,
    // not a descendant combinator: this DOM double only matches single compound selectors. The
    // toggle's own glyph is included too (it carries the same tint), which only strengthens the
    // "every one" assertion below.
    const glyphs = document.querySelectorAll('.themepick__icon');
    assert.ok(glyphs.length > 1);
    assert.ok(glyphs.every((g) => g.style.getPropertyValue("--swatch") === "#16a34a" && !g.hasAttribute("style")));
  });

  test("UXI-4 a refund or reversal is named in text beside its amount; in and out rely on the sign", () => {
    const refund = amountWithDirection({ kind: "refund", amountMinor: 3760, amount: "37.60", currency: "EUR" }, { effective: {} });
    assert.equal(refund.querySelector(".sr-only").textContent, "Refund or reversal: ");
    assert.equal(refund.querySelector("svg").getAttribute("aria-hidden"), "true");
    const out = amountWithDirection({ kind: "expense", amountMinor: -500, amount: "-5.00", currency: "EUR" }, { effective: {} });
    assert.equal(out.querySelector(".sr-only"), null);
    assert.equal(out.querySelector("svg").getAttribute("data-icon"), "money-out");
  });

  test("a transfer leg names the other account with its icon, and says to or from — no two-way arrow", () => {
    const accounts = new Map([["acc_card", { id: "acc_card", name: "Household Card", icon: "credit-card" }]]);
    const out = transferLabel({ kind: "transfer", amountMinor: -25000, counterpartAccountId: "acc_card" }, accounts);
    assert.equal(out.textContent, "Transfer to Household Card");
    assert.equal(out.querySelector("svg").getAttribute("data-icon"), "credit-card");
    const inbound = transferLabel({ kind: "transfer", amountMinor: 25000, counterpartAccountId: "acc_hidden" }, accounts);
    assert.equal(inbound.textContent, "Transfer from another account");
    assert.equal(inbound.querySelector("svg").getAttribute("data-icon"), "bank");
    assert.ok(![out, inbound].some((n) => n.querySelector('[data-icon="transfer"]')));
  });

  test("a category label with an icon carries the colour on the icon through the CSSOM, beside the name", () => {
    const label = categoryLabel("Groceries", "#16a34a", "cart");
    const holder = label.querySelector(".catlabel__icon");
    assert.equal(label.textContent, "Groceries");
    assert.equal(holder.getAttribute("aria-hidden"), "true");
    assert.equal(holder.style.getPropertyValue("--swatch"), "#16a34a");
    assert.equal(holder.hasAttribute("style"), false);
    assert.equal(holder.querySelector("svg").getAttribute("data-icon"), "cart");
    assert.equal(withIcon("bank", "Joint").textContent, "Joint");
  });
});
