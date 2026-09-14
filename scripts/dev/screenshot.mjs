// Real-browser screenshots of the LOCAL dev server with a FICTIONAL signed-in user, via the Chrome
// DevTools Protocol in headless Microsoft Edge. Evidence for UX/accessibility review; it proves
// layout and rendering, which the Node DOM double cannot.
//
//   node scripts/dev/screenshot.mjs --user alice --out .local/shots [--routes dashboard,accounts]
//
// Uses an isolated throwaway profile under .local/, a debugging port on loopback (default 9333),
// and only the local dev server (refuses any other origin). Screenshots may show fictional data
// only and are written under .local/ (ignored by Git).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stopEdge } from "./harness/edge.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]]] : acc), []));
const BASE = args.base || "http://127.0.0.1:4380";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) { console.error("Screenshots are only taken of the local dev server."); process.exit(2); }
const OUT = path.resolve(ROOT, args.out || ".local/shots");
if (!OUT.startsWith(path.join(ROOT, ".local"))) { console.error("Output must be under .local/."); process.exit(2); }
const USER = args.user || "";
const ROUTES = (args.routes || "dashboard,transactions,accounts,payees,workspace,settings").split(",");
const PORT = Number(args.port || 9333);
const EDGE = args.edge || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// --full 1 captures the whole page (up to 6000 px tall) instead of the viewport.
const FULL = !!args.full;

fs.mkdirSync(OUT, { recursive: true });
const profile = path.join(ROOT, ".local", `edge-profile-${Date.now()}`);
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`, "--no-first-run", "--disable-extensions", "--window-size=1280,900", "about:blank"], { stdio: "ignore" });

// The page to drive and the browser endpoint (for Browser.close at cleanup).
let browserWs = null;
async function cdpTarget() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) { browserWs = version.webSocketDebuggerUrl || null; return page.webSocketDebuggerUrl; }
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error("Edge did not start");
}

function client(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else events.push(msg);
  });
  const ready = new Promise((r) => ws.addEventListener("open", r));
  return {
    events,
    async send(method, params = {}) {
      await ready;
      const msgId = ++id;
      ws.send(JSON.stringify({ id: msgId, method, params }));
      const msg = await new Promise((r) => pending.set(msgId, r));
      if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
      return msg.result;
    },
    close: () => ws.close(),
  };
}

try {
  const cdp = client(await cdpTarget());
  const capture = async () => {
    if (!FULL) return cdp.send("Page.captureScreenshot", { format: "png" });
    const metrics = await cdp.send("Page.getLayoutMetrics");
    const size = metrics.cssContentSize || metrics.contentSize;
    return cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.width, height: Math.min(size.height, 6000), scale: 1 } });
  };
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  if (USER) await cdp.send("Network.setCookie", { name: "bt_dev_user", value: USER, url: BASE, httpOnly: true, sameSite: "Strict" });
  const shots = [];
  for (const [label, width, height, mode] of [["desktop-light", 1280, 900, "light"], ["desktop-dark", 1280, 900, "dark"], ["narrow-light", 390, 844, "light"]]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: mode }, { name: "prefers-reduced-motion", value: "reduce" }] });
    for (const route of USER ? ROUTES : ["landing"]) {
      // Navigate, then RELOAD: a hash-only navigation keeps the page alive, and its colour mode
      // would then depend on media-change event timing rather than on the emulated preference.
      await cdp.send("Page.navigate", { url: `${BASE}/${USER ? `#/${route}` : ""}` });
      await sleep(300);
      await cdp.send("Page.reload", { ignoreCache: true });
      await sleep(1400);
      const { data } = await capture();
      const file = path.join(OUT, `${label}-${route}.png`);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      shots.push(path.relative(ROOT, file));
    }
  }
  // Interaction evidence (desktop light): the account menu with the day/night control, and quick
  // entry after choosing a known merchant (explained, editable suggestions).
  if (USER && args.interact) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }, { name: "prefers-reduced-motion", value: "reduce" }] });
    const evaluate = (expression) => cdp.send("Runtime.evaluate", { expression, awaitPromise: true });
    for (const action of args.interact.split(",")) {
      await cdp.send("Page.navigate", { url: `${BASE}/#/dashboard` });
      await sleep(300);
      await cdp.send("Page.reload", { ignoreCache: true });
      await sleep(1500);
      if (action === "menu") await evaluate("document.querySelector('.avatar').click()");
      // "New workspace…" from the account menu: the dialog, nothing submitted.
      if (action === "newws") {
        await evaluate("document.querySelector('.avatar').click()");
        await sleep(300);
        await evaluate("[...document.querySelectorAll('.menu__item')].find(b => /New workspace/.test(b.textContent)).click()");
      }
      if (action === "quick") {
        await evaluate("[...document.querySelectorAll('.page-head button')].find(b => /Add/.test(b.textContent)).click()");
        await sleep(400);
        await evaluate(`(() => { const i = document.querySelector('.modal input[list]'); i.value = ${JSON.stringify(args.payee || "Corner Cafe")}; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      }
      // The icon picker (BT-011-05) open in the Add account dialog; "iconpickesc" then presses a real
      // Escape key, which must close only the list and keep the dialog open (UXI-1).
      if (action === "iconpick" || action === "iconpickesc") {
        await evaluate("location.hash = '#/accounts'");
        await sleep(1200);
        await evaluate("[...document.querySelectorAll('.page-head button')].find(b => /Add/.test(b.textContent)).click()");
        await sleep(500);
        await evaluate("[...document.querySelectorAll('.modal .themepick__toggle')].at(-1).click()");
        if (action === "iconpickesc") {
          await sleep(300);
          for (const type of ["keyDown", "keyUp"]) await cdp.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
          await sleep(300);
          const state = await evaluate("JSON.stringify({ dialogOpen: !!document.querySelector('.modal'), listOpen: [...document.querySelectorAll('.modal .themepick__toggle')].some(t => t.getAttribute('aria-expanded') === 'true'), focusOnToggle: !!(document.activeElement && document.activeElement.classList.contains('themepick__toggle')) })");
          console.error(`iconpickesc ${state.result.value}`);
        }
      }
      // The restore dialog (workspace page): "restorehover" hovers the still-disabled Restore button,
      // which must show the styled "Preview first" hint; "restorepreview" ticks "bring back deleted
      // entries" and runs Preview. A backup is created first if the workspace has none.
      if (action === "restorehover" || action === "restorepreview") {
        await evaluate("location.hash = '#/workspace'");
        await sleep(1500);
        await evaluate("(() => { if (!document.querySelector('[aria-label^=\"Restore from\"]')) { const b = [...document.querySelectorAll('button')].find((x) => /Create backup now/.test(x.textContent)); if (b) b.click(); } })()");
        await sleep(1500);
        await evaluate("document.querySelector('[aria-label^=\"Restore from\"]').click()");
        await sleep(700);
        if (action === "restorehover") {
          const r = await evaluate("JSON.stringify((() => { const b = document.querySelector('.modal .tip button').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })())");
          const { x, y } = JSON.parse(r.result.value);
          await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        } else {
          await evaluate("(() => { const c = document.querySelector('.modal input[type=checkbox]'); if (c && !c.checked) c.click(); [...document.querySelectorAll('.modal button')].find((b) => /^Preview$/.test(b.textContent.trim())).click(); })()");
        }
      }
      // Shared expenses (BT-009): the Add expense dialog with a fictional description and amount, so
      // the live split preview and its rounding note show; nothing is saved.
      if (action === "groupadd") {
        await evaluate("location.hash = '#/group'");
        await sleep(1500);
        await evaluate("[...document.querySelectorAll('.page-head button')].find((b) => b.textContent === 'Add expense').click()");
        await sleep(500);
        await evaluate(`(() => { const set = (sel, v) => { const i = document.querySelector(sel); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }; set('.modal input[placeholder^="For example"]', 'Fictional boat trip'); set('.modal input[placeholder^="0.00 or"]', '100'); })()`);
      }
      // The header's workspace picker open (BT-004-04): "wspick" at desktop light, "wspickdark" and
      // "wspicknarrow" (390 px) as named, and "wspicksearch" with text typed so the pinned
      // "+ New workspace “…”" carries it. Nothing is chosen or created.
      // "wspickkeys" drives the picker with REAL key presses: Enter opens it, Escape closes it with
      // focus back on the trigger, Tab reaches "+ New workspace" and Enter opens the dialog, and
      // Escape closes the dialog with focus back on the trigger. Nothing is created.
      if (action === "wspickkeys") {
        // Enter carries its character, as a real keyboard does: Chromium activates a focused button
        // from the key's character event, which a bare keyDown does not produce.
        const key = async (name, code, vk) => {
          for (const type of ["keyDown", "keyUp"]) await cdp.send("Input.dispatchKeyEvent", { type, key: name, code, windowsVirtualKeyCode: vk, ...(type === "keyDown" && name === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) });
          await sleep(250);
        };
        const probe = async (label) => {
          const r = await evaluate("JSON.stringify({ open: !!document.querySelector('.cmdpick__panel'), dialog: !!document.querySelector('.modal'), focus: document.activeElement ? (document.activeElement.className || document.activeElement.tagName) : null, name: document.activeElement ? (document.activeElement.getAttribute('aria-label') || document.activeElement.textContent || '').slice(0, 60) : null })");
          console.error(`wspickkeys ${label} ${r.result.value}`);
        };
        await evaluate("document.querySelector('.picker--workspace .cmdpick__trigger').focus()");
        await key("Enter", "Enter", 13); await probe("enter-opens");
        await key("Escape", "Escape", 27); await probe("escape-closes");
        await key("Enter", "Enter", 13);
        await key("Tab", "Tab", 9); await probe("tab-to-create");
        await key("Enter", "Enter", 13); await sleep(300); await probe("enter-opens-dialog");
        await key("Escape", "Escape", 27); await sleep(300); await probe("escape-closes-dialog");
      }
      // BT-004-05: a converted dropdown open in its dialog or page, at desktop light, "-dark" or
      // "-narrow" (390 px). "pickkeys" drives the Add account dialog with REAL key presses (Escape in a
      // list without a search box closes only the list; Tab leaves an open panel for the next field;
      // typing searches; the next Escape closes the dialog). "pickprog" changes a picker's select from
      // code in the real browser (value, disabled, hints, new options, an option's own text through
      // the MutationObserver) and reports what the trigger shows. Nothing is saved.
      const PICKS = {
        pickacct: { route: "accounts", open: "Add account", field: "Type" },
        pickcurrency: { route: "accounts", open: "Add account", field: "Currency" },
        pickquick: { route: "transactions", open: "Add expense", field: "Category" },
        pickbill: { route: "bills", open: "Add bill", field: "Repeats" },
        pickbudget: { route: "planning", open: "Add budget", field: "Category" },
        pickmerchant: { route: "payees", open: "Add merchant", field: "Default category" },
        pickfilter: { route: "transactions", field: "Category", filters: true },
        picksettings: { route: "settings", field: "Date format" },
        pickrole: { route: "workspace", spoken: "Role for " },
        pickgroup: { route: "group", open: "Add expense", field: "Split", workspace: "Dinner Club" },
      };
      const pickBase = action.replace(/-(dark|narrow)$/, "");
      if (PICKS[pickBase] || action === "pickkeys" || action === "pickprog") {
        const p = PICKS[pickBase] || { route: "accounts", open: "Add account" };
        const narrow = action.endsWith("-narrow");
        const dark = action.endsWith("-dark");
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: narrow ? 390 : 1280, height: narrow ? 844 : 900, deviceScaleFactor: 1, mobile: narrow });
        await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }, { name: "prefers-reduced-motion", value: "reduce" }] });
        await cdp.send("Page.reload", { ignoreCache: true });
        await sleep(1500);
        if (p.workspace) {
          await evaluate(`(() => { const s = document.querySelector('#workspace-picker'); const o = [...s.querySelectorAll('option')].find((x) => x.textContent.includes(${JSON.stringify(p.workspace)})); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
          await sleep(1500);
        }
        await evaluate(`location.hash = '#/${p.route}'`);
        await sleep(1500);
        if (p.open) {
          await evaluate(`[...document.querySelectorAll('.page-head button')].find((b) => b.textContent === ${JSON.stringify(p.open)}).click()`);
          await sleep(600);
        }
        if (p.filters) { await evaluate("document.querySelector('.filters-box').open = true"); await sleep(300); }
        const triggerOf = (field, spoken = "") => `(() => { const scope = document.querySelector('.modal') || document; if (${JSON.stringify(spoken)}) return [...scope.querySelectorAll('.cmdpick__trigger')].find((b) => (b.getAttribute('aria-label') || '').startsWith(${JSON.stringify(spoken)})); const l = [...scope.querySelectorAll('label')].find((x) => x.textContent === ${JSON.stringify(field)}); return l && document.getElementById(l.getAttribute('for')); })()`;
        const state = async (label) => {
          const r = await evaluate(`JSON.stringify((() => { const panel = document.querySelector('.cmdpick__panel'); const r = panel && panel.getBoundingClientRect(); const a = document.activeElement; return { open: !!panel, dialog: !!document.querySelector('.modal'), focus: a ? (a.className || a.tagName) : null, focusName: a ? (a.getAttribute('aria-label') || a.textContent || '').slice(0, 70) : null, rows: document.querySelectorAll('.cmdpick__opt').length, panel: r ? { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width) } : null, inside: r ? r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight : null, viewport: [innerWidth, innerHeight], overflowX: document.documentElement.scrollWidth > innerWidth }; })())`);
          console.error(`${action} ${label} ${r.result.value}`);
        };
        const key = async (name, code, vk, extra = {}) => {
          for (const type of ["keyDown", "keyUp"]) await cdp.send("Input.dispatchKeyEvent", { type, key: name, code, windowsVirtualKeyCode: vk, ...extra, ...(type === "keyDown" && name === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) });
          await sleep(250);
        };
        if (PICKS[pickBase]) {
          await evaluate(`(() => { const t = ${triggerOf(p.field, p.spoken)}; t.scrollIntoView({ block: "center" }); t.click(); })()`);
          await sleep(400);
          await state("open");
        } else if (action === "pickkeys") {
          await evaluate(`${triggerOf("Type")}.focus()`);
          await key("Enter", "Enter", 13); await state("enter-opens-list");
          await key("ArrowDown", "ArrowDown", 40);
          await key("Escape", "Escape", 27); await state("escape-closes-list-only");
          await key("Enter", "Enter", 13);
          await key("Tab", "Tab", 9); await state("tab-leaves-panel");
          await evaluate(`${triggerOf("Currency")}.focus()`);
          await key("Enter", "Enter", 13);
          await cdp.send("Input.insertText", { text: "gb" });
          await sleep(250);
          await state("typed-gb");
          await key("Enter", "Enter", 13);
          const chosen = await evaluate(`${triggerOf("Currency")}.getAttribute('aria-label')`);
          console.error(`${action} chosen ${JSON.stringify(chosen.result.value)}`);
          await key("Escape", "Escape", 27); await state("escape-closes-dialog");
        } else {
          const r = await evaluate(`(async () => {
            const t = ${triggerOf("Currency")};
            const s = t.parentNode.querySelector('select');
            const text = () => t.querySelector('.cmdpick__value').textContent;
            const out = { labelFor: !!document.querySelector('label[for="' + t.id + '"]') };
            s.value = 'CHF'; out.value = text();
            s.disabled = true; out.disabled = t.disabled; s.disabled = false; out.enabled = !t.disabled;
            s.setAttribute('aria-describedby', 'fictional-hint'); s.setAttribute('aria-invalid', 'true');
            out.describedby = t.getAttribute('aria-describedby'); out.invalid = t.getAttribute('aria-invalid');
            s.removeAttribute('aria-invalid'); out.invalidCleared = !t.hasAttribute('aria-invalid');
            s.replaceChildren(new Option('Fictional A', 'A'), new Option('Fictional B', 'B')); out.replaced = text();
            s.querySelector('option').textContent = 'Fictional A renamed';
            await new Promise((r) => setTimeout(r, 100)); out.observed = text();
            s.focus(); out.focusOnTrigger = document.activeElement === t;
            return JSON.stringify(out);
          })()`);
          console.error(`${action} ${r.result.value}`);
        }
      }
      if (action.startsWith("wspick") && action !== "wspickkeys") {
        if (action === "wspickdark" || action === "wspicknarrow") {
          const narrow = action === "wspicknarrow";
          await cdp.send("Emulation.setDeviceMetricsOverride", { width: narrow ? 390 : 1280, height: narrow ? 844 : 900, deviceScaleFactor: 1, mobile: narrow });
          await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: narrow ? "light" : "dark" }, { name: "prefers-reduced-motion", value: "reduce" }] });
          await cdp.send("Page.reload", { ignoreCache: true });
          await sleep(1500);
        }
        await evaluate("document.querySelector('.picker--workspace .cmdpick__trigger').click()");
        if (action === "wspicksearch") {
          await sleep(200);
          await evaluate("(() => { const b = document.querySelector('.cmdpick__search'); b.value = 'Allot'; b.dispatchEvent(new Event('input', { bubbles: true })); })()");
        }
        await sleep(300);
        const state = await evaluate("JSON.stringify({ open: !!document.querySelector('.cmdpick__panel'), focus: document.activeElement && document.activeElement.className, active: document.activeElement && document.activeElement.getAttribute('aria-activedescendant'), panel: (() => { const p = document.querySelector('.cmdpick__panel'); if (!p) return null; const r = p.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), width: Math.round(r.width) }; })(), viewport: innerWidth, overflowX: document.documentElement.scrollWidth > innerWidth })");
        console.error(`${action} ${state.result.value}`);
      }
      await sleep(1200);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
      const file = path.join(OUT, `interact-${action}.png`);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      shots.push(path.relative(ROOT, file));
    }
  }
  const problems = cdp.events.filter((e) => e.method === "Runtime.exceptionThrown" || (e.method === "Log.entryAdded" && ["error"].includes(e.params.entry.level)))
    .map((e) => (e.method === "Runtime.exceptionThrown" ? `exception: ${e.params.exceptionDetails.exception ? e.params.exceptionDetails.exception.description : e.params.exceptionDetails.text}` : `console ${e.params.entry.level}: ${e.params.entry.text}`));
  console.log(JSON.stringify({ shots, problems: [...new Set(problems)].slice(0, 20) }, null, 2));
  cdp.close();
} finally {
  // edge.kill() alone left Edge running with its profile locked on Windows (tooling debt): close it
  // through CDP, then stop only the processes holding this run's own profile, then remove the profile
  // (scripts/dev/harness/edge.mjs).
  const cleanup = await stopEdge({ child: edge, profile, browserWs, label: "screenshot edge" });
  if (cleanup.survivors.length || !cleanup.profileRemoved) console.error(`cleanup incomplete: ${JSON.stringify(cleanup)}`);
}
