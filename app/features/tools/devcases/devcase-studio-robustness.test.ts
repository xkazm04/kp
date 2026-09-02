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
