// The analyze progress vocabulary is TWO vocabularies that a comment says are
// deliberately different, and nothing checked either half.
//
// The Python pipeline emits its own INTERNAL stages through `_emit(progress, …)`
// (extract → gemini → profile → scoring → salary → insights), which reach a stream
// consumer as `{"type": "stage", "stage": …}` (pipeline/jobfit/cli.py). The TypeScript
// side deliberately does NOT mirror them: `runAnalyze` spawns the CLI WITHOUT --stream,
// so those events are never observed here, and the strip used to animate all six on a
// fixed 1800 ms cosmetic timer that had nothing to do with server state. ANALYZE_PHASE
// is therefore the three phases the TS side can genuinely SEE — the honest replacement.
//
// A deliberate divergence that only a comment records is a divergence that quietly
// becomes an accident. Two ways it rots, and this file is the guard for both:
//
//   • Someone "fixes the drift" by renaming a TS phase to a Python stage name (the
//     obvious-looking cleanup), and the strip starts claiming knowledge of an LLM
//     internal the server never receives.
//   • The Python side renames or adds a stage and nobody notices that the mapping this
//     file documents was written against a vocabulary that no longer exists.
//
// A SOURCE scan by construction: the property is about what two source files declare,
// and the Python half cannot be imported from node:test.
// Run: node scripts/run-unit-tests.mjs "app/_lib/analyze-phases.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ANALYZE_PHASE, ANALYZE_PHASE_ORDER, asAnalyzePhase } from "./analyze-phases.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

// This checkout is CRLF on Windows while the worktree may be LF; normalize before any
// anchored match, or the same regex passes in one tree and fails in the other.
const read = (rel: string) => readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");

/** The stage tokens `analyze_cv` actually emits, read out of the pipeline source. */
function pythonStages(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/_emit\(progress,\s*"([a-z_]+)"/g)) out.add(m[1]);
  return [...out];
}

// The Python vocabulary as of this file: six INTERNAL stages of one LLM analysis.
const EXPECTED_PYTHON_STAGES = ["extract", "gemini", "profile", "scoring", "salary", "insights"];

test("the Python pipeline still emits exactly the stage vocabulary this mapping was written against", () => {
  const stages = pythonStages(read("pipeline/jobfit/pipeline.py")).sort();
  assert.deepEqual(
    stages,
    [...EXPECTED_PYTHON_STAGES].sort(),
    "analyze_cv's _emit stages changed. That is allowed — but the TS mapping below is " +
      "documented against THIS list, so update the list and re-read whether any new stage " +
      "is something the TypeScript side can now actually observe."
  );
  // Non-vacuity: the scan really did find them in the source, not in an empty file.
  assert.ok(stages.length >= 6);
});

test("the TS phases are the OBSERVABLE three, and are deliberately disjoint from the Python stages", () => {
  assert.deepEqual(ANALYZE_PHASE_ORDER, ["reading", "analyzing", "saving"]);
  assert.deepEqual(Object.values(ANALYZE_PHASE).sort(), ["analyzing", "reading", "saving"]);
  // THE MAPPING, stated once so a reader does not have to reconstruct it:
  //   reading   — before the spawn: the CV bytes are read off disk (TS-side work).
  //   analyzing — the whole spawned run, i.e. ALL SIX Python stages collapsed into one
  //               opaque span, because runAnalyze does not pass --stream and therefore
  //               receives no stage events at all. The client shows indeterminate
  //               progress plus a ticking elapsed clock here — the honest rendering of
  //               "something is running and we cannot see inside it".
  //   saving    — after the spawn: persisting the delivered result (TS-side work).
  // So the two vocabularies must not overlap: a shared token would mean the TS strip is
  // claiming to report a Python internal it never receives.
  const python = new Set(pythonStages(read("pipeline/jobfit/pipeline.py")));
  for (const phase of ANALYZE_PHASE_ORDER) {
    assert.ok(!python.has(phase), `"${phase}" is BOTH a TS phase and a Python stage — the two vocabularies are deliberately separate`);
  }
});

test("analyze-run emits every declared phase, and only through ANALYZE_PHASE", () => {
  const runSrc = read("app/_lib/analyze-run.ts");
  for (const phase of ANALYZE_PHASE_ORDER) {
    assert.match(
      runSrc,
      new RegExp(`ANALYZE_PHASE\\.${phase}\\b`),
      `${phase} is declared but never emitted — a phase the client can render and the server never sends`
    );
  }
  // The spawn stays unstreamed: that is WHY the six Python stages are unobservable here.
  // If --stream ever appears, this mapping needs rewriting, not extending.
  assert.doesNotMatch(runSrc, /"--stream"/, "runAnalyze does not stream; the Python stages are not observable from this side");
  // No raw token may be handed to onProgress — the constant is the single source of
  // truth precisely so the server and client cannot disagree on a spelling.
  const rawTokens = runSrc.match(/onProgress\?\.\([^)]*"(reading|analyzing|saving)"/g);
  assert.equal(rawTokens, null, `a phase was emitted as a bare string: ${rawTokens?.join(", ")}`);
});

test("asAnalyzePhase narrows exactly the declared phases and rejects a Python stage", () => {
  for (const phase of ANALYZE_PHASE_ORDER) assert.equal(asAnalyzePhase(phase), phase);
  // A Python stage token arriving in a task's progress msg is NOT a phase: it would
  // otherwise be rendered as a strip row the TS side never emits.
  for (const stage of EXPECTED_PYTHON_STAGES) assert.equal(asAnalyzePhase(stage), null);
  assert.equal(asAnalyzePhase(null), null);
  assert.equal(asAnalyzePhase(undefined), null);
  assert.equal(asAnalyzePhase(""), null);
});
