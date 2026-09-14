// PASS / FAIL / SKIP lines with expected and actual values, one per check, and a summary.
import { isDeepStrictEqual, inspect } from "node:util";

const show = (v) => {
  const text = typeof v === "string" ? JSON.stringify(v) : inspect(v, { depth: 6, breakLength: Infinity, compact: true });
  return text.length > 600 ? `${text.slice(0, 600)}...` : text;
};

export function createReport({ log = console.log } = {}) {
  const results = [];
  let current = "setup";
  return {
    results,
    scenario(name) { current = name; },
    // `pass` overrides the deep-equality comparison when the rule is not plain equality.
    check(name, { expected, actual, pass } = {}) {
      const ok = pass === undefined ? isDeepStrictEqual(actual, expected) : !!pass;
      results.push({ scenario: current, name, status: ok ? "PASS" : "FAIL", expected, actual });
      log(`  ${ok ? "PASS" : "FAIL"} [${current}] ${name}`);
      log(`         expected: ${show(expected)}`);
      log(`         actual:   ${show(actual)}`);
      return ok;
    },
    skip(name, reason) {
      results.push({ scenario: current, name, status: "SKIP", reason });
      log(`  SKIP [${current}] ${name}: ${reason}`);
    },
    note(text) { log(`       ${text}`); },
    counts() {
      const count = (s) => results.filter((r) => r.status === s).length;
      return { pass: count("PASS"), fail: count("FAIL"), skip: count("SKIP") };
    },
  };
}
