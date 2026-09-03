// FOCUS FOLLOWS THE SURFACE (/perfect, schedule-door-speaks-the-candidates-language).
//
// /schedule/[token] swaps its entire body on a booking, an RSVP cancel, a withdrawal, a
// "different time" and a link going dead. Each swap unmounts the element focus was on, so
// focus fell to <body>: the keyboard candidate had to tab from the top of the document to
// find out whether their booking landed.
//
// Two halves, pinned two ways. The TARGET is a pure function (no DOM, no renderer needed),
// asserted directly against the ordering SchedulePicker renders by. The WIRING is a source
// guard, the same shape as schedule-picker-recovery.test.ts — there is no component
// renderer in this repo's unit runner, and "which id exists on which surface" is something
// the source states exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEDULE_FOCUS_ID, SCHEDULE_SURFACES, scheduleSurface } from "./schedule-focus.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");

test("the focus target follows SchedulePicker's own branch order", () => {
  // A dead link beats a booking: there is no action left on it, so the terminal card wins
  // even for a candidate who had already confirmed.
  assert.equal(scheduleSurface({ closedReason: "expired", confirmed: "Tue 14:00", rescheduling: false }), "dead");
  assert.equal(scheduleSurface({ closedReason: "declined", confirmed: null, rescheduling: true }), "dead");
  // A booking beats the picker…
  assert.equal(scheduleSurface({ closedReason: null, confirmed: "Tue 14:00", rescheduling: false }), "booked");
  // …unless the candidate opted into rescheduling, which puts the grid back.
  assert.equal(scheduleSurface({ closedReason: null, confirmed: "Tue 14:00", rescheduling: true }), "picker");
  assert.equal(scheduleSurface({ closedReason: null, confirmed: null, rescheduling: false }), "picker");
});

test("every surface declares exactly one anchor id, and they are distinct", () => {
  const ids = SCHEDULE_SURFACES.map((s) => SCHEDULE_FOCUS_ID[s]);
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3, "two surfaces sharing an id would focus the wrong card");
  for (const id of ids) assert.match(id, /^schedule-[a-z-]+$/);
});

test("SchedulePicker moves focus on a surface CHANGE, never on the first loaded render", () => {
  const src = read("SchedulePicker.tsx");
  assert.match(src, /scheduleSurface\(\{ closedReason: s\.closedReason, confirmed: s\.confirmed, rescheduling: s\.rescheduling \}\)/,
    "the target must be derived from the same state the branches read");
  assert.match(src, /document\.getElementById\(SCHEDULE_FOCUS_ID\[surface\]\)\?\.focus\(\)/, "…and actually focused");
  assert.match(
    src,
    /if \(lastSurface\.current !== null && lastSurface\.current !== surface\)/,
    "the source guard: only a CHANGE moves focus, so an arriving load never steals it from a reader"
  );
  assert.match(src, /if \(!loaded\) return;/, "and the pre-invite render must not seed the previous surface");
});

test("each surface component renders its anchor as a non-tab-stop", () => {
  const anchored: [string, string][] = [
    ["DeadLinkCard.tsx", "SCHEDULE_FOCUS_ID.dead"],
    ["BookedCard.tsx", "SCHEDULE_FOCUS_ID.booked"],
    ["SlotPicker.tsx", "SCHEDULE_FOCUS_ID.picker"],
  ];
  for (const [file, token] of anchored) {
    const src = read(file);
    const at = src.indexOf(`id={${token}}`);
    assert.ok(at >= 0, `${file} must render its focus anchor id`);
    assert.match(
      src.slice(at, at + 120),
      /tabIndex=\{-1\}/,
      `${file}'s anchor must be programmatically focusable WITHOUT becoming a tab stop`
    );
  }
});
