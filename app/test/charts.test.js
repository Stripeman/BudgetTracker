// BT-014-14: the Dashboard's donut chart is decorative only (aria-hidden), every segment's colour
// comes through as a plain SVG attribute (never a style attribute the CSP would block), and the
// same figures are always available as real text (a visible legend and a sr-only table), the same
// rule analytics.js's bar/line charts already follow.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domdouble.js";
import { donutChart, moneyFigureTable, chartLegend } from "../js/ui/charts.js";

let dom;
beforeEach(() => { dom = installDom(); });
afterEach(() => dom.teardown());

describe("BT-014-14 donutChart", () => {
  test("is decorative (aria-hidden) and draws one segment per non-zero value, plus the empty track", () => {
    const svg = donutChart([{ label: "Groceries", value: 30, color: "#ff0000" }, { label: "Dining", value: 0, color: "#00ff00" }, { label: "Transport", value: 10, color: "#0000ff" }]);
    dom.body.appendChild(svg);
    assert.equal(svg.getAttribute("aria-hidden"), "true");
    assert.equal(svg.getAttribute("focusable"), "false");
    assert.equal(svg.querySelectorAll(".chart__donut-track").length, 1, "the background track always draws, even with data");
    const segs = svg.querySelectorAll(".chart__donut-seg");
    assert.equal(segs.length, 2, "a zero-value segment draws nothing");
    assert.equal(segs[0].getAttribute("stroke"), "#ff0000");
    assert.equal(segs[1].getAttribute("stroke"), "#0000ff");
  });

  test("segment arc lengths are proportional to value (30 vs 10 out of 40 total)", () => {
    const svg = donutChart([{ label: "A", value: 30, color: "#111" }, { label: "B", value: 10, color: "#222" }], { size: 100, thickness: 20 });
    const segs = svg.querySelectorAll(".chart__donut-seg");
    const lenOf = (el) => parseFloat(el.getAttribute("stroke-dasharray").split(" ")[0]);
    const a = lenOf(segs[0]);
    const b = lenOf(segs[1]);
    assert.ok(Math.abs(a / b - 3) < 0.01, `expected a 3:1 ratio, got ${a}:${b}`);
  });

  test("with nothing to show (all zero, or no segments), only the empty track draws, without throwing", () => {
    assert.doesNotThrow(() => donutChart([]));
    const svg = donutChart([{ label: "A", value: 0, color: "#111" }]);
    assert.equal(svg.querySelectorAll(".chart__donut-seg").length, 0);
    assert.equal(svg.querySelectorAll(".chart__donut-track").length, 1);
  });
});

describe("BT-014-14 moneyFigureTable and chartLegend", () => {
  test("moneyFigureTable is visually hidden and carries the same rows as real text", () => {
    const table = moneyFigureTable([{ label: "Groceries", amountText: "USD 30.00" }, { label: "Dining", amountText: "USD 15.00" }], "Spending by category this month, USD");
    dom.body.appendChild(table);
    assert.equal(table.className, "sr-only");
    assert.equal(table.querySelector("caption").textContent, "Spending by category this month, USD");
    const rows = table.querySelector("tbody").querySelectorAll("tr");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].querySelector("th").textContent, "Groceries");
    assert.equal(rows[0].querySelector("td").textContent, "USD 30.00");
  });

  test("chartLegend never relies on colour alone: every entry names itself and its amount in real text", () => {
    const legend = chartLegend([{ label: "Groceries", amountText: "USD 30.00", color: "#ff0000" }]);
    dom.body.appendChild(legend);
    const li = legend.querySelector("li");
    assert.match(li.textContent, /Groceries/);
    assert.match(li.textContent, /USD 30\.00/);
    const dot = li.querySelector(".swatch-dot");
    assert.equal(dot.getAttribute("aria-hidden"), "true", "the colour swatch is decoration; the text beside it is what actually says which category this is");
  });
});
