// The board's layout model. These are the assertions that hold the product
// properties, not the pixels: the pixels are a function of `unit`, and `unit` is
// measured in a browser this suite does not have.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JOURNEY_COLUMN_REM,
  JOURNEY_COLUMN_W,
  JOURNEY_MIN_BAND_PX,
  JOURNEY_RAIL_LEFT,
  JOURNEY_RAIL_REM,
  JOURNEY_RAIL_W,
  JOURNEY_ROW_BASE,
  JOURNEY_ROW_MAX,
  SILENCE_DAYS,
  bandHeight,
  clusterBandHeight,
  clusterIndexInView,
  globalBandHeights,
  nextRowUnit,
  normalizeAbsenceKey,
  planBoard,
  requiredRowUnit,
  rowOffset,
} from "./journeyLayout.ts";
import { hasCatalogKey, journeyBoardFixture, makeWideBoard } from "./__fixtures__/journeyBoard.ts";

const plan = () => planBoard(journeyBoardFixture, { hasKey: hasCatalogKey });

test("a gap of SILENCE_DAYS or more prints its own marker on the row it precedes", () => {
  const board = plan();
  const full = board.clusters[0].columns[0];
  const screening = full.bands.get("screening");
  assert.ok(screening);
  // analysis on the 1st, acknowledgement on the 9th: eight whole days.
  const cells = [...screening.cells.values()];
  const ack = cells.find((c) => c.event.kind === "acknowledgement_sent");
  assert.equal(ack?.silenceDays, 8, "the acknowledgement opens with an 8-day silence");
  assert.ok((ack?.silenceDays ?? 0) >= SILENCE_DAYS);
  // The analysis is the first row of its phase: nothing precedes it, so it
  // carries no silence. "Nothing before this" is not "nothing happened".
  const analysis = cells.find((c) => c.event.kind === "analysis");
  assert.equal(analysis?.silenceDays, undefined);
});

test("the shared job-definition band gets silence rows too", () => {
  const board = plan();
  const shared = board.clusters[0].shared;
  assert.equal(shared.length, 3);
  assert.equal(shared[2].silenceDays, 11);
  assert.equal(board.clusters[0].sharedSilentRows[2], true);
});

test("silence reserves height on the ROW, so every column in the cluster agrees", () => {
  const board = plan();
  const screening = board.clusters[0].phases.get("screening");
  assert.ok(screening);
  // Row 1 is the acknowledgement rung; one column opens it with a silence
  // marker, so EVERY column's row 1 is taller — otherwise the grid stops
  // lining up and the rail stops meaning anything.
  assert.equal(screening.silentRows[1], true);
  assert.equal(screening.silentRows[0], false);
});

test("the three band-level absences are three different states", () => {
  const board = plan();
  const [full, stopped, testRun, empty] = board.clusters[0].columns;

  // 1 — it did not happen, and the record says why.
  assert.deepEqual(full.bands.get("case")?.state, {
    kind: "nothing-happened",
    reasonKey: "absence.caseNotRun",
  });

  // 2a — a reason key nothing can resolve is NOT rendered raw.
  assert.deepEqual(stopped.bands.get("case")?.state, { kind: "never-recorded" });

  // 2b — `present: true` with no rows at all is the contradiction types.ts
  // names. It reads as a hole in the ledger, never as "nothing happened".
  assert.deepEqual(testRun.bands.get("case")?.state, { kind: "never-recorded" });

  // 1 again, from a different reason key — an empty column is still explained.
  assert.deepEqual(empty.bands.get("screening")?.state, {
    kind: "nothing-happened",
    reasonKey: "absence.screeningNotRecorded",
  });

  // 3 — rows, but the ledger vouches for none of them.
  assert.deepEqual(testRun.bands.get("screening")?.state, { kind: "rows", allGenerated: true });
  assert.deepEqual(full.bands.get("screening")?.state, { kind: "rows", allGenerated: false });
});

test("skipped and never-reached are decided by what comes AFTER, not by emptiness", () => {
  const board = plan();
  const [full, stopped, testRun] = board.clusters[0].columns;
  const screening = board.clusters[0].phases.get("screening");
  assert.ok(screening);
  assert.equal(screening.rowCount, 4, "analysis, acknowledgement, hold, advanced");

  // Reached the last rung: no tail at all.
  assert.equal(full.bands.get("screening")?.tailFrom, 4);

  // Stopped after rung 1: rungs 2 and 3 are the never-reached block.
  assert.equal(stopped.bands.get("screening")?.tailFrom, 2);
  assert.equal(stopped.bands.get("screening")?.cells.size, 2);

  // SKIPPED, not ended: no acknowledgement (rung 1) but a hold at rung 2, so
  // rung 1 is an empty cell inside the run and the tail starts after rung 2.
  const uat = testRun.bands.get("screening");
  assert.ok(uat);
  assert.equal(uat.cells.has(0), true);
  assert.equal(uat.cells.has(1), false, "rung 1 was skipped");
  assert.equal(uat.cells.has(2), true);
  assert.equal(uat.tailFrom, 3);
});

test("a band BEFORE the journey's last row has no tail — every gap in it is a skip", () => {
  const board = plan();
  // `case` sits before `screening`. The test-run column has screening rows, so
  // its (empty, present) case band must never claim the journey ended there.
  const testRun = board.clusters[0].columns[2];
  const caseBand = testRun.bands.get("case");
  // It resolved to never-recorded, so no tail is drawn at all.
  assert.equal(caseBand?.state.kind, "never-recorded");
  assert.equal(caseBand?.tailFrom, -1);
});

test("no event is ever dropped — a row with no free rung becomes an overflow row", () => {
  const board = planBoard(
    {
      ...journeyBoardFixture,
      clusters: [
        {
          ...journeyBoardFixture.clusters[0],
          // One rung, three events of that kind: two have nowhere canonical to go.
          rail: [{ index: 0, phase: "screening", kind: "analysis", reached: 1, cohort: 1, byMachine: 1 }],
          columns: [
            {
              ...journeyBoardFixture.clusters[0].columns[0],
              phases: {
                "job-definition": { present: false, absenceReasonKey: "absence.intakeMissing" },
                case: { present: false, absenceReasonKey: "absence.caseNotRun" },
                screening: { present: true },
              },
              events: ["a", "b", "c"].map((suffix, i) => ({
                id: `ov-${suffix}`,
                phase: "screening" as const,
                kind: "analysis",
                facts: {},
                occurredAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
                recordedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
                actor: "auto:analyze",
                sourceRef: { table: "analyses", id: `ov-${suffix}` },
              })),
            },
          ],
        },
      ],
    },
    { hasKey: hasCatalogKey }
  );
  const band = board.clusters[0].columns[0].bands.get("screening");
  assert.equal(band?.cells.size, 3, "all three rows are placed");
  const phase = board.clusters[0].phases.get("screening");
  assert.equal(phase?.rowCount, 3, "the band grew two rows to hold them");
});

test("observedOnly hides label-only and test-run rows, and says so at band level", () => {
  const board = planBoard(journeyBoardFixture, { hasKey: hasCatalogKey, observedOnly: true });
  const [full, , testRun] = board.clusters[0].columns;
  const cells = [...(full.bands.get("screening")?.cells.values() ?? [])];
  assert.equal(
    cells.some((c) => c.event.confidence === "label-only"),
    false,
    "a row matched by name alone is not an observed row"
  );
  assert.equal(cells.length, 3);
  // A test-run column loses every row, and the band then says the ledger holds
  // nothing — it does NOT quietly read as "nothing happened".
  assert.deepEqual(testRun.bands.get("screening")?.state, { kind: "never-recorded" });
});

test("band heights are equalised across clusters, and rails are not", () => {
  const board = plan();
  const heights = globalBandHeights(board, 44, 22);
  const a = clusterBandHeight(board.clusters[0], "screening", 44, 22);
  const b = clusterBandHeight(board.clusters[1], "screening", 44, 22);
  assert.ok(a > b, "cluster A's rail is longer, so its natural band is taller");
  // Cluster B's single-rung band is under the floor, and the floor is what stops
  // a step-less phase from collapsing to 0px and swallowing its own reason.
  assert.equal(b, JOURNEY_MIN_BAND_PX);
  assert.equal(heights.phases.get("screening"), a, "the global height is the tallest cluster's");
  // The rails themselves stay per role: row 1 is a different step in each.
  assert.equal(board.clusters[0].phases.get("screening")?.steps[1]?.kind, "acknowledgement_sent");
  assert.equal(board.clusters[1].phases.get("screening")?.steps[1], undefined);
});

test("job-definition gets no per-column band when the role owns the conversation", () => {
  const board = plan();
  assert.deepEqual(board.columnPhases, ["case", "screening"]);
});

test("row geometry: offsets accumulate the silence allowance, heights add up", () => {
  const silent = [false, true, false];
  assert.equal(rowOffset(0, silent, 40, 20), 0);
  assert.equal(rowOffset(1, silent, 40, 20), 40);
  assert.equal(rowOffset(2, silent, 40, 20), 100);
  assert.equal(bandHeight(3, silent, 40, 20), 140);
  // A band padded past its own rows still pads at the base unit.
  assert.equal(bandHeight(4, silent, 40, 20), 180);
});

test("the row unit only grows, and never past its ceiling", () => {
  assert.equal(nextRowUnit(44, 40, 132), 44, "a shorter measurement never shrinks the grid");
  assert.equal(nextRowUnit(44, 61.2, 132), 62);
  assert.equal(nextRowUnit(44, 900, 132), 132, "a pathological string scrolls its own cell");
  assert.equal(nextRowUnit(44, Number.NaN, 132), 44);
  // A cell that overflowed by 14px needs 14px more row.
  assert.equal(requiredRowUnit(44, [{ scrollHeight: 57, clientHeight: 43 }]), 58);
  assert.equal(requiredRowUnit(44, [{ scrollHeight: 20, clientHeight: 43 }]), 44);
  assert.equal(requiredRowUnit(44, [{ scrollHeight: 99, clientHeight: 0 }]), 44, "an unlaid-out cell says nothing");
  assert.ok(requiredRowUnit(44, [{ scrollHeight: 9999, clientHeight: 43 }]) <= JOURNEY_ROW_MAX);
});

test("an absence key is accepted relative to the journey namespace or absolute", () => {
  assert.equal(normalizeAbsenceKey("absence.caseNotRun"), "absence.caseNotRun");
  assert.equal(normalizeAbsenceKey("journey.absence.caseNotRun"), "absence.caseNotRun");
});

test("at contest scale the plan is proportional to the EVENTS, not to columns x rows", () => {
  // 4 roles x 25 columns = 100 columns, the size the contest was judged at.
  const wide = makeWideBoard(4, 25);
  const board = planBoard(wide, { hasKey: hasCatalogKey });
  assert.equal(board.totals.columns, 100);

  let cells = 0;
  let rowSlots = 0;
  for (const cluster of board.clusters) {
    const perColumnRows = [...cluster.phases.values()].reduce((sum, p) => sum + p.rowCount, 0);
    for (const column of cluster.columns) {
      for (const band of column.bands.values()) cells += band.cells.size;
      rowSlots += perColumnRows;
    }
  }
  assert.equal(cells, board.totals.rows, "one cell per event, and every event placed");
  // The dense alternative — a null in every (column, row) slot — is what a
  // 99-column board cannot afford. This is the number that says it stayed sparse.
  assert.ok(cells * 4 < rowSlots, `sparse: ${cells} cells against ${rowSlots} dense slots`);
});

test("the geometry numbers and the Tailwind classes that realise them agree", () => {
  // Tailwind only emits a utility it can SEE as a literal, so the widths are
  // spelled twice. This is the guard that stops the two spellings drifting —
  // a 20rem column measured against a 16rem rail offset is a board whose rail
  // covers its own first column and nothing says so.
  assert.equal(JOURNEY_COLUMN_W, `w-[${JOURNEY_COLUMN_REM}rem]`);
  assert.equal(JOURNEY_RAIL_W, `w-[${JOURNEY_RAIL_REM}rem]`);
  assert.equal(JOURNEY_RAIL_LEFT, `left-[${JOURNEY_RAIL_REM}rem]`);
});

test("the row unit's ceiling is TWO LINES, which is what makes the grid dense", () => {
  // The cell clamps the sentence (rowTextClass's line-clamp-2), so the probe can
  // never measure more than two lines; this is the arithmetic bound under that
  // clamp. It was 132 — six lines — and the real corpus settled at a 70px unit
  // for a median one-line sentence, which is the dead space finding E named.
  assert.ok(JOURNEY_ROW_MAX <= 64, `a two-line row cannot need ${JOURNEY_ROW_MAX}px`);
  assert.ok(JOURNEY_ROW_MAX > JOURNEY_ROW_BASE, "the unit must still be able to grow for cs/de/fr");
});

test("the rail follows the reader: which cluster is under the view", () => {
  // Offsets INCLUDE the rail, because the rail is the track's first flex child.
  const rail = 256;
  const starts = [rail, rail + 964, rail + 964 + 320];

  // Parked at the start: the first cluster, not "none".
  assert.equal(clusterIndexInView(0, rail, starts), 0);
  // Still inside the first cluster's span.
  assert.equal(clusterIndexInView(900, rail, starts), 0);
  // One pixel past its right edge is the second cluster.
  assert.equal(clusterIndexInView(964, rail, starts), 1);
  assert.equal(clusterIndexInView(1300, rail, starts), 2);
  // Past the end — the reader is parked on the last cluster, not off the board.
  assert.equal(clusterIndexInView(99_999, rail, starts), 2);
  // A trackpad bounce scrolls NEGATIVE. That is still the first cluster.
  assert.equal(clusterIndexInView(-40, rail, starts), 0);
  // An empty board has no cluster in view, and says so rather than answering 0.
  assert.equal(clusterIndexInView(0, rail, []), -1);
});
