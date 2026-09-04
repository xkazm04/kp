// The timebox is POLICY (the cap on a candidate's unpaid work), and the policy number
// lives in exactly one place: pipeline/jobfit/devcase/models.py, exported to TS by
// `schemas:gen` and reused through app/_lib/devcase-timebox.ts. The UI kept its own
// copy anyway — the design card rendered `design.case?.timeboxHours ?? 4`, which is
// DOUBLE the enforced 2h cap and the exact stale Pydantic default the shared module
// was written to kill, and the review panel sent the reviewer's raw number through
// while previewing it optimistically, so the reviewer approved "8h" and the candidate
// received 2h with no notice anywhere.
//
// A literal in a component is invisible to every gate: tsc, lint and design:check all
// stay green while the cap silently doubles. So pin it on the SOURCE, the same way
// approve-gate.test.ts pins the route (a route/component can't be imported here — one
// is handler-only under Next 16, the other drags React in).
//
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(path.join(here, f), "utf8");

const TIMEBOX_FILES = ["DevAnalysisDesignCard.tsx", "DevLifecycleReviewPanel.tsx"] as const;

test("no timebox UI file carries a timebox number of its own", () => {
  for (const file of TIMEBOX_FILES) {
    const src = read(file);
    // Any numeric fallback or comparison sitting next to a timebox expression is a
    // second writer of the policy. `?? 4` was the one that shipped.
    assert.doesNotMatch(
      src,
      /timebox\w*\s*(\?\?|\|\||[<>=!]=?)\s*-?\d/i,
      `${file}: the timebox must come from devcase-timebox.ts, not from a literal`
    );
    assert.doesNotMatch(src, /\?\?\s*4\b/, `${file}: '?? 4' is the stale over-policy Pydantic default`);
  }
});

test("both timebox UI files resolve the number through the shared clamp", () => {
  for (const file of TIMEBOX_FILES) {
    assert.match(
      read(file),
      /from "@\/app\/_lib\/devcase-timebox"/,
      `${file}: the bound must be imported from the shared module, never re-typed`
    );
  }
});

test("the review panel clamps before it previews, and says so", () => {
  const src = read("DevLifecycleReviewPanel.tsx");
  // The optimistic path: the panel used the reviewer's raw `timeboxNum` for both the
  // edit it POSTed and the candidate-safe preview, so it promised a value the server
  // would never keep.
  assert.match(src, /clampTimeboxHours|timeboxClamp/, "the panel must clamp client-side with the shared rule");
  assert.match(src, /timeboxClamped/, "a clamp must be shown inline, in the reviewer's language");
  assert.doesNotMatch(src, /edits\.timeboxHours\s*=\s*timeboxNum/, "the raw typed number must never be the edit sent");
});
