// Pipeline parity on the kit (kit-unification spark, builder Q): the promotion commit b7fde0c32
// deleted the old board view, and with it capabilities the kit view never had. The owner's decision
// was "port them into the kit". The LOGIC each capability runs on is pinned where it lives (the pure
// modules and their own tests); this file pins the WIRING, so a later edit to the kit view cannot
// quietly drop a capability again the way the promotion did.
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

test("the list honours the board's URL filters: search, ?stage=, ?quick=, ?band=, ?source=, ?sort=", () => {
  const src = read("usePipelineKit.ts");
  assert.match(src, /entryMatchesFilters\(e, \{ query, quicks, scoreBands, sources, stage: stageFilter \}/);
  assert.match(src, /sortFilteredEntries\(listRows\(/, "the chosen sort reorders the kit list");
  assert.doesNotMatch(src, /NO_QUICKS|NO_BANDS|NO_SOURCES/, "the kit list must not blank the facets out again");
});

test("the four facets (State, Score, Source, Sort) are kit Menus over the URL-synced filter state", () => {
  const src = read("PipelineKitFacets.tsx");
  for (const call of [/s\.toggleQuick\(/, /s\.toggleBand\(/, /s\.toggleSource/, /s\.setSortAndSync\(/, /s\.clearStageFilter\(\)/]) assert.match(src, call);
  assert.equal((src.match(/<Menu\b/g) ?? []).length, 4);
  assert.match(src, /filterIntake/, "the needs-intake cohort (the old attention strip's first row) has its chip");
});

test("a stale ?stage= link says the stage is no longer a column, and offers the way out", () => {
  const src = read("PipelineKitHead.tsx");
  assert.match(src, /resolveStageFilter\(/);
  assert.match(src, /stageOffBoard/);
  assert.match(src, /useSlashSearch\(\)/, "`/` focuses the search, as it did on the board");
});

test("an armed bulk confirm is stamped with the kit's own narrowing too", () => {
  const view = read("PipelineKitView.tsx");
  assert.match(view, /useKitFilters\(\);\s*const s = usePipelineTabState\(\{ scope: f\.scope \}\)/);
  const tab = readFileSync(new URL("../usePipelineTabState.ts", import.meta.url), "utf8");
  assert.match(tab, /visibleScope: scope \? `\$\{visibleScope\}\|\$\{scope\}` : visibleScope/);
});

test("saved views: apply, default, rename, copy link, delete, save; the dialog warns before an overwrite", () => {
  const views = read("PipelineKitViews.tsx");
  for (const call of ["s.applyView(", "s.toggleDefaultView(", "s.openRenameView(", "s.copyViewLink(", "s.deleteView(", "s.openSaveView"]) assert.ok(views.includes(call), call);
  const dialog = read("PipelineKitViewDialog.tsx");
  assert.match(dialog, /nameCollides\(/);
  assert.match(dialog, /viewNameOverwrite/);
});

test("the SLA editor writes the TEAM cadence on blur or Enter, clamped, and offers the browser's leftovers", () => {
  const src = read("PipelineKitSla.tsx");
  assert.match(src, /clampSlaDays\(raw\)/);
  assert.match(src, /onBlur=\{\(ev\) => commit\(st, ev\.target\.value\)\}/);
  assert.doesNotMatch(src, /onChange=\{/, "never a policy write per keystroke");
  assert.match(src, /s\.adoptLocalSla/);
  assert.match(src, /st\.role !== "terminal"/, "a hired candidate has no clock");
});

test("select mode: a row is a checkbox, select-all acts on the KIT list's rows, the bar states the over-reach", () => {
  const list = read("PipelineKitList.tsx");
  assert.match(list, /if \(e\) s\.toggleSelected\(e\);\s*else k\.select\(id\);/, "in select mode a row click toggles, nothing opens");
  assert.match(list, /<PipelineKitBulk s=\{s\} k=\{k\} \/>/);
  const bar = read("PipelineKitBulk.tsx");
  assert.match(bar, /const shown = k\.rows\.map\(\(e\) => e\.id\)/);
  assert.match(bar, /toggleAll\(cur, shown\)/);
  assert.match(bar, /selectedOutsideFilter/);
});

test("the bulk actions keep their confirms: move previews first, outreach arms when a relay would send, reject arms", () => {
  const bar = read("PipelineKitBulk.tsx");
  assert.match(bar, /bulkMoveTargetStages\(s\.axis\)/, "only stages a manual move can reach");
  assert.match(bar, /bulkMoveConfirm/);
  assert.match(bar, /s\.relayConfigured !== false && !outreachArmed\) s\.dispatchBulkConfirm\(\{ type: "arm", which: "outreach" \}\)/);
  const detail = read("PipelineKitBulkDetail.tsx");
  assert.match(detail, /dispatchBulkConfirm\(\{ type: "arm", which: "reject" \}\)/);
  assert.match(detail, /capabilityAwareReason\(/, "a refusal is read from its CODE in the reader's language");
  for (const k of ["selectionDeparted", "bulkMoveOfferHeld", "bulkInvitedQueued", "bulkDraftedQueued"]) assert.ok(detail.includes(k), k);
});

test("stage moves replace the drag: a Move menu in the pane (and `m`) and on the row, through the board's moveEntry", () => {
  const move = read("PipelineKitMove.tsx");
  assert.match(move, /onSelect=\{\(to\) => void s\.moveEntry\(entry, to\)\}/, "the board's optimistic, CAS-guarded move");
  assert.match(move, /moveOptions\(entry\.stage, s\.axis/);
  assert.match(move, /e\.key !== "m"/);
  assert.match(read("PipelineKitPane.tsx"), /<PipelineKitMove s=\{s\} entry=\{entry\} where="pane" hotkey \/>/);
  assert.match(read("PipelineKitCells.tsx"), /<PipelineKitMove s=\{s\} entry=\{e\} where="row" \/>/);
});

test("a refused move is stated: the bounce mark on its row, a note in its pane or above the list, a dismiss", () => {
  assert.match(read("PipelineKitCells.tsx"), /s\.moveErrorEntryId === e\.id && s\.moveError\) return <Mark kind="bounce" tip=\{s\.moveError\} \/>/);
  for (const f of ["PipelineKitPane.tsx", "PipelineKitList.tsx"]) assert.match(read(f), /s\.dismissMoveError/);
});

test("stranded candidates: named per retired column, with Move all to", () => {
  const src = read("PipelineKitOffBoard.tsx");
  assert.match(src, /strandedByStage\(/);
  assert.match(src, /for \(const e of stranded\) void s\.moveEntry\(e, to\)/);
  assert.match(read("PipelineKitView.tsx"), /<PipelineKitOffBoard s=\{s\} \/>/);
});

test("a picked role gets the Subway row's doors: open job, rank candidates, accept/reject all (armed), AI evaluate", () => {
  const src = read("PipelineKitRole.tsx");
  for (const call of ["s.openJob(", "s.openPositionRanking(", "postPipelineBatch(entryBatchItems(", 'startTask("batch_screen"']) assert.ok(src.includes(call), call);
  assert.match(src, /armed === role \? void batch\("rejectAll"\) : setArmed\(role\)/);
});

test("the exit layer lists the rejected shelf, where and by whom", () => {
  assert.match(read("usePipelineKit.ts"), /useRejectedShelf\(layer === OUT/);
  assert.match(read("useRejectedShelf.ts"), /\/api\/pipeline\/rejected\?lane=/);
  assert.match(read("PipelineKitCells.tsx"), /rejectedAtByAi/);
});
