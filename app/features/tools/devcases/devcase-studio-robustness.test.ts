// Source-level pins for the four studio behaviours that have no DOM to test against.
//
// There is no jsdom in this repo (node:test + type stripping, see the runner note in
// scripts/run-unit-tests.mjs), so focus management, a clipboard rejection and a
// double-click race cannot be exercised. What CAN be pinned is that the wiring is
// still there — the same idiom as DevTab.approve-error.test.ts, which pins that
// approve() goes through runAction rather than a bare `if (r.ok)`. These are shape
// assertions and they say so: each one names the failure it exists to prevent, so a
// future reader knows what it is being asked not to delete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(path.join(DIR, file), "utf8");

test("the publish confirm is a real dialog: focus wiring mounts and unmounts WITH it", () => {
  const src = read("DevPublishConfirm.tsx");
  // The shared hook, not a hand-rolled listener: it owns the ONE dialog stack, so
  // Escape acts on the frontmost dialog rather than every open one at once.
  assert.match(src, /useDialogA11y\(/, "the confirm must use the shared dialog a11y hook");
  assert.match(src, /trap:\s*true/, "Tab must not walk out of the panel that publishes");
  assert.match(src, /aria-modal="true"/);
  assert.match(src, /tabIndex=\{-1\}/, "the container must be programmatically focusable");

  // useDialogA11y's effect runs on MOUNT. Living inside DevCaseDetailHeader, which is
  // mounted the whole time the assignment is open, it would have fired once on page
  // load and never again — so the dialog has to be its own conditionally-mounted
  // component, and the header must render it that way.
  const header = read("DevCaseDetailHeader.tsx");
  assert.match(header, /\{confirmingPublish && !published \? \(\s*<DevPublishConfirm/);
  assert.ok(!header.includes("useDialogA11y("), "the hook belongs to the dialog, not to its host");

  // Focus restore is `previouslyFocused?.focus?.()`, which is a SILENT no-op on a
  // disabled element. Disabling the trigger while the panel is open therefore dropped
  // the keyboard user onto <body> on Escape.
  assert.doesNotMatch(
    header,
    /disabled=\{published \|\| publishing \|\| confirmingPublish\}/,
    "the Publish trigger must stay enabled while the confirm is open, or focus cannot return to it"
  );
  assert.match(header, /aria-expanded=\{confirmingPublish\}/, "the trigger states the panel's open-ness instead");
});

test("a blocked clipboard leaves the apply link reachable, not swallowed", () => {
  const src = read("DevApplyTokenPill.tsx");
  // The failure mode this closes: on an insecure origin (a self-hosted install on a
  // plain-http LAN address) navigator.clipboard rejects, the catch was a no-op, and
  // the URL was never RENDERED — only copied — so there was nothing to select by hand
  // either. The one artifact this panel exists to hand out was unreachable.
  assert.match(src, /setBlocked\(true\)/, "a clipboard rejection must set a visible state");
  assert.match(src, /select-all/, "the fallback URL must be selectable in one click");
  assert.match(src, /\{applyUrl\}/, "the fallback must render the URL itself, not just say it failed");
  assert.match(src, /role="status"/, "the failure must be announced, not only drawn");
});

test("the JD library's failure is named and retryable, never an empty picker", () => {
  const data = read("useDevTabData.ts");
  assert.doesNotMatch(data, /\.catch\(\(\) => \{\}\)/, "the JD fetch must not swallow its failure");
  assert.match(data, /setJdsError\(/);
  assert.match(data, /errorMessage\(/, "the server's machine code resolves in the reader's language first");
  assert.match(data, /reloadJds/, "a failure the operator cannot retry is a dead end");
  const form = read("DevNeedForm.tsx");
  // A failed fetch is NOT an empty library: the error branch must be checked BEFORE
  // the `jds.length === 0` branch, or an outage still reads as "no JDs saved" and
  // sends the operator to save one they already have.
  assert.ok(
    form.indexOf("jdsError ? (") < form.indexOf("jds.length === 0 ?"),
    "the outage branch must come before the genuinely-empty branch"
  );
});

test("every write action on the tab is single-flight", () => {
  const src = read("useDevTabActions.ts");
  // source() was the one without a guard. `sourcing` holds an id, not a boolean, so
  // the button only disabled the row it was clicked on — a click on a second row
  // seeded the pipeline twice.
  for (const [guard, what] of [
    ["if (runningLifecycle) return;", "runLifecycle"],
    ["if (publishingCase) return;", "publish"],
    ["if (sourcing) return;", "source"],
  ] as const) {
    assert.ok(src.includes(guard), `${what}() lost its single-flight guard (${guard})`);
  }
});

// ---- D2: the submission row and its two doors tell the truth about a failure ----

test("the skill-profile failure is resolved from the code, never asserted", () => {
  const btn = read("DevSubmissionRowSkillProfile.tsx");
  // The failure mode: ONE English sentence — "needs an evaluated submission +
  // KP_SECRET" — stood for every failure, so a 503, a tenancy 404 and a dropped
  // connection all told the recruiter to evaluate a submission they had already
  // evaluated. A 503 has no such cause and must not be given one.
  assert.doesNotMatch(btn, /evaluated submission/i, "one asserted cause cannot stand for every failure");
  assert.doesNotMatch(btn, /KP_SECRET|process\.env/, "a server environment variable is not a recruiter's remedy");
  assert.match(btn, /useErrorMessage\(\)/, "the code resolves in the reader's language");
  assert.match(btn, /errMsg\(\{ code: dsp\.code \}/, "the payload's code is what is shown");
  assert.match(btn, /role="alert"/, "a failure must be announced, not only drawn");
  assert.match(btn, /focus-ring/, "the share link and the button must both be visibly focusable");

  // …and the hook has to CARRY a code for any of that to be reachable: it used to
  // collapse every throw into a code-less `status: "error"`.
  const hook = read("useDevSubmissionRow.ts");
  assert.match(hook, /code: data\?\.code \?\? null/, "the server's code must survive the catch");
});

test("the submission form distinguishes an absorbed duplicate from a new row", () => {
  // intakeSubmission is idempotent per (posting, candidate, repo) and answers `isNew`.
  // The route dropped it and the form claimed a fresh record either way, so a retry
  // after a slow response read as a second submission that does not exist.
  const route = read("../../../api/devcase/submit/route.ts");
  assert.match(route, /\{ ok: true, isNew, submission \}/, "the route must put `isNew` on the wire");
  const form = read("DevSubmissionForm.tsx");
  assert.match(form, /isNew === false \? "duplicate" : "recorded"/);
  assert.match(form, /receiptDuplicate/);
  assert.match(form, /receiptRecorded/);
  assert.match(form, /role="status"/, "a receipt is announced");
});

test("the dev-case submit and source doors answer with a code, not the thrown message", () => {
  for (const [file, code] of [
    ["../../../api/devcase/submit/route.ts", "DEVCASE_SUBMIT_FAILED"],
    ["../../../api/devcase/source/route.ts", "DEVCASE_SOURCE_FAILED"],
  ]) {
    const src = read(file);
    assert.ok(src.includes(`, "${code}");`), `${file} must answer with ${code} through safeJsonError`);
    assert.ok(src.includes("safeJsonError(error,"), `${file} must use safeJsonError`);
    assert.ok(
      !src.includes("error instanceof Error ? error.message"),
      `${file} still forwards a thrown message — SQLITE_* detail, the db path or a spawn's stderr`
    );
  }
});

test("the review drawer refuses a full task-list clear instead of dropping it", () => {
  const src = read("DevLifecycleReviewPanel.tsx");
  // The rule itself is pure and tested in DevHelpers.test.ts; what this pins is that
  // the panel HONORS it — an unenforced refusal is the silent drop with extra steps.
  assert.match(src, /caseEdits\(kase, \{ title, brief, tasks: editedTasks, timeboxHours \}\)/);
  assert.doesNotMatch(src, /editedTasks\.length > 0/, "the guard that swallowed the clear must be gone");
  assert.match(src, /if \(busy \|\| blocked\) return;/, "approve() must not fire while blocked");
  assert.match(src, /disabled=\{busy !== null \|\| blocked !== null\}/);
  assert.match(src, /tasksRequired/, "the refusal must be named on screen");
});
