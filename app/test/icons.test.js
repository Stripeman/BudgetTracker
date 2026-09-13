// BT-011-05 the icon registry: one list of stable ids shared with the server, TaskTracker's icon
// conventions, a fallback instead of a throw, custom icons drawn only from safe shape data, money
// direction, picker entries and the icon picker built on the theme-picker pattern.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { installDom } from "./domdouble.js";
import { icon, setCatalog, BUILT_IN_IDS, SYSTEM_IDS, directionOf, iconEntries, iconLabel, defaultIconFor, builtInIconFor, withIcon } from "../js/ui/icons.js";
import { createIconPicker, iconChange } from "../js/ui/iconpicker.js";
import { categoryLabel } from "../js/ui/components.js";

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

  test("money direction: in is up, out is down, transfers go both ways, refunds and reversals return", () => {
    assert.equal(directionOf({ kind: "income", amountMinor: 500 }), "money-in");
    assert.equal(directionOf({ kind: "expense", amountMinor: -500 }), "money-out");
    assert.equal(directionOf({ kind: "adjustment", amount: "-3.00" }), "money-out");
    assert.equal(directionOf({ kind: "transfer", amountMinor: -500 }), "transfer");
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
    const options = p.element.querySelectorAll('[role="option"]');
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
