// Why the per-zone drop highlight is COUNTED.
//
// Each Analyze drop zone is a <label> wrapping an icon, a title and a hint, and
// dragenter/dragleave fire for every one of those as the cursor crosses them. The
// zone hook stored a boolean and set it false on ANY leave, so moving from the
// label onto its own icon read as "you have left" — the highlight strobed while
// the user was squarely inside the target, flashing "will not accept this file"
// at them. The window-level hook had counted its depth all along; this is the
// same arithmetic, extracted so both halves of the behaviour have one definition
// and a test.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   node scripts/run-unit-tests.mjs app/features/tools/analyze/analyzeDragCounter.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DRAG_COUNTER_EVENTS,
  isDragActive,
  isDragCounterEvent,
  nextDragDepth,
  type DragCounterEvent,
} from "./analyzeDragCounter.ts";

/** Replay a sequence of drag events and report the highlight after each one. */
function highlightTrace(events: DragCounterEvent[]): boolean[] {
  let depth = 0;
  return events.map((event) => {
    depth = nextDragDepth(depth, event);
    return isDragActive(depth);
  });
}

test("the drag events are a closed vocabulary with a runtime guard", () => {
  assert.deepEqual([...DRAG_COUNTER_EVENTS], ["enter", "leave", "drop", "end"]);
  for (const event of DRAG_COUNTER_EVENTS) assert.ok(isDragCounterEvent(event));
  assert.ok(!isDragCounterEvent("over"), "dragover is not a depth change");
  assert.ok(!isDragCounterEvent(null));
});

test("crossing a child element does NOT drop the highlight", () => {
  // The real sequence when the cursor moves from the label onto its own icon:
  // enter(label), then enter(icon) BEFORE leave(label). A boolean flag renders
  // false on that third event; the counter stays positive throughout.
  assert.deepEqual(
    highlightTrace(["enter", "enter", "leave"]),
    [true, true, true],
    "the highlight must not flicker while the pointer is still inside the zone"
  );
});

test("the highlight clears only when every entered element has been left", () => {
  assert.deepEqual(highlightTrace(["enter", "enter", "leave", "leave"]), [true, true, true, false]);
});

test("a deeply nested crossing never flickers", () => {
  const events: DragCounterEvent[] = ["enter", "enter", "enter", "leave", "leave"];
  assert.deepEqual(highlightTrace(events), [true, true, true, true, true]);
  assert.deepEqual(highlightTrace([...events, "leave"]).at(-1), false);
});

test("the depth clamps at zero, so a stray leave cannot swallow the next enter", () => {
  // Browsers do emit unbalanced leaves (an empty dataTransfer during dragleave is
  // the documented case in the window-level hook). Without the clamp the depth
  // would go negative and the NEXT real enter would only bring it back to zero —
  // a zone that silently refuses to highlight.
  assert.equal(nextDragDepth(0, "leave"), 0);
  assert.deepEqual(highlightTrace(["leave", "leave", "enter"]), [false, false, true]);
});

test("drop and dragend are terminal resets, not decrements", () => {
  // On drop the cursor is still inside several children whose balancing leaves
  // will never arrive; an ESC-cancelled drag sends no leave at all. Decrementing
  // would leave the zone stuck highlighted with nothing being dragged.
  assert.equal(nextDragDepth(3, "drop"), 0);
  assert.equal(nextDragDepth(3, "end"), 0);
  assert.deepEqual(highlightTrace(["enter", "enter", "enter", "drop"]).at(-1), false);
  assert.deepEqual(highlightTrace(["enter", "enter", "end"]).at(-1), false);
});

test("the zone hook uses the counter and keeps dragover out of it", () => {
  const hook = readFileSync(fileURLToPath(new URL("./useAnalyzeDropZoneHighlight.ts", import.meta.url)), "utf8");
  assert.match(hook, /nextDragDepth/, "the hook consumes the shared arithmetic");
  // Comments stripped: the doc comment describes the old shape on purpose, and it
  // is a live code line — not prose about one — that this forbids.
  const hookCode = hook.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/setIsOver\(false\)/.test(hookCode), "the unconditional leave reset must be gone");
  assert.match(hook, /step\("enter"\)/);
  assert.match(hook, /step\("leave"\)/);
  assert.match(hook, /step\("drop"\)/);
  assert.match(hook, /onDragEnd/, "the ESC-cancel backstop the boolean version lacked");
  // dragover fires continuously; counting it would inflate the depth past any
  // number of leaves and the highlight would never clear.
  const over = hookCode.slice(hookCode.indexOf("onDragOver"), hookCode.indexOf("onDragLeave"));
  assert.ok(!/step\(/.test(over), "dragover must not touch the depth");
});

test("both drop zones announce themselves to assistive tech", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const jdZone = read("./AnalyzeFileDropZone.tsx");
  assert.match(jdZone, /role="button"/, "a bare <label> announces only the input's name");
  assert.match(jdZone, /aria-describedby=\{hintId\}/, "…and the localized format hint describes it");
  assert.match(jdZone, /id=\{hintId\}/, "the hint carries the id it is referenced by");

  const cvZone = read("./AnalyzeProfileInput.tsx");
  assert.match(cvZone, /aria-describedby="profile-file-0-hint"/);
  assert.match(cvZone, /id="profile-file-0-hint"/);
  // The drop-anywhere overlay is aria-hidden decoration; the fact it conveys is
  // announced through a polite live region that is ALWAYS mounted (a region added
  // at the same moment as its text is not reliably announced).
  assert.match(cvZone, /aria-live="polite"/);
  assert.match(cvZone, /isWindowDragging \? `\$\{t\("dropCvAnywhere"\)\} \$\{t\("dropCarveout"\)\}` : ""/);
});
