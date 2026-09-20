// BT-013-15: the Design Gallery's per-design colour-customization presets. Every preset is checked
// directly against the real server-side contrast function (api/_shared/colors.js) — the exact same
// check the preferences API itself runs — never assumed from where the hex values were copied.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PRESETS, presetById, designDefaultEntry } from "../js/ui/gallery/colorschemes.js";
import { CONCEPTS } from "../../api/_shared/layouts.js";

const require = createRequire(import.meta.url);
const colors = require("../../api/_shared/colors.js");

describe("BT-013-15 Design Gallery colour-scheme presets", () => {
  test("every preset's light colour is >=3:1 against the real light surface, and its dark colour >=3:1 against the real dark surface", () => {
    for (const p of PRESETS) {
      assert.match(p.light, /^#[0-9a-f]{6}$/i, `${p.id} light`);
      assert.match(p.dark, /^#[0-9a-f]{6}$/i, `${p.id} dark`);
      assert.ok(colors.contrast(p.light, colors.SURFACES[0]) >= colors.MIN_CONTRAST, `${p.id} light ${p.light} against ${colors.SURFACES[0]}`);
      assert.ok(colors.contrast(p.dark, colors.SURFACES[1]) >= colors.MIN_CONTRAST, `${p.id} dark ${p.dark} against ${colors.SURFACES[1]}`);
    }
  });

  test("preset ids are unique, and at least most reuse a real, existing concept's own already-verified accent pair rather than an independently invented one", () => {
    assert.equal(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length);
    const reused = PRESETS.filter((p) => CONCEPTS.some((c) => c.accentLight === p.light && c.accentDark === p.dark));
    assert.ok(reused.length >= PRESETS.length - 1, "all but at most one preset reuses a real concept's own verified accent pair");
  });

  test("presetById finds a real preset by id and returns null for an unknown one", () => {
    assert.equal(presetById("navy").label, "Navy");
    assert.equal(presetById("not-a-real-preset"), null);
  });

  test("designDefaultEntry is pinned to the concept's OWN built-in colours and never collides with a real preset id", () => {
    const concept = CONCEPTS[0];
    const entry = designDefaultEntry(concept);
    assert.deepEqual([entry.light, entry.dark], [concept.accentLight, concept.accentDark]);
    assert.ok(!PRESETS.some((p) => p.id === entry.id), "the pinned default id is never a real preset id");
  });
});
