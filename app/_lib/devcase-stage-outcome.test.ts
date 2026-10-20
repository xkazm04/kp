// The lifecycle run outcome as a closed, catalog-pinned vocabulary
// (challenge-r07 devcase-orchestration/B).
//
// The lifecycle row used to render the orchestrator's `detail` verbatim: an English
// sentence composed from integers the runner already held ("published; sourced 0
// candidate(s) before sourcing failed (...)"). A cs/de/fr recruiter read English, and
// the three states that need a human (held candidates, a crashed sourcing, a halt)
// were fragments of prose with no door to their fix. These cases pin the vocabulary,
// the tolerant reader, the warning -> action map and the legacy fallback.
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  OUTCOME_WARNING_CODES,
  STAGE_OUTCOME_CODES,
  isOutcomeWarningCode,
  isStageOutcomeCode,
  lifecycleDetailView,
  outcomeActions,
  outcomeMessageValues,
  parseStageOutcome,
} from "./devcase-stage-outcome.ts";

// app/_lib/ -> repo root is two levels up.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...rel: string[]) => readFileSync(path.join(ROOT, ...rel), "utf8");

test("1. vocabulary: literal arrays with guards; the reader drops an unknown warning instead of throwing", () => {
  assert.ok(Array.isArray(STAGE_OUTCOME_CODES) && STAGE_OUTCOME_CODES.length > 0);
  assert.ok(Array.isArray(OUTCOME_WARNING_CODES) && OUTCOME_WARNING_CODES.length > 0);
  assert.equal(isOutcomeWarningCode("held"), true);
  assert.equal(isOutcomeWarningCode("foo"), false);
  assert.equal(isStageOutcomeCode("promoted"), true);
  assert.equal(isStageOutcomeCode("held"), false, "a warning is not an outcome");

  const stored = JSON.stringify({
    code: "promoted",
    facts: { promoted: 1, topN: 3, floor: 55, bogus: "x" },
    warnings: [{ code: "held", count: 2 }, { code: "from_a_newer_runner", count: 1 }],
  });
  assert.deepEqual(parseStageOutcome(stored), {
    code: "promoted",
    facts: { promoted: 1, topN: 3, floor: 55 },
    warnings: [{ code: "held", count: 2 }],
  });
  // An object (a JSON column already parsed) reads the same as its string.
  assert.deepEqual(parseStageOutcome(JSON.parse(stored)), parseStageOutcome(stored));
  // What cannot be an outcome is null, never a throw.
  assert.equal(parseStageOutcome("{not json"), null);
  assert.equal(parseStageOutcome(null), null);
  assert.equal(parseStageOutcome({ code: "nope", facts: {}, warnings: [] }), null);
  assert.deepEqual(parseStageOutcome({ code: "halted" }), { code: "halted", facts: {}, warnings: [] });
});

test("5. actions: each actionable warning maps to a door that already exists; the rest explain", () => {
  assert.deepEqual(
    outcomeActions({ code: "promoted", facts: {}, warnings: [{ code: "held", count: 2 }] }, { caseId: "c1" }),
    [{ warning: "held", action: "open_decisions", href: "/?tab=decisions" }]
  );
  assert.deepEqual(
    outcomeActions({ code: "collecting_open", facts: {}, warnings: [{ code: "sourcing_failed", count: 1 }] }, { caseId: "c1" }),
    [{ warning: "sourcing_failed", action: "re_source" }]
  );
  assert.deepEqual(
    outcomeActions({ code: "collecting_open", facts: {}, warnings: [{ code: "sourcing_failed", count: 1 }] }, { caseId: null }),
    [],
    "Re-source needs a case to re-source"
  );
  assert.deepEqual(outcomeActions({ code: "halted", facts: {}, warnings: [] }, { caseId: "c1" }), [{ action: "resume" }]);
  assert.deepEqual(outcomeActions({ code: "canceled", facts: {}, warnings: [] }, { caseId: null }), [{ action: "resume" }]);
  for (const info of ["seed_skeleton_only", "scenario_template_only", "baseline_unavailable"] as const) {
    assert.deepEqual(
      outcomeActions({ code: "collecting_open", facts: {}, warnings: [{ code: info, count: 1 }] }, { caseId: "c1" }),
      [],
      `${info} is an explanation, not an action`
    );
  }
});

test("6. catalog parity: every outcome and warning code is labelled in all four locales", () => {
  for (const locale of ["en", "cs", "de", "fr"]) {
    const cat = JSON.parse(read("messages", `${locale}.json`)) as {
      devcase?: { lifecycle?: { outcome?: Record<string, unknown>; outcomeAction?: Record<string, unknown> } };
    };
    const outcome = cat.devcase?.lifecycle?.outcome ?? {};
    for (const code of [...STAGE_OUTCOME_CODES, ...OUTCOME_WARNING_CODES]) {
      assert.equal(typeof outcome[code], "string", `${locale}: devcase.lifecycle.outcome.${code} is missing`);
    }
    const actions = cat.devcase?.lifecycle?.outcomeAction ?? {};
    for (const key of ["open_decisions", "re_source", "resume", "resuming", "resumeFailed"]) {
      assert.equal(typeof actions[key], "string", `${locale}: devcase.lifecycle.outcomeAction.${key} is missing`);
    }
  }
  // Every ICU argument a message names is one the renderer always supplies: a missing
  // argument throws inside next-intl and blanks the row (the journey-board lesson).
  const en = JSON.parse(read("messages", "en.json")) as { devcase: { lifecycle: { outcome: Record<string, string> } } };
  const supplied = new Set([...Object.keys(outcomeMessageValues({ code: "promoted", facts: {}, warnings: [] })), "count"]);
  for (const [key, message] of Object.entries(en.devcase.lifecycle.outcome)) {
    for (const m of message.matchAll(/\{(\w+)/g)) {
      assert.ok(supplied.has(m[1]), `outcome.${key} names {${m[1]}}, which the renderer never supplies`);
    }
  }
});

test("7. legacy rows keep their prose; a coded outcome renders coded only at the stage it describes", () => {
  assert.deepEqual(lifecycleDetailView({ outcome: null, detail: "published; sourced 3" }), {
    kind: "prose",
    text: "published; sourced 3",
  });
  assert.deepEqual(lifecycleDetailView({ outcome: null, detail: null }), { kind: "none" });

  const promoted = { code: "promoted", facts: { promoted: 1, topN: 3, floor: 55 }, warnings: [{ code: "held", count: 1 }] };
  const coded = lifecycleDetailView({ stage: "promoted", outcome: promoted, detail: "promoted 1/3 (floor 55)" });
  assert.equal(coded.kind, "coded");
  if (coded.kind === "coded") {
    assert.equal(coded.code, "promoted");
    assert.deepEqual(coded.values, { sourced: 0, skipped: 0, evaluated: 0, failed: 0, promoted: 1, topN: 3, floor: 55 });
    assert.deepEqual(coded.warnings, [{ code: "held", count: 1 }]);
  }

  // A human closed (or approved, or redesigned) since the runner wrote it: the stored
  // outcome describes a stage the row has left, so the row keeps the human's prose.
  assert.deepEqual(lifecycleDetailView({ stage: "closed", outcome: promoted, detail: "closed by a human" }), {
    kind: "prose",
    text: "closed by a human",
  });
  const gate = { code: "routed_to_human", facts: {}, warnings: [] };
  assert.equal(lifecycleDetailView({ stage: "approved", outcome: gate, detail: "approved by a human" }).kind, "prose");
  assert.equal(lifecycleDetailView({ stage: "awaiting_approval", outcome: gate, detail: "x" }).kind, "coded");
  // A pre-migration row (no column value) and a corrupt one both fall back.
  assert.equal(lifecycleDetailView({ stage: "promoted", outcome: "{broken", detail: "legacy" }).kind, "prose");
});

test("the row renders through the view and the action map, never the raw detail", () => {
  // DevLifecycleRow.tsx is a client component (not importable here), so its wiring is
  // pinned by shape: the coded line + chips come from this module, and the English
  // detail is only the fallback branch and the hover title.
  const row = read("app", "features", "tools", "devcases", "DevLifecycleRow.tsx");
  assert.match(row, /lifecycleDetailView\(\{ stage: lc\.stage, outcome: lc\.outcome/);
  assert.match(row, /outcomeActions\(/);
  assert.match(row, /lifecycle\.outcome\.\$\{detailView\.code\}/);
  assert.match(row, /"\/api\/devcase\/control"[\s\S]{0,200}action: "reconcile"/, "Resume is the existing reconcile door");
  assert.doesNotMatch(row, /\{lc\.detail\}/, "the verbatim English line is gone");
});
