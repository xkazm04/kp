// Pins the "finished but not saved" warning on the live Analyze result.
//
// persistAnalysis (app/_lib/analyze-run.ts) catches a saveAnalysis failure, logs it and
// hands back `persistence: null` - the run still DELIVERS, so the live result looks
// complete while no History row, board entry or report exists. The one thing the
// recruiter saw was a disabled "Add to pipeline". This pins the condition that now
// raises a dismissible warning: persistence is null on a delivered analysis, and ONLY
// then. No React renderer in this suite, so the decision is a pure function and the
// wiring is read off the source (same shape as ResultPanel.contract.test.ts).
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { shouldWarnUnsaved } from "./analyzeUnsavedWarning.ts";
import type { Analysis } from "@/app/_lib/schemas";

function analysis(over: Record<string, unknown>): Analysis {
  return { candidate: { name: "Alice Doe" }, ...over } as unknown as Analysis;
}

test("a delivered analysis whose save failed (persistence null) warns", () => {
  assert.equal(shouldWarnUnsaved(analysis({ persistence: null })), true);
});

test("a real save receipt does not warn - with or without a JD", () => {
  const receipt = { slug: "alice-abc", createdAt: "2026-10-06T00:00:00Z" };
  assert.equal(shouldWarnUnsaved(analysis({ persistence: { ...receipt, jdSlug: "be-1", candidateLabel: "a.pdf" } })), false);
  assert.equal(shouldWarnUnsaved(analysis({ persistence: { ...receipt, jdSlug: null } })), false, "JD-less is saved, just not fileable");
});

test("no analysis at all (idle, or a GitHub-only run) never warns", () => {
  assert.equal(shouldWarnUnsaved(null), false);
});

test("a body that predates the receipt (persistence absent) is not read as a failed save", () => {
  assert.equal(shouldWarnUnsaved(analysis({})), false, "only an explicit null is the server's 'persist failed'");
});

test("AnalyzeTab wires the warning from the helper and keeps it dismissible", () => {
  const tab = readFileSync(fileURLToPath(new URL("./AnalyzeTab.tsx", import.meta.url)), "utf8");
  assert.match(tab, /shouldWarnUnsaved\(result\.analysis\)/);
  assert.match(tab, /t\("unsavedWarningTitle"\)/);
  assert.match(tab, /t\("unsavedWarningBody"\)/);
  assert.match(tab, /t\("unsavedWarningDismiss"\)/);
  assert.match(tab, /setDismissedFor\(result\.analysis\)/, "the dismissal is remembered per delivered result");
});
