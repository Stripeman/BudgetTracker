'use strict';
// ONE list of characters that hide, disguise or reorder text, shared by the rich-text validator
// (api/_shared/richtext.js) and the repository's raw-character rule (scripts/validate.cjs rule 9)
// (security retest SEC-T6). Unicode default-ignorable and direction-control characters:
// soft hyphen, combining grapheme joiner, Arabic letter mark, Hangul fillers, Khmer inherent vowels,
// the Mongolian vowel separator, zero-width space, left-to-right and right-to-left marks, line and
// paragraph separators, bidirectional embeddings and overrides, invisible operators and isolates,
// the byte-order mark, interlinear annotation and object replacement controls, and tag characters.
//
// Deliberately ALLOWED: zero-width non-joiner and joiner (U+200C, U+200D), which Persian and other
// scripts and emoji sequences need, and variation selectors (U+FE00-FE0F), which emoji use.
// Control characters are left to each caller (rich text refuses all; the repository allows tab and
// line breaks). Listed as code points so this source stays plain text.
const INVISIBLE_RANGES = Object.freeze([
  [0x00ad, 0x00ad], [0x034f, 0x034f], [0x061c, 0x061c], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180e, 0x180e],
  [0x200b, 0x200b], [0x200e, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0x3164, 0x3164],
  [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff0, 0xfffb], [0xe0000, 0xe007f],
]);

const inRanges = (c, ranges) => ranges.some(([a, b]) => c >= a && c <= b);

// The first refused code point in `text` (from the shared list or the caller's `extra` ranges), or null.
function firstForbidden(text, extra = []) {
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (inRanges(c, INVISIBLE_RANGES) || inRanges(c, extra)) return c;
  }
  return null;
}

module.exports = { INVISIBLE_RANGES, firstForbidden };
