// BT-013-16 — app/js/core/layoutmeta.js must never drift from the server's own real layout list and
// each concept's accent colours (the same "client and server agree by test" pattern
// app/test/icons.test.js already uses for the icon catalogue's BUILT_IN ids).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { REAL_LAYOUTS, REAL_LAYOUT_IDS, layoutMeta } from "../js/core/layoutmeta.js";

const require = createRequire(import.meta.url);
const layouts = require("../../api/_shared/layouts.js");

describe("BT-013-16 layoutmeta: client mirrors the server's real layout list and accent colours exactly", () => {
  test("ids and order match api/_shared/layouts.js REAL_LAYOUT_OPTIONS", () => {
    assert.deepEqual(REAL_LAYOUT_IDS, layouts.REAL_LAYOUT_OPTIONS.map((o) => o.value));
  });

  test("each real layout's name matches the server's option label", () => {
    for (const opt of layouts.REAL_LAYOUT_OPTIONS) assert.equal(layoutMeta(opt.value).name, opt.label, opt.value);
  });

  test("each of the three flagship layouts' accent colours match its Gallery concept exactly; Classic has none", () => {
    for (const l of REAL_LAYOUTS) {
      if (l.id === "classic") { assert.equal(l.accentLight, null); assert.equal(l.accentDark, null); continue; }
      const concept = layouts.findConcept(l.id);
      assert.ok(concept, `${l.id} must still be a real Gallery concept`);
      assert.equal(l.accentLight, concept.accentLight, l.id);
      assert.equal(l.accentDark, concept.accentDark, l.id);
    }
  });

  test("layoutMeta falls back to Classic for an unknown id, never throws", () => {
    assert.equal(layoutMeta("not-a-real-layout").id, "classic");
    assert.equal(layoutMeta(undefined).id, "classic");
  });
});
