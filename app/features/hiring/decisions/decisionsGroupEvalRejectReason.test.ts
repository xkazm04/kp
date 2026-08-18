// UAT LUC-GEF-L1-08 (recurrence 2) — a group-eval reject must carry a reason.
//
// The defect, verified in the sealed store: DecisionsModals' onDecide called
// `act(e, action)` with no third argument, while act is (e, action, detail?,
// ttlDays?). With detail absent, actOnPipelineEntry seals
//   rationale: trimmedDetail || `Recruiter ${action} from ${current.stage}.`
// so the tamper-evident record for an adverse decision read "Recruiter reject
// from Screened." with inputs.detail: null — a tautology in the Odůvodnění
// column, which is the first column an auditor reads for the BASIS of a
// rejection. The analysis path in the very same file has always passed the
// recruiter's reason, so a permanent record's quality depended on which button
// the recruiter used. Two consecutive cycles shipped without the argument.
//
// These are source-level guards: the wiring lives in .tsx components that import
// through the "@/…" alias, which Node's test runner does not resolve, and there
// is no DOM renderer in this suite (same reasoning as
// app/api/rate-limit-contract.test.ts). Sources are comment-stripped first —
// otherwise the prose describing the old bug would satisfy the assertion looking
// for it.
//
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function source(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

test("the sealed rationale still falls back to a template when detail is missing", () => {
  // The writer this whole item is about. If the fallback template ever goes away
  // (or starts carrying a real basis), the guards below should be re-read rather
  // than assumed — a reasonless reject would stop being silently plausible.
  const writer = source("../../../_lib/pipeline-entry-action.ts");
  assert.match(
    writer,
    /rationale: trimmedDetail \|\|/,
    "actOnPipelineEntry no longer templates a missing rationale — re-read decisionsGroupEvalRejectReason.test.ts's premise"
  );
  assert.match(writer, /detail: trimmedDetail \|\| null/, "the sealed inputs must still record detail (null when the caller passed none)");
});

test("a group-eval reject reaches act() with the recruiter's reason", () => {
  const modals = source("./DecisionsModals.tsx");

  // The fix itself: the confirmed rationale is forwarded as `detail`.
  assert.match(modals, /act\(entry, "reject", reason\)/, "the confirmed group-eval reject must pass the reason to act() as detail");

  // …and the reasonless path is structurally unreachable for a reject: the
  // reject branch returns BEFORE the fall-through advance call. Order is the
  // load-bearing fact, so it is asserted as order, not as presence.
  const rejectBranch = modals.indexOf('if (action === "reject") {');
  const fallThrough = modals.indexOf("void act(e, action);");
  assert.ok(rejectBranch > -1, "onDecide must branch on a reject before deciding");
  assert.ok(fallThrough > -1, "the advance path still decides on the click");
  assert.ok(rejectBranch < fallThrough, "a reject must return before the reasonless act(e, action) fall-through");

  // The click alone decides nothing: it opens the confirm dialog and reports
  // `false`, so the comparison tab cannot show a "Rejected" pill for a decision
  // that was never issued.
  assert.match(modals, /setRejectPending\(\{ entry: e, identity \}\)/, "a reject click must stage the confirmation, not the decision");
  assert.match(modals, /<DecisionsGroupEvalRejectModal/, "DecisionsModals must render the reject confirmation");

  // A candidate rejected earlier in this sitting has left the live pool, so the
  // entry no longer resolves; answering from the sealed set keeps the button
  // truthful instead of a dead click.
  assert.match(modals, /action === "reject" && sealedRejects\.has\(identity\)/, "a re-click on an already-sealed reject must report the recorded outcome");
});

test("the confirmation cannot be committed without a rationale", () => {
  const modal = source("./DecisionsGroupEvalRejectModal.tsx");

  // Empty (or whitespace-only) is refused at both the guard and the control, so
  // neither Enter-to-confirm nor a click can seal a blank basis.
  assert.match(modal, /const trimmed = reason\.trim\(\);/, "the rationale must be trimmed before it is judged non-empty");
  assert.match(modal, /const ready = trimmed\.length > 0;/, "readiness must be 'a non-empty trimmed reason'");
  assert.match(modal, /if \(!ready\) return;/, "confirm must refuse an empty rationale");
  assert.match(modal, /disabled=\{!ready\}/, "the confirm button must be disabled until a rationale exists");
  assert.match(modal, /onConfirm\(trimmed\)/, "the trimmed rationale is what gets sealed");

  // Fast by construction — presets keep the common case at preset → Confirm, so
  // the added step costs one click, not a paragraph. They fill the same editable
  // field, so the sealed text is always what the recruiter could see.
  assert.match(modal, /GROUP_EVAL_REJECT_PRESETS = \[/, "the dialog must offer one-click preset rationales");
  assert.match(modal, /onClick=\{\(\) => setReason\(text\)\}/, "a preset fills the editable field rather than sealing a hidden code");
});
