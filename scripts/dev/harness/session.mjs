// One signed-in FICTIONAL user in their own headless Edge, with a small page API (BT-004-06).
//
// Real input only where it matters: clicks are Input.dispatchMouseEvent at the element's centre,
// keys are Input.dispatchKeyEvent (Enter carries its "\r" character, as a real keyboard does), text
// is Input.insertText into the focused field. Elements are found the way a person finds them — by
// role and accessible name, by visible text or by their field label — and a search that matches
// nothing or more than one element fails with what WAS offered, never with a guess.
import fs from "node:fs";
import path from "node:path";
import { connect } from "./cdp.mjs";
import { launchEdge, stopEdge } from "./edge.mjs";
import { ROOT, freePort, assertUnderLocal } from "./guards.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEYS = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  Home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
  End: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
  Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
};

function keyDef(name) {
  if (KEYS[name]) return KEYS[name];
  if (typeof name === "string" && name.length === 1) {
    const up = name.toUpperCase();
    const letter = /[a-z]/i.test(name);
    const digit = /[0-9]/.test(name);
    return { key: name, code: letter ? `Key${up}` : digit ? `Digit${name}` : "", windowsVirtualKeyCode: letter || digit ? up.charCodeAt(0) : 0, text: name };
  }
  throw new Error(`Unknown key ${name}.`);
}

// RUNS IN THE PAGE (serialized with toString, so it must be self-contained): finds exactly one
// visible element and reports where it is.
function pageLocate(spec) {
  const norm = (s) => String(s === null || s === undefined ? "" : s).replace(/\s+/g, " ").trim();
  const visible = (e) => {
    if (!e || !e.isConnected || e.closest("[hidden]") || e.closest("[inert]")) return false;
    const cs = getComputedStyle(e);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const labelOf = (e) => {
    if (!e.id) return "";
    const l = document.querySelector(`label[for="${CSS.escape(e.id)}"]`);
    return l ? norm(l.textContent) : "";
  };
  const nameOf = (e) => {
    const aria = e.getAttribute("aria-label");
    if (aria) return norm(aria);
    const by = e.getAttribute("aria-labelledby");
    if (by) return norm(by.split(/\s+/).map((id) => { const x = document.getElementById(id); return x ? x.textContent : ""; }).join(" "));
    const labelled = labelOf(e);
    if (labelled) return labelled;
    if (e.matches("input, select, textarea")) { const wrap = e.closest("label"); if (wrap) return norm(wrap.textContent); }
    if (e.matches("input[type=submit], input[type=button]")) return norm(e.value);
    if (e.matches("input, textarea")) return norm(e.getAttribute("placeholder") || e.getAttribute("title"));
    return norm(e.textContent || e.getAttribute("title"));
  };
  const ROLE = {
    button: "button, [role=button], input[type=button], input[type=submit]",
    link: "a[href], [role=link]",
    checkbox: "input[type=checkbox], [role=checkbox]",
    textbox: "input:not([type]), input[type=text], input[type=search], input[type=email], input[type=number], textarea, [role=textbox]",
    heading: "h1, h2, h3, h4, h5, h6, [role=heading]",
    dialog: "[role=dialog], dialog",
  };
  const roots = spec.scope ? Array.from(document.querySelectorAll(spec.scope)).filter(visible) : [document];
  if (spec.scope && !roots.length) return { error: `nothing visible matches the scope ${spec.scope}`, offered: [] };
  const selector = spec.css || (spec.role ? ROLE[spec.role] || `[role="${spec.role}"]` : "*");
  let found = [];
  for (const root of roots) found.push(...root.querySelectorAll(selector));
  found = Array.from(new Set(found)).filter(visible);
  let hits;
  if (spec.text !== undefined) {
    const wanted = norm(spec.text);
    hits = found.filter((e) => norm(e.textContent) === wanted);
    hits = hits.filter((e) => !hits.some((o) => o !== e && e.contains(o)));
  } else if (spec.label !== undefined) {
    hits = found.filter((e) => labelOf(e) === norm(spec.label));
  } else if (spec.nameRe !== undefined) {
    const re = new RegExp(spec.nameRe, spec.nameFlags || "");
    hits = found.filter((e) => re.test(nameOf(e)));
  } else if (spec.name !== undefined) {
    hits = found.filter((e) => nameOf(e) === norm(spec.name));
  } else hits = found;
  const describe = (list) => list.slice(0, 25).map((e) => (spec.label !== undefined ? labelOf(e) : nameOf(e)) || e.tagName.toLowerCase());
  if (!hits.length) return { error: "not found", offered: describe(found) };
  if (hits.length > 1 && spec.index === undefined) return { error: `ambiguous (${hits.length} match)`, offered: describe(hits) };
  const target = hits[spec.index || 0];
  if (!target) return { error: `no match at index ${spec.index}`, offered: describe(hits) };
  if (spec.focus) target.focus();
  target.scrollIntoView({ block: "center", inline: "center" });
  const r = target.getBoundingClientRect();
  return {
    x: r.left + r.width / 2, y: r.top + r.height / 2, name: nameOf(target), tag: target.tagName.toLowerCase(),
    disabled: !!target.disabled || target.getAttribute("aria-disabled") === "true",
    value: "value" in target ? String(target.value) : null,
  };
}

const describeSpec = (spec) => JSON.stringify(spec, (k, v) => (v instanceof RegExp ? String(v) : v));
const pathOf = (url) => { try { const u = new URL(url); return `${u.pathname}${u.search}`; } catch { return String(url); } };

export async function openSession({ base, user, name = user, runDir, prefix = "", width = 1280, height = 900 }) {
  const profile = assertUnderLocal(path.join(runDir, "profiles", `${name}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`));
  const port = await freePort();
  const edge = await launchEdge({ profile, port, label: `edge ${name}`, width, height });
  const cdp = connect(edge.pageWs);
  try {
    await cdp.ready;
    const session = new Session({ base, user, name, runDir, prefix, edge, cdp, width, height });
    await session.init();
    return session;
  } catch (err) {
    cdp.close();
    await stopEdge(edge);
    throw err;
  }
}

class Session {
  constructor({ base, user, name, runDir, prefix, edge, cdp, width, height }) {
    Object.assign(this, { base, user, name, runDir, prefix, edge, cdp, width, height });
    this.shotsDir = assertUnderLocal(path.join(runDir, "shots"));
    this.log = { exceptions: [], console: [], failed: [], http: [] };
    this.requests = new Map();
    this.inflight = new Set();
    this.lastNetwork = 0;
    this.workspace = null;
    this.closed = null;
  }

  async init() {
    const c = this.cdp;
    const log = this.log;
    c.on("Runtime.exceptionThrown", (p) => log.exceptions.push(p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text));
    c.on("Runtime.consoleAPICalled", (p) => {
      if (p.type === "error" || p.type === "assert") log.console.push(`console.${p.type}: ${p.args.map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(" ")}`);
    });
    c.on("Log.entryAdded", (p) => { if (p.entry.level === "error") log.console.push(`log: ${p.entry.text}${p.entry.url ? ` (${pathOf(p.entry.url)})` : ""}`); });
    c.on("Network.requestWillBeSent", (p) => { this.requests.set(p.requestId, { method: p.request.method, url: p.request.url }); this.inflight.add(p.requestId); this.lastNetwork = Date.now(); });
    c.on("Network.responseReceived", (p) => {
      if (p.response.status >= 400) { const r = this.requests.get(p.requestId) || {}; log.http.push({ status: p.response.status, method: r.method || "", path: pathOf(p.response.url) }); }
    });
    c.on("Network.loadingFinished", (p) => { this.inflight.delete(p.requestId); this.lastNetwork = Date.now(); });
    c.on("Network.loadingFailed", (p) => {
      this.inflight.delete(p.requestId);
      this.lastNetwork = Date.now();
      if (!p.canceled) { const r = this.requests.get(p.requestId) || {}; log.failed.push({ method: r.method || "", path: pathOf(r.url || ""), error: p.errorText }); }
    });
    for (const domain of ["Page", "Runtime", "Log", "Network"]) await c.send(`${domain}.enable`);
    await c.send("Emulation.setDeviceMetricsOverride", { width: this.width, height: this.height, deviceScaleFactor: 1, mobile: this.width < 600 });
    await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    // The dev server's fictional sign-in: the same cookie its local sign-in page sets.
    await c.send("Network.setCookie", { name: "bt_dev_user", value: this.user, url: this.base, httpOnly: true, sameSite: "Strict" });
  }

  // ---- navigation -------------------------------------------------------------------------------
  async open(route = "dashboard") {
    const loaded = this.cdp.once("Page.loadEventFired", { timeout: 30000 });
    await this.cdp.send("Page.navigate", { url: `${this.base}/#/${route}` });
    await loaded;
    await this.settle();
  }

  async goto(route) {
    const href = String(await this.evaluate("location.href"));
    if (!href.startsWith(`${this.base}/`)) return this.open(route);
    await this.evaluate(`location.hash = ${JSON.stringify(`#/${route}`)}`);
    await sleep(50);
    await this.settle();
    return undefined;
  }

  // A full reload. The app then opens its default workspace, so the workspace this session was
  // using is chosen again through the header picker, as a person would.
  async reload() {
    const loaded = this.cdp.once("Page.loadEventFired", { timeout: 30000 });
    await this.cdp.send("Page.reload", { ignoreCache: true });
    await loaded;
    await this.settle();
    if (this.workspace) await this.useWorkspace(this.workspace);
  }

  // Chooses a workspace in the header's workspace picker (TaskTracker's command picker).
  async useWorkspace(workspaceName) {
    this.workspace = workspaceName;
    const current = () => this.evaluate("(() => { const v = document.querySelector('.picker--workspace .cmdpick__value'); return v ? v.textContent : null; })()");
    const now = await current();
    if (now === workspaceName) return;
    if (now === null) throw new Error(`${this.name}: there is no workspace picker on the page.`);
    await this.choose("Workspace", workspaceName, { scope: ".picker--workspace" });
    await this.waitFor(`(() => { const v = document.querySelector('.picker--workspace .cmdpick__value'); return !!v && v.textContent === ${JSON.stringify(workspaceName)}; })()`, { what: `the workspace picker to show ${workspaceName}` });
    await this.settle();
  }

  // Network quiet for `quiet` ms (the app re-reads slices after every write and switch).
  async settle({ quiet = 300, timeout = 15000 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (this.inflight.size === 0 && Date.now() - this.lastNetwork >= quiet) return true;
      await sleep(50);
    }
    this.log.failed.push({ method: "", path: "(network did not go quiet)", error: [...this.inflight].map((id) => pathOf((this.requests.get(id) || {}).url || "")).join(", ") });
    return false;
  }

  // ---- reading ----------------------------------------------------------------------------------
  async evaluate(expression) {
    const r = await this.cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${this.name}: page script failed: ${r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text}`);
    return r.result.value;
  }

  text(css = "body") {
    return this.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(css)}); return e ? e.innerText : ""; })()`);
  }

  exists(css) {
    return this.evaluate(`!!document.querySelector(${JSON.stringify(css)})`);
  }

  async waitFor(expression, { timeout = 10000, what = expression } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try { last = await this.evaluate(expression); if (last) return last; } catch (err) { last = err.message; }
      await sleep(100);
    }
    throw new Error(`${this.name}: timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
  }

  waitForText(text, { scope = "body", timeout = 10000 } = {}) {
    return this.waitFor(`(() => { const e = document.querySelector(${JSON.stringify(scope)}); return !!e && e.innerText.includes(${JSON.stringify(text)}); })()`, { timeout, what: `${JSON.stringify(text)} in ${scope}` });
  }

  async locate(spec) {
    const s = { ...spec };
    if (s.name instanceof RegExp) { s.nameRe = s.name.source; s.nameFlags = s.name.flags; delete s.name; }
    const r = await this.evaluate(`(${pageLocate.toString()})(${JSON.stringify(s)})`);
    if (!r || r.error) throw new Error(`${this.name}: ${describeSpec(spec)}: ${r ? r.error : "no answer"}; offered ${JSON.stringify(r ? r.offered : [])}`);
    return r;
  }

  // The accessibility tree as the browser computes it (Accessibility.getFullAXTree), without ignored nodes.
  async ax() {
    await this.cdp.send("Accessibility.enable");
    const { nodes } = await this.cdp.send("Accessibility.getFullAXTree");
    const prop = (n, name) => { const p = (n.properties || []).find((x) => x.name === name); return p && p.value ? p.value.value : undefined; };
    return nodes.filter((n) => !n.ignored).map((n) => ({
      role: n.role ? n.role.value : "", name: n.name ? n.name.value : "", focused: prop(n, "focused") === true, expanded: prop(n, "expanded"), modal: prop(n, "modal"),
    }));
  }

  async axFind(role, name) {
    return (await this.ax()).filter((n) => n.role === role && (name === undefined || (name instanceof RegExp ? name.test(n.name) : n.name === name)));
  }

  // The focused element: the DEEPEST node marked focused. Chromium also marks the document's
  // RootWebArea as focused while the page has focus, so the first match is not the element.
  async axFocused() {
    const focused = (await this.ax()).filter((n) => n.focused && n.role !== "RootWebArea");
    return focused.length ? focused[focused.length - 1] : null;
  }

  // ---- acting -----------------------------------------------------------------------------------
  async mouseClick(x, y) {
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  }

  async click(spec) {
    const at = await this.locate(spec);
    if (at.disabled) throw new Error(`${this.name}: ${describeSpec(spec)} is disabled.`);
    await this.mouseClick(at.x, at.y);
    await this.settle();
    return at;
  }

  clickText(text, { scope } = {}) {
    return this.click({ text, ...(scope ? { scope } : {}) });
  }

  // Clicks into a text field (found by its label, by default), selects what is there and types.
  async fill(spec, value) {
    const s = typeof spec === "string" ? { label: spec } : spec;
    const at = await this.locate({ ...s, focus: true });
    await this.mouseClick(at.x, at.y);
    await this.evaluate("(() => { const a = document.activeElement; if (a && typeof a.select === 'function') a.select(); })()");
    await this.cdp.send("Input.insertText", { text: String(value) });
    await sleep(100);
    const now = await this.evaluate("document.activeElement && 'value' in document.activeElement ? document.activeElement.value : null");
    if (now !== String(value)) throw new Error(`${this.name}: typing into ${describeSpec(spec)} left ${JSON.stringify(now)}, not ${JSON.stringify(String(value))}.`);
    await this.settle({ quiet: 150 });
    return now;
  }

  async press(key, { times = 1, shift = false } = {}) {
    const d = keyDef(key);
    for (let i = 0; i < times; i += 1) {
      const base = { key: d.key, code: d.code, windowsVirtualKeyCode: d.windowsVirtualKeyCode, modifiers: shift ? 8 : 0 };
      await this.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(d.text ? { text: d.text, unmodifiedText: d.text } : {}) });
      await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
      await sleep(60);
    }
    await this.settle({ quiet: 150 });
  }

  // Types text as individual real key presses into whatever has focus.
  async typeKeys(text) {
    for (const ch of String(text)) await this.press(ch);
  }

  // What an open command picker shows (TaskTracker's picker: app/js/ui/commandpicker.js).
  pickerState() {
    return this.evaluate(`(() => {
      const panel = document.querySelector('.cmdpick__panel:not([hidden])');
      const a = document.activeElement;
      const active = panel && panel.querySelector('.cmdpick__opt--active .cmdpick__optlabel');
      return {
        open: !!panel, dialog: !!document.querySelector('.modal'), search: !!(panel && panel.querySelector('.cmdpick__search')),
        rows: panel ? [...panel.querySelectorAll('.cmdpick__optlabel')].map((x) => x.textContent) : [],
        active: active ? active.textContent : null,
        focus: a ? String(a.className || a.tagName) : null, focusName: a ? (a.getAttribute('aria-label') || '') : null,
      };
    })()`);
  }

  // Chooses `optionText` in the command picker labelled `fieldLabel`: a real click opens it, the
  // option is typed into its search box (when it has one), the keyboard moves to it and Enter
  // chooses it. Returns the trigger's spoken name afterwards.
  async choose(fieldLabel, optionText, { scope } = {}) {
    const trigger = { css: ".cmdpick__trigger", label: fieldLabel, ...(scope ? { scope } : {}) };
    const at = await this.locate(trigger);
    await this.mouseClick(at.x, at.y);
    await this.waitFor("!!document.querySelector('.cmdpick__panel:not([hidden])')", { what: `the ${fieldLabel} list to open` });
    const opened = await this.pickerState();
    if (opened.search) { await this.cdp.send("Input.insertText", { text: optionText }); await sleep(150); }
    await this.press("Home");
    const seen = new Set();
    let state = await this.pickerState();
    while (state.active !== optionText && !seen.has(state.active)) {
      seen.add(state.active);
      await this.press("ArrowDown");
      state = await this.pickerState();
    }
    if (state.active !== optionText) {
      await this.press("Escape");
      throw new Error(`${this.name}: ${fieldLabel} offers no ${JSON.stringify(optionText)}; offered ${JSON.stringify(opened.rows)}`);
    }
    await this.press("Enter");
    await this.waitFor("!document.querySelector('.cmdpick__panel:not([hidden])')", { what: `the ${fieldLabel} list to close` });
    await this.settle();
    return (await this.locate(trigger)).name;
  }

  // ---- evidence ---------------------------------------------------------------------------------
  async shot(label) {
    fs.mkdirSync(this.shotsDir, { recursive: true });
    const file = path.join(this.shotsDir, `${this.prefix}${this.name}-${label}.png`.replace(/[^A-Za-z0-9._-]/g, "-"));
    const { data } = await this.cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    return path.relative(ROOT, file).replace(/\\/g, "/");
  }

  // Exceptions, console errors, failed requests and HTTP errors seen so far, minus the HTTP
  // statuses a scenario expects (`allowHttp`: [{ status, path: RegExp }]).
  problems({ allowHttp = [] } = {}) {
    const allowed = (h) => allowHttp.some((a) => a.status === h.status && (!a.path || a.path.test(h.path)));
    const allowedStatuses = new Set(allowHttp.map((a) => a.status));
    return [
      ...this.log.exceptions.map((e) => `exception: ${String(e).split("\n")[0]}`),
      ...this.log.console.filter((c) => { const m = /status of (\d{3})/.exec(c); return !(m && allowedStatuses.has(Number(m[1]))); }),
      ...this.log.failed.map((f) => `failed ${f.method} ${f.path}: ${f.error}`),
      ...this.log.http.filter((h) => !allowed(h)).map((h) => `HTTP ${h.status} ${h.method} ${h.path}`),
    ];
  }

  async close() {
    if (this.closed) return this.closed;
    this.cdp.close();
    this.closed = await stopEdge(this.edge);
    return this.closed;
  }
}
