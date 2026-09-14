// BT-004-05 — WHERE A PICKER'S PANEL GOES ON A SHORT SCREEN (accessibility review of be25017,
// finding 1, WCAG 1.4.10 Reflow and 1.4.4 Resize text). At 400 % zoom a 1280 × 1024 screen is a
// 320 × 256 CSS-pixel viewport: TaskTracker's placement capped the panel to the larger side (about
// 100 px), and the search row and key hints left the list 15 px tall — no option was readable.
// `computePlacement` (app/js/core/popover.js) is pure, so every case is checked with hand-worked
// numbers; the real layout is checked in headless Edge.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computePlacement, POPOVER_MARGIN, POPOVER_GAP } from "../js/core/popover.js";

const SHORT = { width: 320, height: 256 };
// A trigger in the middle of a dialog on that screen.
const MID = { top: 110, bottom: 150, left: 12, right: 308 };

describe("BT-004-05 a panel on a short screen stays usable (a11y review finding 1)", () => {
  test("the margin and gap the hand-worked numbers use", () => {
    assert.equal(POPOVER_MARGIN, 8);
    assert.equal(POPOVER_GAP, 4);
  });

  test("when neither side has room for its useful minimum, the panel spans the viewport height", () => {
    // below = 256 - 150 - 4 - 8 = 94; above = 110 - 4 - 8 = 98; both are under 141 (the search row
    // and about two and a half rows). It spans: 256 - 2 × 8 = 240 high, centred on the trigger
    // (130 - 120 = 10) and then pulled up so its bottom stays 8 px inside (256 - 8 - 240 = 8).
    const at = computePlacement({ anchor: MID, panel: { width: 296, height: 330 }, viewport: SHORT, minUseful: 141 });
    assert.deepEqual(at, { top: 8, left: 12, maxHeight: 240, placement: "span" });
  });

  test("a short list that fits on neither side spans at its own height, centred on the trigger", () => {
    // min(141, 120) = 120 is more than either side (98), so it spans; 120 high, top 130 - 60 = 70.
    const at = computePlacement({ anchor: MID, panel: { width: 296, height: 120 }, viewport: SHORT, minUseful: 141 });
    assert.deepEqual(at, { top: 70, left: 12, maxHeight: 120, placement: "span" });
  });

  test("a side with room for the useful minimum is kept: capped there, not spanned (the desktop look)", () => {
    // 1280 × 900, trigger at 500–536: below = 900 - 536 - 12 = 352, above = 500 - 12 = 488. A 600 px
    // panel fits neither, 181 fits both, so it goes above (more room), capped at 488, top 8.
    const at = computePlacement({ anchor: { top: 500, bottom: 536, left: 40, right: 240 }, panel: { width: 352, height: 600 }, viewport: { width: 1280, height: 900 }, minUseful: 181 });
    assert.deepEqual(at, { top: 8, left: 40, maxHeight: 488, placement: "above" });
  });

  test("without minUseful TaskTracker's rules are unchanged (the cramped side placement the review found)", () => {
    // above = 98 is the larger side; room = max(96, 98) = 98; top = max(8, 110 - 4 - 98) = 8.
    const at = computePlacement({ anchor: MID, panel: { width: 296, height: 330 }, viewport: SHORT });
    assert.deepEqual(at, { top: 8, left: 12, maxHeight: 98, placement: "above" });
  });
});
