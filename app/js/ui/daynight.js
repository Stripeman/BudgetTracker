// THE APPEARANCE CONTROL, AS A DAY/NIGHT (SUN/MOON) SWITCH — BT-011-01.
//
// Faithful port of TaskTracker app/js/ui/daynight.js (T: main a1ec150, introduced in a3389c2,
// RF-20260909-25). Same DOM structure, classes, ARIA, copy, device mapping and refusal-with-an-
// explanation; see docs/TASKTRACKER_REUSE.md. The one BudgetTracker adaptation is `locked`: the
// brief requires site settings that personal preferences cannot override, so a site-locked mode is
// shown, explained in words, and cannot be changed.
//
// IT IS ONE STATE MODEL, NOT TWO. This control owns nothing. `theme.getMode()` is the single answer
// to "what did this person choose" and `theme.setMode()` the only way it changes:
//
//   Use device setting, ticked   ->  mode === "system"
//   Use device setting, cleared  ->  mode is whatever the switch shows, "light" or "dark"
//
// Clearing the checkbox lands on the mode the device was already resolving to, so the screen does
// not change at the moment somebody takes control of it.
//
// `role="switch"` with `aria-checked`: one control, two states, and the state is the value. It is a
// real <button>, so Enter and Space work and it takes focus. The picture (sun, moon, stars, cloud)
// is aria-hidden decoration; the accessible name is words.
//
// While the device is deciding, the switch stays VISIBLE and shows what the device resolves to,
// refuses the press (aria-disabled rather than disabled, so the press arrives and the note already
// explains it) and says why in words.

import { el, svgEl } from "./dom.js";

let counter = 0;

/**
 * @param {object} options
 * @param {object} options.theme     the canonical controller: getMode/setMode/getResolvedMode
 * @param {(mode: string) => void} [options.onChange]  called with the new canonical mode
 * @param {boolean} [options.locked] the site administrator has locked the appearance mode
 * @returns {{ element: Node, refresh: () => void, setLocked: (locked: boolean) => void }}
 */
export function createDayNightControl({ theme, onChange = () => {}, locked = false } = {}) {
  if (!theme) throw new Error("createDayNightControl needs the theme controller.");
  const id = `daynight-${++counter}`;
  let isLocked = !!locked;

  const sky = () => {
    const svg = svgEl("svg", { class: "daynight__sky", viewBox: "0 0 64 28", "aria-hidden": "true", focusable: "false" });
    // Night: a few stars, placed rather than random so the control looks the same every render.
    for (const [cx, cy, r] of [[12, 8, 1], [20, 15, 0.8], [9, 18, 0.8], [26, 6, 0.9]]) {
      svg.appendChild(svgEl("circle", { class: "daynight__star", cx, cy, r }));
    }
    // Day: one soft cloud from overlapping circles.
    for (const [cx, cy, r] of [[44, 18, 5], [51, 18, 4], [47, 14, 4.5]]) {
      svg.appendChild(svgEl("circle", { class: "daynight__cloud", cx, cy, r }));
    }
    return svg;
  };

  // The knob carries both marks; the stylesheet shows whichever the state calls for, so switching
  // is a cross-fade rather than a rebuild.
  const knob = el("span", { class: "daynight__knob", "aria-hidden": "true" }, [
    (() => {
      const s = svgEl("svg", { class: "daynight__sun", viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" });
      s.appendChild(svgEl("circle", { cx: 12, cy: 12, r: 5 }));
      for (let i = 0; i < 8; i += 1) {
        const a = (Math.PI / 4) * i;
        s.appendChild(svgEl("line", {
          x1: (12 + Math.cos(a) * 7.5).toFixed(2), y1: (12 + Math.sin(a) * 7.5).toFixed(2),
          x2: (12 + Math.cos(a) * 9.5).toFixed(2), y2: (12 + Math.sin(a) * 9.5).toFixed(2),
        }));
      }
      return s;
    })(),
    (() => {
      const s = svgEl("svg", { class: "daynight__moon", viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" });
      s.appendChild(svgEl("path", { d: "M15.5 3.5a9 9 0 1 0 5 16 7.2 7.2 0 0 1-5-16z" }));
      return s;
    })(),
  ]);

  const switchEl = el("button", { type: "button", class: "daynight__switch", role: "switch", id: `${id}-switch` }, [sky(), knob]);
  const box = el("input", { type: "checkbox", id: `${id}-system`, class: "daynight__device" });
  const boxLabel = el("label", { class: "daynight__devicelabel", for: `${id}-system`, text: "Use device setting" });
  const note = el("p", { class: "daynight__note", id: `${id}-note` });

  const element = el("div", { class: "daynight" }, [
    el("div", { class: "daynight__row" }, [box, boxLabel]),
    el("div", { class: "daynight__row daynight__row--switch" }, [
      el("span", { class: "daynight__end daynight__end--day", "aria-hidden": "true", text: "Light" }),
      switchEl,
      el("span", { class: "daynight__end daynight__end--night", "aria-hidden": "true", text: "Dark" }),
    ]),
    note,
  ]);

  /** Draws whatever `theme` currently says. The control never holds its own copy of the answer. */
  function refresh() {
    const mode = theme.getMode();
    const following = mode === "system";
    const shown = following ? theme.getResolvedMode() : mode;
    const dark = shown === "dark";

    box.checked = following;
    box.disabled = isLocked;
    switchEl.setAttribute("aria-checked", dark ? "true" : "false");
    // Named by what it IS now, not a bare word whose tense a screen-reader user must guess.
    switchEl.setAttribute("aria-label", `Appearance: ${dark ? "Dark" : "Light"}`);
    switchEl.setAttribute("aria-describedby", `${id}-note`);
    element.classList.toggle("daynight--dark", dark);
    element.classList.toggle("daynight--following", following);
    element.classList.toggle("daynight--locked", isLocked);

    if (isLocked) {
      switchEl.setAttribute("aria-disabled", "true");
      note.textContent = "Appearance is set by your site administrator.";
    } else if (following) {
      switchEl.setAttribute("aria-disabled", "true");
      note.textContent = `Your device is currently asking for ${dark ? "dark" : "light"}. Clear the box above to choose for yourself.`;
    } else {
      switchEl.removeAttribute("aria-disabled");
      note.textContent = "";
    }
  }

  function apply(mode) {
    theme.setMode(mode);
    refresh();
    try { onChange(mode); } catch (e) { /* a listener must never break the control */ }
  }

  switchEl.addEventListener("click", () => {
    if (isLocked || theme.getMode() === "system") return;
    apply(theme.getMode() === "dark" ? "light" : "dark");
  });

  box.addEventListener("change", () => {
    if (isLocked) { refresh(); return; }
    apply(box.checked ? "system" : theme.getResolvedMode());
  });

  refresh();
  return { element, refresh, setLocked(value) { isLocked = !!value; refresh(); } };
}
