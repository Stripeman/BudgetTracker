// THE REDESIGNED SIGN-IN PAGE (Terry's 2026-09-16 design brief), verified signed OUT in real
// headless Edge: heading and Google route, the reused day/night control, WCAG AA contrast in every
// theme palette and both modes, 320/390 px width with no horizontal overflow, a 200 %-zoom-
// equivalent viewport that does not clip the sign-in button, prefers-reduced-motion collapsing
// transitions, and the illustrative preview panel calling no private API.
//
// The harness signs every browser session in as a fictional user by default (BT-004-06); this
// scenario is about the page BEFORE that, so each session's dev sign-in cookie is deleted and the
// page reloaded before any check runs (`signedOut`, below).
export const name = "login";
export const title = "Sign-in page: heading, Google route, day/night, every palette's contrast, 320/390 px, 200% zoom, reduced motion, no private network calls";
export const needsBrowser = true;

// The eight palettes the theme picker offers (app/js/ui/theme.js THEMES / api/_shared/site.js
// PALETTES; kept equal by app/test/appearance.test.js). Hardcoded here rather than imported: this
// script runs under Node, outside the app bundle, and the ids are a small, stable, tested contract.
const PALETTES = ["midnight", "slate", "forest", "solar", "teal", "rose", "amber", "indigo"];

// Real text against its EFFECTIVE background (walking up through ancestors to the first opaque
// background-color). The gradient surfaces in components.css (.login, .login__panel--preview) each
// carry an explicit opaque background-color fallback under their gradient image for exactly this
// reason — a contrast probe reads `background-color`, not the composited pixels, and no surface
// here is a photo. Returns a contrast ratio per selector, or null when the selector matches
// nothing. Serialized with toString(), like session.mjs's pageLocate, so it must be self-contained.
function pageContrast(selectors) {
  function relLuminance([r, g, b]) {
    const chan = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
  }
  function parseRgb(str) {
    const m = /rgba?\(([^)]+)\)/.exec(str || "");
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function effectiveBg(el) {
    for (let node = el; node; node = node.parentElement) {
      const bg = parseRgb(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0.99) return bg;
    }
    return { r: 255, g: 255, b: 255 };
  }
  function ratio(fg, bg) {
    const l1 = relLuminance([fg.r, fg.g, fg.b]) + 0.05;
    const l2 = relLuminance([bg.r, bg.g, bg.b]) + 0.05;
    return l1 > l2 ? l1 / l2 : l2 / l1;
  }
  const out = {};
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) { out[sel] = null; continue; }
    const fg = parseRgb(getComputedStyle(el).color);
    out[sel] = fg ? Math.round(ratio(fg, effectiveBg(el)) * 100) / 100 : null;
  }
  return out;
}

// Every real (non-decorative) text element on the page, checked in every palette and mode.
const CONTRAST_SELECTORS = [
  ".login__heading", ".login__lede", ".login__brandname", ".login__points li", ".login__foot",
  ".login__previewlabel", ".login__widget .card__title", ".login__widget .card__meta", ".menu__heading",
];

// Non-text contrast (WCAG 1.4.11): each preview card's own border against the surface it sits on.
// Independent accessibility review of BT-011-08 found the plain `--border` token unreadable here (in
// light mode `--surface`/`--surface-raised` are the same white, so the border was the only thing
// separating a card from its background, at ~1.3:1) and not covered by CONTRAST_SELECTORS above,
// which only checks text. Fixed with `--control-border`, the token tokens.css itself documents as
// meeting 3:1 (A11Y-009); this check guards it stays that way in every palette and mode.
const BORDER_CONTRAST_SELECTORS = [".login__panel--preview", ".login__widget"];
function pageBorderContrast(selectors) {
  function relLuminance([r, g, b]) {
    const chan = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
  }
  function parseRgb(str) {
    const m = /rgba?\(([^)]+)\)/.exec(str || "");
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function effectiveBg(el) {
    for (let node = el; node; node = node.parentElement) {
      const bg = parseRgb(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0.99) return bg;
    }
    return { r: 255, g: 255, b: 255 };
  }
  function ratio(fg, bg) {
    const l1 = relLuminance([fg.r, fg.g, fg.b]) + 0.05;
    const l2 = relLuminance([bg.r, bg.g, bg.b]) + 0.05;
    return l1 > l2 ? l1 / l2 : l2 / l1;
  }
  const out = {};
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) { out[sel] = null; continue; }
    const border = parseRgb(getComputedStyle(el).borderTopColor);
    // The colour immediately outside the border (the parent's own effective background), not the
    // element's own — a border exists to separate the element from what surrounds it.
    const outside = el.parentElement ? effectiveBg(el.parentElement) : effectiveBg(el);
    out[sel] = border ? Math.round(ratio(border, outside) * 100) / 100 : null;
  }
  return out;
}

const toMs = (css) => { const s = String(css).trim(); return s.endsWith("ms") ? parseFloat(s) : s.endsWith("s") ? parseFloat(s) * 1000 : NaN; };
const transitionDuration = (s, css) => s.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(css)})).transitionDuration`);

// Removes the harness's default fictional sign-in cookie and reloads, landing on the real,
// unauthenticated page — never Terry's or another application's ports or data (BT-004-06). A first
// `open()` is needed before `reload()` can do anything: a fresh session's browser tab starts at
// about:blank, and `Page.reload` reloads whatever is already loaded.
async function signedOut(session) {
  await session.open("dashboard");
  await session.cdp.send("Network.deleteCookies", { name: "bt_dev_user", url: session.base });
  // The dashboard just loaded (still signed in) fetched plenty of private data of its own — that is
  // expected and not what this scenario checks. Clearing the log HERE, before the reload that
  // actually lands on the signed-out page, means every later check (network and `problems()`) sees
  // only what the sign-in page itself did.
  session.requests.clear();
  session.log.http.length = 0; session.log.failed.length = 0; session.log.exceptions.length = 0; session.log.console.length = 0;
  await session.reload();
  return session;
}

const noPrivateApi = (session, extra = []) => {
  const reqs = [...session.requests.values()].map((r) => { try { return `${r.method} ${new URL(r.url).pathname}`; } catch { return r.url; } });
  const allowed = (r) => r.endsWith("/api/me") || r.endsWith("/api/site-settings") || extra.some((e) => r.endsWith(e));
  return reqs.filter((r) => r.includes("/api/")).filter((r) => !allowed(r));
};
const ALLOW_401_ME = [{ status: 401, path: /\/api\/me$/ }];

export async function run(h, t) {
  // ---- structure, the reused day/night control, palette contrast and preview network isolation --
  const { alice } = await h.browsers(["alice"], { prefix: "login-" });
  await signedOut(alice);

  const h1 = await alice.text("h1");
  t.check("one H1 with the brief's exact heading", { expected: "Know where your money is going.", actual: h1 });

  const points = await alice.evaluate("[...document.querySelectorAll('.login__points li')].map((li) => li.textContent)");
  t.check("the three privacy assurances are present, in words", {
    expected: [
      "Financial records are private by default.",
      "Sharing is explicit and controlled by you.",
      "Site administrators cannot browse private financial records.",
    ],
    actual: points,
  });

  // The switch itself refuses a press while "Use device setting" is followed (daynight.js, by
  // design — the same as the signed-in account menu): first take control of the choice, exactly as
  // a person would, then flip it.
  t.check("initially the control follows the device (the fresh browser profile has no saved choice)", { expected: true, actual: await alice.evaluate("document.querySelector('.daynight__device').checked") });
  await alice.click({ css: ".daynight__device" });
  const before = await alice.evaluate("document.documentElement.getAttribute('data-mode')");
  await alice.click({ css: ".daynight__switch" });
  const after = await alice.evaluate("document.documentElement.getAttribute('data-mode')");
  t.check("the moon/sun control toggles the page's own data-mode synchronously (no reload, no flash of the old mode)", {
    expected: true, actual: before !== after && ["light", "dark"].includes(after),
  });
  await alice.shot(`1-daynight-${after}`);

  // ---- every palette the theme picker offers, in both modes: WCAG AA (>= 4.5:1) on every real
  // text/background pair the page draws (not only the default midnight palette) -------------------
  const shotPalettes = new Set(["midnight", "forest", "rose"]);
  for (const themeId of PALETTES) {
    for (const mode of ["light", "dark"]) {
      await alice.evaluate(`(() => { const r = document.documentElement; r.setAttribute('data-theme', ${JSON.stringify(themeId)}); r.setAttribute('data-mode', ${JSON.stringify(mode)}); r.setAttribute('data-color-scheme', ${JSON.stringify(mode)}); })()`);
      const ratios = await alice.evaluate(`(${pageContrast.toString()})(${JSON.stringify(CONTRAST_SELECTORS)})`);
      const failing = Object.entries(ratios).filter(([, r]) => r === null || r < 4.5).map(([sel, r]) => `${sel}: ${r}`);
      t.check(`${themeId}/${mode}: every checked text is >= 4.5:1 against its effective background`, { expected: [], actual: failing });
      const borderRatios = await alice.evaluate(`(${pageBorderContrast.toString()})(${JSON.stringify(BORDER_CONTRAST_SELECTORS)})`);
      const failingBorders = Object.entries(borderRatios).filter(([, r]) => r === null || r < 3).map(([sel, r]) => `${sel}: ${r}`);
      t.check(`${themeId}/${mode}: every preview card border is >= 3:1 against its surroundings (WCAG 1.4.11)`, { expected: [], actual: failingBorders });
      if (shotPalettes.has(themeId)) await alice.shot(`2-palette-${themeId}-${mode}`);
    }
  }
  // Back to the default before the network/other checks below, matching what a fresh load shows.
  await alice.evaluate("(() => { const r = document.documentElement; r.setAttribute('data-theme', 'midnight'); r.setAttribute('data-mode', 'light'); r.setAttribute('data-color-scheme', 'light'); })()");

  const leaked = noPrivateApi(alice);
  t.check("the whole signed-out page — including the illustrative preview — calls no private or financial API; only /api/me (401) and the public /api/site-settings are allowed", { expected: [], actual: leaked });

  t.check("alice (signed out, default view): no exceptions, console errors or unexpected failed/HTTP-error requests", { expected: [], actual: alice.problems({ allowHttp: ALLOW_401_ME }) });

  // ---- the Google sign-in route is UNCHANGED: same href, and a real click reaches it -------------
  const { alice: googleNav } = await h.browsers(["alice"], { prefix: "login-google-" });
  await signedOut(googleNav);
  const href = await googleNav.evaluate("document.querySelector('.login__google').getAttribute('href')");
  t.check("the Google button targets /.auth/login/google (AUTH.login), unchanged", { expected: true, actual: typeof href === "string" && href.startsWith("/.auth/login/google") });
  const loaded = googleNav.cdp.once("Page.loadEventFired", { timeout: 10000 });
  await googleNav.click({ role: "link", name: "Sign in with Google" });
  await loaded;
  const landedPath = await googleNav.evaluate("location.pathname");
  t.check("clicking it really navigates to the auth route (not only the markup)", { expected: "/.auth/login/google", actual: landedPath });
  t.check("google-nav: no exceptions or console errors", { expected: [], actual: googleNav.problems({ allowHttp: ALLOW_401_ME }) });

  // ---- 320 px and 390 px width: no horizontal overflow, in both modes; brand/value/privacy/
  // appearance/sign-in all readable above the illustrative preview (document order, not CSS order) -
  for (const width of [320, 390]) {
    const { alice: narrow } = await h.browsers(["alice"], { prefix: `login-${width}-`, width, height: 844 });
    await signedOut(narrow);
    // Take control once, then drive to each named mode explicitly — never assumed from which mode a
    // fresh profile starts (a machine whose OS itself prefers dark resolves "system" to dark).
    await narrow.click({ css: ".daynight__device" });
    for (const mode of ["light", "dark"]) {
      const current = await narrow.evaluate("document.documentElement.getAttribute('data-mode')");
      if (current !== mode) await narrow.click({ css: ".daynight__switch" });
      const overflow = await narrow.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1");
      t.check(`${width}px/${mode}: no horizontal overflow`, { expected: false, actual: overflow });
      const order = await narrow.evaluate("[...document.querySelectorAll('.login__panel--brand, .login__panel--preview')].map((n) => n.className.includes('preview') ? 'preview' : 'brand')");
      t.check(`${width}px/${mode}: the sign-in panel precedes the illustrative preview in document order`, { expected: ["brand", "preview"], actual: order });
      await narrow.shot(`3-${width}-${mode}`);
    }
    t.check(`${width}px: no exceptions or console errors`, { expected: [], actual: narrow.problems({ allowHttp: ALLOW_401_ME }) });
  }

  // ---- a 200 % zoom equivalent (a real browser's zoom does not change CSS pixels the way a
  // narrower/shorter viewport does, so this uses the same technique the dropdown scenario does for
  // 400 %): the Google sign-in button must still be reachable, not clipped by any ancestor --------
  const { alice: zoomed } = await h.browsers(["alice"], { prefix: "login-zoom-", width: 640, height: 400 });
  await signedOut(zoomed);
  const clip = await zoomed.evaluate(`(() => {
    const el = document.querySelector('.login__google');
    const r = el.getBoundingClientRect();
    let clipped = false;
    for (let node = el.parentElement; node; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if ((cs.overflowY === 'hidden' || cs.overflow === 'hidden') && node.scrollHeight > node.clientHeight + 1) {
        const nr = node.getBoundingClientRect();
        if (r.top < nr.top - 1 || r.bottom > nr.bottom + 1) clipped = true;
      }
    }
    return { clipped, visible: r.width > 0 && r.height > 0 };
  })()`);
  t.check("at 640x400 (a 200% zoom equivalent) the sign-in button is present and not clipped by any ancestor", { expected: { clipped: false, visible: true }, actual: clip });
  await zoomed.shot("4-zoom-equivalent");
  t.check("zoomed: no exceptions or console errors", { expected: [], actual: zoomed.problems({ allowHttp: ALLOW_401_ME }) });

  // ---- prefers-reduced-motion disables transitions; without it, the normal transition applies ----
  const reducedMs = toMs(await transitionDuration(alice, ".login__google"));
  t.check("the harness's default prefers-reduced-motion collapses the sign-in button's transition to (near) 0", { expected: true, actual: reducedMs < 1 });
  const { alice: motion } = await h.browsers(["alice"], { prefix: "login-motion-" });
  await motion.cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  await signedOut(motion);
  const normalMs = toMs(await transitionDuration(motion, ".login__google"));
  t.check("without the preference, the button's normal (>= 100ms) transition applies", { expected: true, actual: normalMs >= 100 });
  t.check("motion: no exceptions or console errors", { expected: [], actual: motion.problems({ allowHttp: ALLOW_401_ME }) });

  // ---- a very short aspect ratio (practical check, not exhaustive): nothing is clipped off-screen
  const { alice: shortAspect } = await h.browsers(["alice"], { prefix: "login-short-", width: 1100, height: 360 });
  await signedOut(shortAspect);
  const shortOverflowX = await shortAspect.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1");
  t.check("at a very short viewport (1100x360) there is still no HORIZONTAL overflow (vertical scrolling is fine)", { expected: false, actual: shortOverflowX });
  await shortAspect.shot("5-short-aspect");
  t.check("short-aspect: no exceptions or console errors", { expected: [], actual: shortAspect.problems({ allowHttp: ALLOW_401_ME }) });
}
