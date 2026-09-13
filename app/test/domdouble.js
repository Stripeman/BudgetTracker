// A deliberately small DOM double for Node tests of UI components (no layout, no CSS cascade).
//
// Not a port of TaskTracker's 1,500-line harness: BudgetTracker's components need elements,
// attributes versus properties, classList, dataset, CSSOM custom properties, bubbling events,
// focus and simple selectors. Anything that depends on layout, geometry, the cascade or motion
// must be verified in a real browser, and tests must not claim otherwise.

class ClassList {
  constructor(node) { this.node = node; }
  get values() { return (this.node.getAttribute("class") || "").split(/\s+/).filter(Boolean); }
  contains(name) { return this.values.includes(name); }
  add(...names) { this.node.setAttribute("class", [...new Set([...this.values, ...names])].join(" ")); }
  remove(...names) { this.node.setAttribute("class", this.values.filter((v) => !names.includes(v)).join(" ")); }
  toggle(name, force) {
    const on = force === undefined ? !this.contains(name) : !!force;
    if (on) this.add(name); else this.remove(name);
    return on;
  }
}

export class DomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = !!init.bubbles;
    this.key = init.key;
    this.defaultPrevented = false;
    this.propagationStopped = false;
    this.target = null;
    this.currentTarget = null;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
}

class Node {
  constructor(doc, tag, ns) {
    this.ownerDocument = doc;
    this.tagName = tag.toUpperCase();
    this.localName = tag.toLowerCase();
    this.namespaceURI = ns || "http://www.w3.org/1999/xhtml";
    this.attributes = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.classList = new ClassList(this);
    this.dataset = {};
    const props = new Map();
    this.style = { setProperty: (k, v) => props.set(k, String(v)), getPropertyValue: (k) => props.get(k) || "" };
    this.checked = false;
    this.disabled = false;
    this.value = "";
    this._text = null;
  }
  get className() { return this.getAttribute("class") || ""; }
  set className(v) { this.setAttribute("class", v); }
  get id() { return this.getAttribute("id") || ""; }
  set id(v) { this.setAttribute("id", v); }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "disabled") this.disabled = true;
    if (name === "checked") this.checked = true;
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); if (name === "disabled") this.disabled = false; }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  removeChild(child) {
    this.childNodes = this.childNodes.filter((c) => c !== child);
    child.parentNode = null;
    return child;
  }
  get firstChild() { return this.childNodes[0] || null; }
  get children() { return this.childNodes.filter((c) => c instanceof Node); }
  get textContent() {
    if (this._text !== null) return this._text;
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(v) { this.childNodes = []; this._text = null; if (v !== "") this.appendChild(this.ownerDocument.createTextNode(String(v))); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter((f) => f !== fn)); }
  dispatchEvent(event) {
    event.target = event.target || this;
    let node = this;
    while (node) {
      event.currentTarget = node;
      for (const fn of node.listeners.get(event.type) || []) fn.call(node, event);
      if (!event.bubbles || event.propagationStopped) break;
      node = node.parentNode;
    }
    return !event.defaultPrevented;
  }
  focus() { this.ownerDocument.activeElement = this; }
  click() {
    if (this.disabled) return;
    if (this.localName === "input" && this.getAttribute("type") === "checkbox") {
      this.checked = !this.checked;
      this.dispatchEvent(new DomEvent("click", { bubbles: true }));
      this.dispatchEvent(new DomEvent("change", { bubbles: true }));
      return;
    }
    this.dispatchEvent(new DomEvent("click", { bubbles: true }));
  }
  matches(selector) { return matchesSimple(this, selector); }
  querySelectorAll(selector) {
    const out = [];
    const walk = (n) => { for (const c of n.children) { if (selector.split(",").some((s) => matchesSimple(c, s.trim()))) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getElementById(id) { return this.querySelector(`#${id}`); }
}

class TextNode {
  constructor(text) { this.text = text; this.parentNode = null; }
  get textContent() { return this.text; }
}

// Supports tag, .class, #id, [attr], [attr="value"] and compound forms such as button.btn[type="button"].
function matchesSimple(node, selector) {
  const re = /([a-zA-Z][\w-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g;
  let m;
  let matchedAny = false;
  while ((m = re.exec(selector))) {
    matchedAny = true;
    if (m[1] && node.localName !== m[1].toLowerCase()) return false;
    if (m[2] && !node.classList.contains(m[2])) return false;
    if (m[3] && node.id !== m[3]) return false;
    if (m[4]) {
      if (!node.hasAttribute(m[4])) return false;
      if (m[5] !== undefined && node.getAttribute(m[4]) !== m[5]) return false;
    }
  }
  return matchedAny;
}

export function installDom() {
  const doc = {
    activeElement: null,
    createElement: (tag) => new Node(doc, tag),
    createElementNS: (ns, tag) => new Node(doc, tag, ns),
    createTextNode: (text) => new TextNode(text),
  };
  doc.documentElement = new Node(doc, "html");
  doc.body = new Node(doc, "body");
  doc.documentElement.appendChild(doc.body);
  doc.getElementById = (id) => doc.documentElement.querySelector(`#${id}`);
  doc.querySelector = (s) => doc.documentElement.querySelector(s);
  doc.querySelectorAll = (s) => doc.documentElement.querySelectorAll(s);
  const previous = { document: globalThis.document, raf: globalThis.requestAnimationFrame };
  globalThis.document = doc;
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  return {
    document: doc,
    body: doc.body,
    teardown() { globalThis.document = previous.document; globalThis.requestAnimationFrame = previous.raf; },
  };
}
