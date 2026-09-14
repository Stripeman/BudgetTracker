'use strict';
// Safe custom icons (BT-011-05). An uploaded icon is NEVER stored or rendered as SVG markup. It is
// parsed here with a strict allow-list and reduced to plain shape data ({type, attrs}) that the
// client draws element by element with createElementNS/setAttribute — so no script, style, link,
// entity or event handler can ever reach the page.
//
// Accepted: one <svg> root with viewBox="0 0 24 24" (a square width/height is accepted and
// ignored), containing only <path d>, <circle cx cy r>, <rect x y width height rx ry>,
// <line x1 y1 x2 y2> and <polyline points>/<polygon points> — optionally grouped in plain <g>
// without attributes. Presentation comes from the app (currentColor stroke), never from the file.
// Refused: anything else, including <script>, <style>, <foreignObject>, <use>, <image>, <a>,
// any href/xlink:href/on*/style/class/id attribute, <!DOCTYPE>, <!ENTITY>, CDATA, processing
// instructions, text content, and files over the size or shape limits.
const MAX_BYTES = 8 * 1024;
const MAX_SHAPES = 32;
const MAX_ATTR_LEN = 2000;

const SHAPES = Object.freeze({
  path: ['d'],
  circle: ['cx', 'cy', 'r'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'],
  polygon: ['points'],
});
// Attributes a shape cannot be drawn without (coordinates default to 0 in SVG).
const REQUIRED = Object.freeze({ path: ['d'], circle: ['r'], rect: ['width', 'height'], line: [], polyline: ['points'], polygon: ['points'] });
// Root attributes that are accepted and ignored (the app decides size and colour).
const ROOT_IGNORED = new Set(['xmlns', 'xmlns:xlink', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'viewBox', 'viewbox', 'version']);
const SHAPE_IGNORED = new Set(['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule']);

const NUMBER = /^-?(\d+(\.\d+)?|\.\d+)$/;
// Whitespace is limited to space, tab, CR and LF (no vertical tab, no-break or Unicode separators),
// and a path starts with a move command (security review SEC-I5).
const PATH_D = /^[ \t\r\n]*[Mm][MmLlHhVvCcSsQqTtAaZz0-9., \t\r\n+\-eE]*$/;
const POINTS = /^[0-9., \t\r\n+\-eE]+$/;

class IconError extends Error {
  constructor(message) { super(message); this.code = 'invalid_icon'; }
}
const fail = (message) => { throw new IconError(message); };

function parseAttrs(src, where) {
  const attrs = {};
  const re = /\s*([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/y;
  let pos = 0;
  const text = src.trim();
  while (pos < text.length) {
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) fail(`The icon has an attribute that cannot be read in <${where}>.`);
    const name = m[1];
    const value = m[3] !== undefined ? m[3] : m[4];
    if (/^on/i.test(name) || /href$/i.test(name) || (name.includes(':') && name !== 'xmlns:xlink')) fail(`The icon may not use the "${name}" attribute.`);
    if (value.length > MAX_ATTR_LEN) fail('The icon has an attribute that is too long.');
    if (/[<>&]/.test(value)) fail('The icon has characters that are not allowed.');
    if (Object.prototype.hasOwnProperty.call(attrs, name)) fail('The icon repeats an attribute.');
    attrs[name] = value;
    pos = re.lastIndex;
  }
  return attrs;
}

function validateValue(name, value) {
  if (name === 'd') { if (!PATH_D.test(value)) fail('The icon path contains commands that are not allowed.'); return value.trim(); }
  if (name === 'points') { if (!POINTS.test(value)) fail('The icon points are not valid.'); return value.trim(); }
  const v = value.trim();
  if (!NUMBER.test(v)) fail(`The icon value for ${name} is not a number.`);
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > 1000) fail(`The icon value for ${name} is out of range.`);
  return v;
}

// Dimensions: the drawing area is always 24 × 24. A width/height, if present, must describe a
// square between 16 and 1024 pixels (so a wide banner or a huge image is refused, not squashed).
function checkDimensions(attrs) {
  if (attrs.width === undefined && attrs.height === undefined) return;
  const size = (v) => {
    const m = /^(\d+(\.\d+)?)(px)?$/.exec(String(v || '').trim());
    return m ? Number(m[1]) : NaN;
  };
  const w = size(attrs.width);
  const h = size(attrs.height);
  if (!(w >= 16 && w <= 1024 && h === w)) fail('The icon must be square (the same width and height, 16 to 1024 pixels).');
}

// Returns { viewBox: '0 0 24 24', shapes: [{ type, attrs }] } or throws IconError.
function parseIconSvg(input) {
  if (typeof input !== 'string') fail('Upload an SVG file.');
  if (Buffer.byteLength(input, 'utf8') > MAX_BYTES) fail('The icon file is larger than 8 KB.');
  let text = input.replace(/^\uFEFF/, '').trim();
  // Only an optional XML declaration may precede the root.
  text = text.replace(/^<\?xml[^?]*\?>\s*/i, '');
  if (/<!|<\?/.test(text)) fail('The icon may not contain DOCTYPE, entities, CDATA, comments or processing instructions.');
  const root = /^<svg\b([^>]*)>([\s\S]*)<\/svg>$/i.exec(text);
  if (!root) fail('The file must be a single <svg> element.');
  const rootAttrs = parseAttrs(root[1], 'svg');
  for (const name of Object.keys(rootAttrs)) if (!ROOT_IGNORED.has(name)) fail(`The icon may not use the "${name}" attribute.`);
  const viewBox = (rootAttrs.viewBox || rootAttrs.viewbox || '').trim().replace(/\s+/g, ' ');
  if (viewBox !== '0 0 24 24') fail('The icon must use viewBox="0 0 24 24".');
  checkDimensions(rootAttrs);

  const shapes = [];
  const body = root[2];
  const tagRe = /<\s*(\/?)\s*([A-Za-z][A-Za-z0-9]*)\b([^>]*?)(\/?)\s*>/g;
  let last = 0;
  let depth = 0;
  let m;
  while ((m = tagRe.exec(body))) {
    if (body.slice(last, m.index).trim()) fail('The icon may not contain text.');
    last = tagRe.lastIndex;
    const [, closing, rawName, rawAttrs, selfClosing] = m;
    const name = rawName.toLowerCase();
    if (closing && (rawAttrs.trim() || selfClosing)) fail('Closing tags in the icon may not have attributes.');
    if (name === 'g') {
      if (closing) { depth -= 1; if (depth < 0) fail('The icon groups are not balanced.'); continue; }
      if (rawAttrs.trim()) fail('Groups in the icon may not have attributes.');
      if (!selfClosing) depth += 1;
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(SHAPES, name)) fail(`The icon may not contain <${name}>.`);
    if (closing) continue;
    const attrs = parseAttrs(rawAttrs.replace(/\/\s*$/, ''), name);
    const kept = {};
    for (const [attr, value] of Object.entries(attrs)) {
      if (SHAPES[name].includes(attr)) kept[attr] = validateValue(attr, value);
      else if (!SHAPE_IGNORED.has(attr)) fail(`The icon may not use the "${attr}" attribute on <${name}>.`);
    }
    for (const needed of REQUIRED[name]) if (!(needed in kept)) fail(`<${name}> in the icon needs "${needed}".`);
    shapes.push({ type: name, attrs: kept });
    if (shapes.length > MAX_SHAPES) fail(`The icon may have at most ${MAX_SHAPES} shapes.`);
  }
  if (body.slice(last).trim()) fail('The icon may not contain text.');
  if (depth !== 0) fail('The icon groups are not balanced.');
  if (!shapes.length) fail('The icon has no shapes.');
  return { viewBox: '0 0 24 24', shapes };
}

// Re-checks stored shape data before it is served (defence in depth: a stored document edited
// outside the application still cannot carry anything but the allowed shapes and values).
function isSafeShapes(shapes) {
  if (!Array.isArray(shapes) || !shapes.length || shapes.length > MAX_SHAPES) return false;
  try {
    for (const s of shapes) {
      if (!s || typeof s !== 'object' || !Object.prototype.hasOwnProperty.call(SHAPES, s.type) || !s.attrs || typeof s.attrs !== 'object') return false;
      for (const [k, v] of Object.entries(s.attrs)) {
        if (!SHAPES[s.type].includes(k) || typeof v !== 'string' || v.length > MAX_ATTR_LEN || /[<>&]/.test(v)) return false;
        validateValue(k, v);
      }
      for (const needed of REQUIRED[s.type]) if (!(needed in s.attrs)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

module.exports = { parseIconSvg, isSafeShapes, IconError, SHAPES, MAX_BYTES, MAX_SHAPES };
