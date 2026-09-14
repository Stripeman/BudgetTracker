// Minimal DOM helpers, ported from TaskTracker app/js/ui/dom.js (T: main a1ec150).
//
// No framework, no build step. Text always goes through textContent — there is no innerHTML
// helper, deliberately: payee names, notes and member names arrive from other people, and
// routing them through textContent makes cross-site scripting structurally impossible.
//
// The CSP forbids inline style attributes, so `el()` refuses `style` and accepts only CSS custom
// properties through `vars` (set via the CSSOM, which CSP does not block).

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "style") {
      throw new Error('el() does not accept a `style` attribute — the CSP blocks inline styles. Pass `vars: { "--name": value }`.');
    } else if (key === "vars") {
      for (const [name, cssValue] of Object.entries(value || {})) {
        if (cssValue !== null && cssValue !== undefined) node.style.setProperty(name, String(cssValue));
      }
    } else if (key === "class") {
      node.className = Array.isArray(value) ? value.filter(Boolean).join(" ") : String(value);
    } else if (key === "dataset") {
      for (const [dataKey, dataValue] of Object.entries(value)) {
        if (dataValue !== null && dataValue !== undefined) node.dataset[dataKey] = String(dataValue);
      }
    } else if (key === "text") {
      node.textContent = String(value);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  }
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// createElementNS, not createElement: an <svg> built in the HTML namespace renders nothing.
export function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(key, String(value));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// Replaces a node's children, skipping the teardown when the same nodes are already mounted in
// the same order (so a focused control inside is not blurred for nothing).
export function mount(node, ...children) {
  const wanted = children.filter(Boolean);
  const current = Array.from(node.childNodes);
  if (current.length === wanted.length && current.every((c, i) => c === wanted[i])) return node;
  clear(node);
  for (const child of wanted) node.appendChild(child);
  return node;
}

// Announces a change to assistive technology without stealing focus.
export function announce(message) {
  let region = document.getElementById("a11y-live");
  if (!region) {
    region = el("div", { id: "a11y-live", class: "sr-only", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    document.body.appendChild(region);
  }
  region.textContent = "";
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 0);
  raf(() => { region.textContent = String(message || ""); });
}

// Moves keyboard focus to a newly rendered region without scrolling the page.
export function focusFirst(container) {
  if (!container) return;
  const target = container.querySelector("[autofocus], h1, h2, [tabindex='-1']") || container;
  if (typeof target.focus === "function") {
    if (!target.hasAttribute("tabindex") && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }
}
