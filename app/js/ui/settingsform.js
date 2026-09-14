// ONE SETTINGS CARD for the workspace settings (Workspace page) and the group settings (Shared
// expenses), so both look and behave the same (UX/accessibility review of eefd115).
//
//  * Every setting from the server's one list, under collapsible group headings: the first group open,
//    each person's choice remembered in this browser (finding 2). Each control is at form width with the
//    first sentence of its explanation; the rest is behind a "More about this" button (aria-expanded).
//  * On/off and choices use the command picker (decision 11, BT-004-05); a number is a number field with
//    its unit (finding 5); a set of kinds is checkboxes, and a kind that needs another one is unticked
//    and unavailable while that one is off (finding 1).
//  * A sticky bar: Save settings, Undo changes, "You have unsaved changes" (finding 3), the saved status,
//    and failures in the error style; a refused setting is marked invalid (aria-invalid) and points at
//    the message (aria-describedby), and its group opens (finding 1).
//  * Someone who cannot change a setting reads it in a label-value list; who changes settings is said
//    once in the intro and only owner-only settings are marked (finding 6). The history — who, when, from,
//    to, why — is shown to everyone (decision 6).
// Edits are never thrown away by a refresh: while anything is unsaved, new data waits until Save or Undo.
import { el, mount, announce } from "./dom.js";
import { field, input, pickerSelect, button, badge, uid } from "./components.js";
import { messageFor } from "../core/errors.js";

// A setting's value in words: On/Off, the chosen option's label (also for a small number such as
// "Once a day"), a number with its unit, or the chosen kinds. An unknown value is shown as it is.
export function settingText(s, v) {
  if (s.type === "boolean") return v === true ? "On" : v === false ? "Off" : String(v);
  const labelOf = (x) => { const o = (s.options || []).find((y) => y.value === x); return o ? o.label : String(x); };
  if (s.type === "integer") return (s.options || []).length ? labelOf(v) : `${v}${s.unit ? ` ${s.unit}` : ""}`;
  if (s.type === "set") return Array.isArray(v) && v.length ? v.map(labelOf).join(", ") : "None";
  return labelOf(v);
}

// The first sentence of an explanation, and the rest.
export function splitExplanation(text) {
  const t = String(text || "").trim();
  const m = /^(.+?[.!?])\s+(\S[\s\S]*)$/.exec(t);
  return m ? [m[1], m[2]] : [t, ""];
}

// Which groups are open, remembered in this browser only; a browser that refuses storage simply
// forgets (private windows, full storage).
function readOpen(key) {
  try {
    const raw = globalThis.localStorage ? globalThis.localStorage.getItem(key) : null;
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}
function writeOpen(key, value) {
  try { if (globalThis.localStorage) globalThis.localStorage.setItem(key, JSON.stringify(value)); } catch { /* not remembered */ }
}

const SITE_OFF = "The site administrator has turned this off for the whole site, so it stays off here for now.";
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// `render(model)`: { settings: [{ key, group, type, label, explanation, value, options?, min?, max?,
//   unit?, requires?, requiresMessage?, canChange, changedBy?, offForSite?, groupNote? }], intro,
//   history: [{ when, by, text, reason }], makeExtras?(onChange) → [{ group, node, isDirty(), changes(),
//   reset() }], extrasSig? }. `onSave(changes, reason)` → { ok, error?, said? }.
export function createSettingsForm({ id, storageKey, onSave, onDirtyChange = () => {} }) {
  const element = el("div", { class: "settings" });
  let model = { settings: [], history: [] };
  let sig = "";
  let controls = [];
  let extras = [];
  let groups = [];
  let dirty = false;
  const refs = {};

  const isDirty = () => controls.some((c) => c.s.canChange && c.changed()) || extras.some((x) => x.isDirty());
  function refreshDirty() {
    const now = isDirty();
    if (refs.unsaved) refs.unsaved.hidden = !now;
    if (refs.undo) refs.undo.disabled = !now;
    if (now !== dirty) { dirty = now; onDirtyChange(now); }
  }

  function moreAbout(s, rest) {
    if (!rest) return [];
    const moreId = uid(`${id}-more`);
    const text = el("p", { class: "field__help setting__more", id: moreId, text: rest });
    text.hidden = true;
    const btn = el("button", { type: "button", class: "linklike", "aria-expanded": "false", "aria-controls": moreId, "aria-label": `More about this: ${s.label}`, text: "More about this" });
    btn.addEventListener("click", () => {
      const open = text.hidden;
      text.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.textContent = open ? "Less about this" : "More about this";
      btn.setAttribute("aria-label", `${open ? "Less" : "More"} about this: ${s.label}`);
    });
    return [btn, text];
  }

  const appendDescribed = (node, extraId) => {
    const now = (node.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    if (!now.includes(extraId)) node.setAttribute("aria-describedby", [...now, extraId].join(" "));
  };
  const removeDescribed = (node, extraId) => {
    const now = (node.getAttribute("aria-describedby") || "").split(/\s+/).filter((x) => x && x !== extraId);
    if (now.length) node.setAttribute("aria-describedby", now.join(" ")); else node.removeAttribute("aria-describedby");
  };
  const invalidOn = (node, errId) => { node.setAttribute("aria-invalid", "true"); node.setAttribute("aria-errormessage", errId); appendDescribed(node, errId); };
  const invalidOff = (node, errId) => { node.removeAttribute("aria-invalid"); node.removeAttribute("aria-errormessage"); if (errId) removeDescribed(node, errId); };

  // A read-only row: label and value, programmatically paired in a description list.
  function readOnlyRows(s) {
    const [first, rest] = splitExplanation(s.explanation);
    return [
      el("dt", { class: "settings-dl__label" }, [s.label, s.changedBy === "owner" ? badge("Owners only", "source") : null]),
      el("dd", { class: "settings-dl__value", text: settingText(s, s.value) }),
      el("dd", { class: "settings-dl__help" }, [
        el("span", { class: "field__help", text: first }),
        s.offForSite ? el("span", { class: "field__help", text: ` ${SITE_OFF}` }) : null,
        ...moreAbout(s, rest),
      ]),
    ];
  }

  function makeControl(s) {
    const [first, rest] = splitExplanation(s.explanation);
    const ownersOnly = s.changedBy === "owner";
    const badgeNode = ownersOnly ? badge("Owners only", "source") : null;
    if (badgeNode) badgeNode.id = uid(`${id}-owners`);
    const siteNote = s.offForSite ? el("p", { class: "field__help", text: SITE_OFF }) : null;
    let c;
    if (s.type === "set") {
      const helpId = uid(`${id}-help`);
      const boxes = (s.options || []).map((o) => { const box = el("input", { type: "checkbox", id: uid(`${id}-opt`) }); box.checked = Array.isArray(s.value) && s.value.includes(o.value); return [o, box]; });
      const boxOf = (v) => (boxes.find(([o]) => o.value === v) || [])[1];
      // A kind that needs another one is unticked and unavailable while that one is off.
      const applyRequires = () => {
        for (const [needs, needed] of Object.entries(s.requires || {})) {
          const a = boxOf(needs); const b = boxOf(needed);
          if (!a || !b) continue;
          if (!b.checked) a.checked = false;
          a.disabled = !b.checked;
        }
      };
      const fs = el("fieldset", { class: "plain-fieldset setting__set", "aria-describedby": helpId }, [
        el("legend", { class: "field__label", text: s.label }),
        ...boxes.map(([o, b]) => el("div", { class: "field--inline" }, [b, el("label", { for: b.id, text: o.label })])),
        el("p", { class: "field__help", id: helpId, text: first }),
      ]);
      if (badgeNode) appendDescribed(fs, badgeNode.id);
      const read = () => boxes.filter(([, b]) => b.checked).map(([o]) => o.value);
      c = {
        s, node: fs, read, focus: () => { const first = boxes.find(([, b]) => !b.disabled); if (first) first[1].focus(); },
        reset: () => { for (const [o, b] of boxes) b.checked = Array.isArray(s.value) && s.value.includes(o.value); applyRequires(); },
        validate: () => {
          const v = read();
          const broken = Object.entries(s.requires || {}).some(([a, b]) => v.includes(a) && !v.includes(b));
          return broken ? (s.requiresMessage || `“${s.label}”: choose one of the options shown.`) : null;
        },
        markInvalid: (errId) => { invalidOn(fs, errId); for (const [a] of Object.entries(s.requires || {})) { const box = boxOf(a); if (box && box.checked) invalidOn(box, errId); } },
        clearInvalid: (errId) => { invalidOff(fs, errId); for (const [, b] of boxes) invalidOff(b, errId); },
      };
      for (const [, b] of boxes) b.addEventListener("change", () => { applyRequires(); c.clearInvalid(refs.error && refs.error.id); refreshDirty(); });
      applyRequires();
    } else if (s.type === "integer" && !(s.options || []).length) {
      // A number field with its unit, like the due-soon days on a bill (bills.js).
      const inp = input({ type: "number", min: String(s.min), max: String(s.max), step: "1", inputmode: "numeric", id: uid(`${id}-num`), class: "field__input setting__number" });
      inp.value = String(s.value);
      const helpId = `${inp.id}-help`;
      inp.setAttribute("aria-describedby", helpId);
      if (badgeNode) appendDescribed(inp, badgeNode.id);
      const node = el("div", { class: "field" }, [
        el("label", { class: "field__label", for: inp.id, text: s.label }),
        el("div", { class: "input-with-unit" }, [inp, s.unit ? el("span", { class: "input-with-unit__unit", "aria-hidden": "true", text: s.unit }) : null]),
        el("p", { class: "field__help", id: helpId, text: first }),
      ]);
      const raw = () => String(inp.value).trim();
      c = {
        s, node, focus: () => inp.focus(),
        read: () => (/^\d+$/.test(raw()) ? Number(raw()) : raw()),
        reset: () => { inp.value = String(s.value); },
        validate: () => (/^\d+$/.test(raw()) && Number(raw()) >= s.min && Number(raw()) <= s.max ? null : `“${s.label}”: enter a whole number from ${s.min} to ${s.max}.`),
        markInvalid: (errId) => invalidOn(inp, errId), clearInvalid: (errId) => invalidOff(inp, errId),
      };
      inp.addEventListener("input", () => { c.clearInvalid(refs.error && refs.error.id); refreshDirty(); });
    } else {
      const options = s.type === "boolean" ? [{ value: "true", label: "On" }, { value: "false", label: "Off" }]
        : (s.options || []).map((o) => ({ value: String(o.value), label: o.label }));
      const pick = pickerSelect(options, String(s.value));
      const node = field(s.label, pick, { help: first });
      if (badgeNode) appendDescribed(pick, badgeNode.id);
      c = {
        s, node, focus: () => pick.focus(),
        read: () => (s.type === "boolean" ? pick.value === "true"
          : ((s.options || []).find((o) => String(o.value) === pick.value) || { value: s.value }).value),
        reset: () => { pick.value = String(s.value); },
        markInvalid: (errId) => invalidOn(pick, errId), clearInvalid: (errId) => invalidOff(pick, errId),
      };
      pick.addEventListener("change", () => { c.clearInvalid(refs.error && refs.error.id); refreshDirty(); });
    }
    c.changed = () => JSON.stringify(c.read()) !== JSON.stringify(s.value);
    c.wrapper = el("div", { class: "setting", dataset: { setting: s.key } }, [badgeNode, c.node, siteNote, ...moreAbout(s, rest)]);
    return c;
  }

  // The open/closed arrow is drawn by CSS from aria-expanded, so the button's name is the group's name.
  function setOpen(g, open, { remember = true } = {}) {
    g.body.hidden = !open;
    g.toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (remember) { const now = readOpen(storageKey); now[g.name] = open; writeOpen(storageKey, now); }
  }
  const groupOf = (c) => groups.find((g) => g.name === (c.s.group || "Settings"));

  function build() {
    const list = model.settings || [];
    const open = readOpen(storageKey);
    controls = [];
    extras = model.makeExtras ? model.makeExtras(() => refreshDirty()) : [];
    groups = [];
    const byName = (name) => {
      let g = groups.find((x) => x.name === name);
      if (!g) { g = { name, items: [], note: null }; groups.push(g); }
      return g;
    };
    for (const s of list) {
      const g = byName(s.group || "Settings");
      if (s.groupNote && !g.note) g.note = s.groupNote;
      if (s.canChange) { const c = makeControl(s); controls.push(c); g.items.push({ node: c.wrapper }); } else g.items.push({ readOnly: readOnlyRows(s) });
    }
    for (const x of extras) byName(x.group || "Settings").items.push({ node: x.node });
    groups.forEach((g, i) => {
      const bodyId = uid(`${id}-group`);
      const nodes = [];
      let dl = null;
      for (const item of g.items) {
        if (item.readOnly) { if (!dl) { dl = el("dl", { class: "settings-dl" }); nodes.push(dl); } for (const n of item.readOnly) dl.appendChild(n); } else { dl = null; nodes.push(item.node); }
      }
      g.toggle = el("button", { type: "button", class: "settings-group__toggle", "aria-controls": bodyId, text: g.name });
      g.body = el("div", { class: "settings-group__body", id: bodyId }, [g.note ? el("p", { class: "notice", text: g.note }) : null, ...nodes]);
      g.node = el("section", { class: "settings-group" }, [el("h3", { class: "settings-group__title" }, [g.toggle]), g.body]);
      setOpen(g, own(open, g.name) ? open[g.name] === true : i === 0, { remember: false });
      g.toggle.addEventListener("click", () => setOpen(g, g.body.hidden));
    });

    const changeable = controls.length > 0 || extras.length > 0;
    for (const k of Object.keys(refs)) delete refs[k];
    let tail = [];
    if (changeable) {
      refs.reason = input({ maxlength: "200", placeholder: "Optional", autocomplete: "off" });
      refs.save = button("Save settings", () => void save(), { variant: "primary" });
      refs.undo = button("Undo changes", undo);
      refs.undo.disabled = true;
      refs.unsaved = el("p", { class: "settings-bar__unsaved", text: "You have unsaved changes." });
      refs.unsaved.hidden = true;
      refs.status = el("p", { class: "field__help", role: "status" });
      refs.error = el("p", { class: "error-text", role: "alert", id: uid(`${id}-error`) });
      refs.error.hidden = true;
      tail = [
        el("div", { class: "setting" }, [field("Reason for the change (optional)", refs.reason, { help: "Kept with the change in the history below." })]),
        el("div", { class: "settings-bar" }, [refs.unsaved, el("div", { class: "row" }, [refs.save, refs.undo]), refs.status, refs.error]),
      ];
    }
    const history = model.history || [];
    const historyNode = history.length ? el("details", { class: "more" }, [
      el("summary", { text: `Changes (${history.length})` }),
      el("ul", { class: "history-list" }, history.slice().reverse().map((h) => el("li", {}, [
        el("div", { class: "muted small", text: `${h.when} · ${h.by}` }),
        el("div", { text: h.text }),
        h.reason ? el("div", { class: "muted small", text: `Reason: ${h.reason}` }) : null,
      ]))),
    ]) : el("p", { class: "muted small", text: "No changes yet." });
    mount(element,
      model.intro ? el("p", { class: "field__help settings__intro", text: model.intro }) : null,
      list.length ? null : el("p", { class: "muted", text: "There are no settings to show." }),
      ...groups.map((g) => g.node), ...tail, historyNode);
    dirty = false;
  }

  function clearErrors() {
    if (!refs.error) return;
    for (const c of controls) c.clearInvalid(refs.error.id);
    refs.error.textContent = "";
    refs.error.hidden = true;
  }
  function showError(message, c) {
    refs.error.textContent = message;
    refs.error.hidden = false;
    if (c) {
      const g = groupOf(c);
      if (g && g.body.hidden) setOpen(g, true);
      c.markInvalid(refs.error.id);
      c.focus();
    }
  }

  async function save() {
    clearErrors();
    refs.status.textContent = "";
    for (const c of controls) {
      const problem = c.changed() && c.validate ? c.validate() : null;
      if (problem) { showError(problem, c); return; }
    }
    const changes = Object.fromEntries(controls.filter((c) => c.changed()).map((c) => [c.s.key, c.read()]));
    for (const x of extras) Object.assign(changes, x.changes());
    if (!Object.keys(changes).length) { refs.status.textContent = "Nothing changed."; announce("Nothing changed."); return; }
    refs.save.disabled = true;
    const out = await onSave(changes, refs.reason.value.trim());
    refs.save.disabled = false;
    if (!out || !out.ok) {
      const key = out && out.error && out.error.details && out.error.details.setting;
      showError(messageFor(out && out.error), controls.find((c) => c.s.key === key));
      return;
    }
    // Saved: the card is drawn again from what the server now holds (kept in `model` meanwhile).
    sig = JSON.stringify(signature(model));
    build();
    onDirtyChange(false);
    refs.status.textContent = out.said;
    announce(out.said);
    refs.save.focus();
  }

  function undo() {
    for (const c of controls) c.reset();
    for (const x of extras) x.reset();
    clearErrors();
    if (refs.save) refs.save.focus();
    refreshDirty();
    refs.status.textContent = "Changes undone.";
    announce("Changes undone.");
  }

  const signature = (m) => [m.settings, m.history, m.intro, m.extrasSig || null];
  function render(next) {
    model = next;
    // Nothing unsaved is ever thrown away by new data; it is used after Save or Undo.
    if (dirty) return;
    const s = JSON.stringify(signature(next));
    if (s === sig) return;
    sig = s;
    build();
  }

  function focusSetting(key) {
    const c = controls.find((x) => x.s.key === key);
    if (!c) return false;
    const g = groupOf(c);
    if (g && g.body.hidden) setOpen(g, true);
    c.focus();
    if (c.wrapper.scrollIntoView) c.wrapper.scrollIntoView({ block: "center" });
    return true;
  }

  return { element, render, focusSetting, isDirty: () => dirty, undo, destroy: () => { if (dirty) { dirty = false; onDirtyChange(false); } } };
}
