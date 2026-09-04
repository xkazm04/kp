// Pins the LAST honesty fact the calibration route ships that no surface read.
//
// `GET /api/analytics/calibration` has answered with `autoRejectEnabled` since the
// floor was first surfaced, and the comment beside it in the route names the two
// sentences it exists to prevent: a coral floor marker on the reliability diagram,
// and „every family is screened at the global 45". The shipped default for
// `screening.autoRejectEnabled` is FALSE — screen-wave.ts returns `autoRejectOff`
// and rejects nobody — so on a stock workspace BOTH sentences were false, and the
// flag that says so was undeclared in `CalibrationPayload` and unread anywhere in
// the tab. Nothing failed: no test, no type error, no lint. The number was on
// screen; the switch beside it was not.
//
// Same idiom as analyticsCalibrationLeakageGate.test.ts (there is no render/DOM
// layer here, and the wiring lives in .tsx that Node's type-stripping runner cannot
// import): structural assertions over the source, ordered where the ordering IS the
// guarantee. Both branches are pinned — a floor that IS enforced must still draw.
//
// Runner: Node's built-in test runner with type stripping.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

/** Code only — these files explain the defect in prose, so a naive text search
 *  would match their own postmortem. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const panel = read("./AnalyticsCalibrationPanel.tsx");
const diagram = read("./AnalyticsReliabilityDiagram.tsx");
const chips = read("./AnalyticsFamilyFloorChips.tsx");
const route = readFileSync(
  fileURLToPath(new URL("../../../api/analytics/calibration/route.ts", import.meta.url)),
  "utf8",
);

// ─── 1. The flag exists on the wire and is declared by the reader ─────────────

test("the route still ships the enforcement flag beside the floor", () => {
  // The precondition for everything below. If the route stops sending it, the UI
  // must fail here rather than silently fall back to „enforced".
  assert.match(code(route), /autoRejectEnabled = screening\.autoRejectEnabled === true/);
  assert.match(code(route), /^\s*autoRejectEnabled,$/m, "the flag must ride in the returned payload");
});

test("the panel payload type declares autoRejectEnabled", () => {
  assert.match(
    panel,
    /autoRejectEnabled\?:\s*boolean \| null/,
    "an undeclared payload field is an unrenderable one — this is how the flag stayed invisible",
  );
});

// ─── 2. The diagram draws no marker for a floor nobody enforces ───────────────

test("the reliability diagram takes the enforcement flag, not only the number", () => {
  assert.match(diagram, /thresholdEnforced\?:\s*boolean \| null/, "the diagram must be able to know the floor is off");
  assert.match(
    panel,
    /thresholdEnforced=\{data\.autoRejectEnabled/,
    "the panel must thread it in beside the threshold it qualifies",
  );
});

test("the coral floor marker is gated on enforcement, and only on the pipeline arm", () => {
  const src = code(diagram);
  // ORDER assertion: `floorProb` — the only value the marker line is drawn from —
  // must be derived THROUGH the enforcement flag. Compute it from the raw threshold
  // and the marker returns for a workspace that rejects nobody.
  const derived = src.search(/const floorProb\s*=[^;]*enforced/);
  assert.ok(derived > 0, "floorProb (what the marker line is drawn from) must be conditioned on enforcement");
  const marker = src.indexOf("stroke-coral");
  assert.ok(marker > derived, "precondition: the marker is drawn after the gated value is derived");
  assert.match(src, /\{floorProb != null \? \(/, "…and the marker element is rendered only when that gated value exists");
  assert.doesNotMatch(
    src.slice(marker - 200, marker + 200),
    /threshold \/ 100/,
    "the marker must not recompute the floor from the raw prop and bypass the gate",
  );
});

test("the screen-reader equivalent states BOTH branches", () => {
  // The sr list is the only textual rendering of the plot (WCAG 1.1.1). A silently
  // absent marker is a silently absent sentence unless the off branch says so.
  assert.match(diagram, /srThreshold\b/, "an enforced floor is still announced");
  assert.match(diagram, /srThresholdOff\b/, "…and an unenforced one says it is recorded, not enforced");
  assert.match(
    code(diagram),
    /enforced \? t\("srThreshold"/,
    "the two sentences must be selected by the flag, not by whether the marker happened to draw",
  );
});

// ─── 3. The panel legend and the family chips stop asserting a live gate ──────

test("the legend names an unenforced floor as unenforced", () => {
  assert.match(panel, /thresholdLegendOff/, "the legend row must have an off branch");
  assert.match(
    code(panel),
    /data\.autoRejectEnabled === false\s*\?\s*t\("thresholdLegendOff"/,
    "…selected by the flag",
  );
  assert.match(code(panel), /t\("thresholdLegend"/, "…and the enforced branch must survive");
});

test("the chips receive the flag and drop the every-family-is-screened claim", () => {
  assert.match(chips, /autoRejectEnabled/, "the chips must receive the flag");
  assert.match(panel, /autoRejectEnabled=\{data\.autoRejectEnabled/, "…threaded from the payload");
  // familyFloorsNone is the exact sentence the route's comment names: „every family
  // is screened at the global {global}". True only when the wave is on.
  assert.match(code(chips), /enforced\s*\?\s*t\("familyFloorsNone"/, "the screened-at claim must be the ENFORCED branch");
  assert.match(chips, /familyFloorsNoneOff/, "…with a branch that states the floor without claiming it acts");
  assert.match(chips, /floorNotEnforced/, "and an explicit line saying automatic screening is off");
  assert.match(code(chips), /role="status"/, "…announced, not only painted — it changes what every figure above means");
});
