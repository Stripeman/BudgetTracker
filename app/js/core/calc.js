// Inline calculator for amount fields (brief: "an inline calculator"). DOM-free and exact:
// numbers are parsed into scaled BigInt, + and - are exact, * and / are computed at 12 decimal
// places and the result is rounded half-to-even to the currency's precision. The person sees the
// computed amount before saving; the server validates it again.

const TOKEN = /\s*(\d+(?:\.\d+)?|[-+*/()])/y;

function toScaled(text, scale) {
  const [w, f = ""] = text.split(".");
  return BigInt(w + f.padEnd(scale, "0").slice(0, scale));
}

function roundHalfEven(n, d) {
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  let q = an / ad;
  const r = an % ad;
  if (r * 2n > ad || (r * 2n === ad && q % 2n === 1n)) q += 1n;
  return neg ? -q : q;
}

// Returns a decimal string with `precision` places, or null if the input is not an expression.
export function evaluateAmount(input, precision = 2) {
  const text = String(input || "").trim();
  if (!text || text.length > 120) return null;
  const SCALE = 12;
  const ONE = 10n ** BigInt(SCALE);
  const tokens = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < text.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(text);
    if (!m) return null;
    tokens.push(m[1]);
    pos = TOKEN.lastIndex;
    while (pos < text.length && text[pos] === " ") pos += 1;
  }
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  function factor() {
    const t = next();
    if (t === "-") { const v = factor(); return v === null ? null : -v; }
    if (t === "(") { const v = expr(); if (next() !== ")") return null; return v; }
    if (t && /^\d/.test(t)) return toScaled(t, SCALE);
    return null;
  }
  function term() {
    let v = factor();
    while (v !== null && (peek() === "*" || peek() === "/")) {
      const op = next();
      const r = factor();
      if (r === null) return null;
      if (op === "*") v = roundHalfEven(v * r, ONE);
      else { if (r === 0n) return null; v = roundHalfEven(v * ONE, r); }
    }
    return v;
  }
  function expr() {
    let v = term();
    while (v !== null && (peek() === "+" || peek() === "-")) {
      const op = next();
      const r = term();
      if (r === null) return null;
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  const value = expr();
  if (value === null || i !== tokens.length) return null;
  const minor = roundHalfEven(value, 10n ** BigInt(SCALE - precision));
  const neg = minor < 0n;
  const digits = (neg ? -minor : minor).toString().padStart(precision + 1, "0");
  const whole = precision ? digits.slice(0, -precision) : digits;
  const out = precision ? `${whole}.${digits.slice(-precision)}` : whole;
  return neg && minor !== 0n ? `-${out}` : out;
}

export function isPlainAmount(input) {
  return /^\d+(\.\d+)?$/.test(String(input || "").trim());
}
