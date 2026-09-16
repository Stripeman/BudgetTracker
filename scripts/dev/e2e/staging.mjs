// STAGING LINK (BT-011-06): the account-menu link to the staging (preview) site, driven with real
// clicks and keys in Edge. Alice adds, edits and clears her link; it opens in a new tab with
// rel="noopener noreferrer"; javascript: and plain http addresses are refused inside the editor and
// by the server; Bob, in his own browser at the same time, sees only his own link, never Alice's.
// The harness's dev server is the LOCAL development environment, so http to 127.0.0.1 is accepted
// there (Terry, 2026-09-14). Review of d363eff: Eve, signed in but in no workspace, never receives
// the site's default; a link locked by the site with no site value says so and one's own saved
// address can still be cleared. Fictional addresses only (.test is a reserved name); the real preview
// address is never used here. Stored addresses are normalised (a trailing slash after the host).
export const name = "staging";
export const title = "Staging link: add, edit, clear; new tab with noopener; refused addresses; local http; Bob, Eve and a site lock";
export const needsBrowser = true;

const ALICE_URL = "https://staging.example.test/";
const ALICE_EDIT = "https://preview.example.test/app";
const BOB_URL = "https://bob-staging.example.test/";
const LOCAL_URL = "http://127.0.0.1:4380/";
const SITE_URL = "https://site-staging.example.test/";
const FIELD = { label: "Staging site address", scope: ".modal" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Opens the account menu with a real click on its button, unless it is already open.
async function openMenu(s, who) {
  const open = await s.evaluate("document.querySelector('.avatar').getAttribute('aria-expanded') === 'true'");
  if (!open) await s.click({ role: "button", name: new RegExp(`account menu for ${who}`) });
}

const linkState = (s) => s.evaluate(`(() => {
  const a = document.querySelector('.menu__link');
  const add = document.querySelector('.menu__add');
  const shown = (n) => !!n && !n.closest('[hidden]') && n.getClientRects().length > 0;
  return { link: shown(a), href: a ? a.getAttribute('href') : null, target: a ? a.getAttribute('target') : null, rel: a ? a.getAttribute('rel') : null, add: shown(add) };
})()`);

const lockState = (s) => s.evaluate(`(() => {
  const shown = (n) => !!n && !n.closest('[hidden]') && n.getClientRects().length > 0;
  const note = document.querySelector('.menu__locked');
  return { note: shown(note) ? note.textContent : null, link: shown(document.querySelector('.menu__link')), add: shown(document.querySelector('.menu__add')), edit: shown(document.querySelector('.menu__edit')) };
})()`);

const editorState = (s) => s.evaluate(`(() => {
  const d = document.querySelector('.modal');
  const e = d && d.querySelector('.modal__error');
  const i = d && d.querySelector('input');
  return { dialog: !!d, error: e && !e.hidden ? e.textContent : null, invalid: i ? i.getAttribute('aria-invalid') : null, value: i ? i.value : null };
})()`);

const saved = async (h, user) => {
  const p = await h.api(user).ok("preferences");
  return { url: p.effective.stagingUrl, source: p.sources.stagingUrl };
};

const pages = async (s) => (await (await fetch(`http://127.0.0.1:${s.edge.port}/json/list`)).json()).filter((p) => p.type === "page");

const waitForEditor = (s) => s.waitFor("!!document.querySelector('.modal')", { what: "the staging link editor" });
const waitForEditorClosed = (s) => s.waitFor("!document.querySelector('.modal')", { what: "the staging link editor to close" });

export async function run(h, t) {
  const { alice, bob } = await h.browsers(["alice", "bob"], { prefix: "staging-" });
  await alice.open("dashboard");

  // ---- add -----------------------------------------------------------------------------------
  await openMenu(alice, "Alice");
  let state = await linkState(alice);
  t.check("alice: with no address the menu offers Add staging link… and no link", { expected: { link: false, add: true }, actual: { link: state.link, add: state.add } });
  await alice.click({ role: "button", name: "Add staging link…" });
  await waitForEditor(alice);
  const focused = await alice.axFocused();
  t.check("alice: the editor opens with focus in a text field named Staging site address", {
    expected: { role: "textbox", name: "Staging site address" }, actual: focused ? { role: focused.role, name: focused.name } : null,
  });
  await alice.fill(FIELD, "https://staging.example.test");
  await alice.press("Enter");
  await waitForEditorClosed(alice);
  t.check("alice: Enter saves the address, normalised, as her own preference", { expected: { url: ALICE_URL, source: "personal" }, actual: await saved(h, "alice") });

  // ---- the link opens in a new tab -------------------------------------------------------------
  await openMenu(alice, "Alice");
  state = await linkState(alice);
  t.check("alice: the menu shows the link, opening in a new tab with rel noopener noreferrer", {
    expected: { link: true, href: ALICE_URL, target: "_blank", rel: "noopener noreferrer", add: false }, actual: state,
  });
  await alice.shot("1-menu-link");
  const before = await pages(alice);
  const hrefBefore = await alice.evaluate("location.href");
  await alice.click({ role: "link", name: "Open staging site in a new tab" });
  let opened = null;
  for (let i = 0; i < 50 && !opened; i += 1) {
    opened = (await pages(alice)).find((p) => !before.some((b) => b.id === p.id)) || null;
    if (!opened) await sleep(100);
  }
  t.check("alice: a real click opens a new tab at the address and leaves her page where it was", {
    expected: { newTab: ALICE_URL, samePage: true }, actual: { newTab: opened ? opened.url : null, samePage: (await alice.evaluate("location.href")) === hrefBefore },
  });
  if (opened) { try { await fetch(`http://127.0.0.1:${alice.edge.port}/json/close/${opened.id}`); } catch { /* the harness closes the browser anyway */ } }

  // ---- edit ----------------------------------------------------------------------------------
  await openMenu(alice, "Alice");
  await alice.click({ role: "button", name: "Edit staging link" });
  await waitForEditor(alice);
  t.check("alice: Edit opens the editor with her address in it", { expected: ALICE_URL, actual: (await editorState(alice)).value });
  await alice.fill(FIELD, ALICE_EDIT);
  await alice.click({ role: "button", name: "Save", scope: ".modal" });
  await waitForEditorClosed(alice);
  t.check("alice: Save stores the edited address", { expected: { url: ALICE_EDIT, source: "personal" }, actual: await saved(h, "alice") });
  await openMenu(alice, "Alice");
  t.check("alice: the menu link now points at the edited address", { expected: ALICE_EDIT, actual: (await linkState(alice)).href });

  // ---- refused addresses -----------------------------------------------------------------------
  await alice.click({ role: "button", name: "Edit staging link" });
  await waitForEditor(alice);
  for (const bad of ["javascript:alert(1)", "http://staging.example.test", "https://0x7f.1/"]) {
    await alice.fill(FIELD, bad);
    await alice.press("Enter");
    const ed = await editorState(alice);
    t.check(`alice: ${bad} is refused inside the editor, which stays open with the field marked invalid`, {
      expected: { dialog: true, explained: true, invalid: "true" }, actual: { dialog: ed.dialog, explained: !!ed.error && ed.error.includes("https://"), invalid: ed.invalid },
    });
  }
  await alice.shot("2-editor-refused");
  await alice.press("Escape");
  t.check("alice: Escape closes the editor and nothing was saved", {
    expected: { dialog: false, url: ALICE_EDIT }, actual: { dialog: (await editorState(alice)).dialog, url: (await saved(h, "alice")).url },
  });
  for (const bad of ["javascript:alert(1)", "http://staging.example.test", "https://user:secret@staging.example.test", "https://%65vil.example", "http://127.0.0.1.evil.test"]) {
    const r = await h.api("alice").request("preferences", { method: "PUT", body: { stagingUrl: bad } });
    t.check(`server: saving ${bad} as the staging link is refused`, { expected: { status: 400, code: "invalid_url" }, actual: { status: r.status, code: r.code } });
  }

  // ---- Bob, in his own browser, has his own link --------------------------------------------------
  await bob.open("dashboard");
  await openMenu(bob, "Bob");
  let bobState = await linkState(bob);
  const bobSeesAlice = await bob.evaluate(`[...document.querySelectorAll('a')].some((a) => (a.getAttribute('href') || '').includes('preview.example.test')) || document.body.innerText.includes('preview.example.test')`);
  t.check("bob: his menu has no link of Alice's, only Add staging link…", { expected: { link: false, add: true, alicesAddress: false }, actual: { link: bobState.link, add: bobState.add, alicesAddress: bobSeesAlice } });
  await bob.click({ role: "button", name: "Add staging link…" });
  await waitForEditor(bob);
  await bob.fill(FIELD, BOB_URL);
  await bob.press("Enter");
  await waitForEditorClosed(bob);
  await openMenu(bob, "Bob");
  bobState = await linkState(bob);
  t.check("bob: his own link, in his own browser", { expected: BOB_URL, actual: bobState.href });
  await bob.shot("3-menu-own-link");
  t.check("the API keeps each person's link to themselves", {
    expected: { alice: ALICE_EDIT, bob: BOB_URL }, actual: { alice: (await saved(h, "alice")).url, bob: (await saved(h, "bob")).url },
  });

  // ---- clear -----------------------------------------------------------------------------------
  await alice.reload();
  await openMenu(alice, "Alice");
  t.check("alice: after a reload her menu has her own link, not Bob's", { expected: ALICE_EDIT, actual: (await linkState(alice)).href });
  await alice.click({ role: "button", name: "Edit staging link" });
  await waitForEditor(alice);
  await alice.click({ role: "button", name: "Remove link", scope: ".modal" });
  await waitForEditorClosed(alice);
  t.check("alice: Remove link clears her preference", { expected: { url: null, source: "default" }, actual: await saved(h, "alice") });
  await openMenu(alice, "Alice");
  state = await linkState(alice);
  t.check("alice: the menu offers Add staging link… again", { expected: { link: false, add: true }, actual: { link: state.link, add: state.add } });
  t.check("bob: still has his own link after Alice cleared hers", { expected: BOB_URL, actual: (await saved(h, "bob")).url });

  // ---- local http, accepted only because this dev server is the local environment (Terry, 2026-09-14)
  await alice.click({ role: "button", name: "Add staging link…" });
  await waitForEditor(alice);
  await alice.fill(FIELD, "http://example.com");
  await alice.press("Enter");
  let ed = await editorState(alice);
  t.check("alice (running locally): http to a public host is still refused inside the editor", { expected: { dialog: true, explained: true }, actual: { dialog: ed.dialog, explained: !!ed.error && ed.error.includes("http://") } });
  await alice.fill(FIELD, "http://127.0.0.1:4380");
  await alice.press("Enter");
  await waitForEditorClosed(alice);
  t.check("alice (running locally): an http://127.0.0.1 address is accepted and saved normalised", { expected: { url: LOCAL_URL, source: "personal" }, actual: await saved(h, "alice") });
  await openMenu(alice, "Alice");
  state = await linkState(alice);
  t.check("alice (running locally): the menu links to it in a new tab", { expected: { link: true, href: LOCAL_URL, target: "_blank", rel: "noopener noreferrer", add: false }, actual: state });
  await alice.shot("4-menu-local-http");
  const viaApi = await h.api("alice").request("preferences", { method: "PUT", body: { stagingUrl: "http://localhost:4380" } });
  t.check("server (local environment): http://localhost is accepted and normalised", { expected: { status: 200, url: "http://localhost:4380/" }, actual: { status: viaApi.status, url: viaApi.data ? viaApi.data.effective.stagingUrl : null } });

  // ---- the site default reaches members and site administrators, never an outsider (review 1) ----
  const siteBefore = (await h.api("dave").ok("site-settings")).settings;
  const lockedBefore = siteBefore.locked || [];
  await h.api("dave").ok("site-settings", { method: "PUT", body: { defaults: { stagingUrl: SITE_URL } } });
  t.check("carol (a workspace viewer with no link of her own) inherits the site default", { expected: { url: SITE_URL, source: "site" }, actual: await saved(h, "carol") });
  const { eve } = await h.browsers(["eve"], { prefix: "staging-" });
  await eve.open("dashboard");
  await openMenu(eve, "Eve");
  const eveState = await linkState(eve);
  const eveSees = await eve.evaluate(`[...document.querySelectorAll('a')].some((a) => (a.getAttribute('href') || '').includes('site-staging')) || document.body.innerText.includes('site-staging')`);
  t.check("eve (signed in, in no workspace): no site link in her menu or page, only Add staging link…", { expected: { link: false, add: true, sees: false }, actual: { link: eveState.link, add: eveState.add, sees: eveSees } });
  await eve.shot("5-menu-outsider");
  const eveApi = await Promise.all(["me", "site-settings", "preferences"].map((route) => h.api("eve").request(route)));
  t.check("eve: /api/me, /api/site-settings and /api/preferences carry no site staging address", {
    expected: [{ status: 200, leaks: false }, { status: 200, leaks: false }, { status: 200, leaks: false }], actual: eveApi.map((r) => ({ status: r.status, leaks: r.text.includes("site-staging") })),
  });

  // ---- locked by the site with no site link (review 2) ----------------------------------------------
  await h.api("dave").ok("site-settings", { method: "PUT", body: { defaults: { stagingUrl: null }, locked: [...lockedBefore.filter((k) => k !== "stagingUrl"), "stagingUrl"] } });
  await alice.reload();
  await openMenu(alice, "Alice");
  t.check("alice (locked, no site link): the menu says so and offers no Add or Edit", {
    expected: { note: "Staging link: set by the site (none)", link: false, add: false, edit: false }, actual: await lockState(alice),
  });
  await alice.shot("6-menu-locked-none");
  const refused = await h.api("alice").request("preferences", { method: "PUT", body: { stagingUrl: ALICE_URL } });
  t.check("alice (locked): saving an address is refused with 403", { expected: { status: 403, code: "forbidden" }, actual: { status: refused.status, code: refused.code } });
  await alice.goto("settings");
  t.check("alice (locked): My settings says 'Set by the site: none' and still lets her clear her saved address", {
    expected: { none: "Set by the site: none", clear: true },
    actual: await alice.evaluate(`(() => { const c = document.querySelector('section[aria-labelledby="set-staging"]'); const b = [...c.querySelectorAll('button')].find((x) => x.textContent === 'Clear my saved address'); return { none: c.querySelector('.staging__none').textContent, clear: !!b && !b.hidden }; })()`),
  });
  await alice.click({ role: "button", name: "Clear my saved address" });
  const afterClear = await h.api("alice").ok("preferences");
  t.check("alice (locked): clearing worked; the source stays locked with no address", {
    expected: { stored: false, source: "locked", url: null }, actual: { stored: Object.prototype.hasOwnProperty.call(afterClear.stored, "stagingUrl"), source: afterClear.sources.stagingUrl, url: afterClear.effective.stagingUrl },
  });
  await alice.shot("7-settings-locked-cleared");
  // Put the site back as it was for any later scenario.
  await h.api("dave").ok("site-settings", { method: "PUT", body: { locked: lockedBefore } });

  for (const [who, s] of [["alice", alice], ["bob", bob], ["eve", eve]]) {
    t.check(`${who}: no exceptions, console errors or failed requests in the browser`, { expected: [], actual: s.problems() });
  }
}
