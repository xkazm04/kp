// The GitHub deep review is the app's ONLY TS-direct Gemini call: every other LLM
// call meters through Python, where pipeline/jobfit/llm/base.py's MTOK_PRICES is the
// price book of record. usage.ts therefore carries a hand-copied price pair whose
// stated purpose is to stamp the SAME cost_usd on its llm_usage row as the Python
// adapters do — and a hand-copied constant with no test drifted (output 7.5 vs the
// record's 7.00, ~7% of every github_analysis row's output cost, silently
// disagreeing with the rest of the ledger).
//
// Both files are read as TEXT (the rate-limit contract test's approach): importing
// usage.ts would pull in better-sqlite3 and the LightTrack client, and base.py is
// Python. That keeps this a pure, dependency-free drift guard.
//
// Runner: node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");

test("the TS Gemini price pair matches the Python price book of record", () => {
  const ts = read("./usage.ts");
  const py = read("../../../pipeline/jobfit/llm/base.py");

  const model = /export const GEMINI_MODEL = "([^"]+)";/.exec(ts)?.[1];
  assert.ok(model, "usage.ts must name the model it prices");

  const tsIn = Number(/const GEMINI_MTOK_PRICE_IN_USD = ([\d.]+);/.exec(ts)?.[1]);
  const tsOut = Number(/const GEMINI_MTOK_PRICE_OUT_USD = ([\d.]+);/.exec(ts)?.[1]);
  assert.ok(Number.isFinite(tsIn) && Number.isFinite(tsOut), "usage.ts must pin both prices");

  // The MTOK_PRICES row for exactly this model id.
  const row = new RegExp(`"${model.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}":\\s*\\(([\\d.]+),\\s*([\\d.]+)\\)`).exec(py);
  assert.ok(row, `pipeline/jobfit/llm/base.py must price ${model} (it is the price book of record)`);

  assert.equal(tsIn, Number(row[1]), `${model} input price drifted from base.py`);
  assert.equal(tsOut, Number(row[2]), `${model} output price drifted from base.py`);
});
