import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The job modal's lifecycle strip counts this role's OFFERS OUT and HIRES and
// deep-links the board at those columns. Both used to read stage NAMES —
// `e.stage === "Offer"`, `e.stage === "Hired"`, and the same two literals as the
// `?stage=` deep-link value. The board's axis is workspace data (Settings →
// Hiring composes it; GET /api/pipeline answers with the resolved `stages`), so
// on a renamed axis both counts read 0: the two segments vanished from a role
// that genuinely had live offers and hires, and the link that did render carried
// an id the workspace's own board resolves as off-board.
//
// Same shape of guard as pipelineStageFilter.test.ts' TAB_STATE block: a .tsx has
// no runner here, so this pins the SOURCE — the counts must resolve roles through
// pipeline-stages.ts, against the axis that arrived with the entries.
const SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "JobsLifecycleStrip.tsx"),
  "utf8"
);

test("the lifecycle strip never derives a count or a deep link from a stage NAME", () => {
  for (const literal of ['stage === "Offer"', 'stage === "Hired"', 'stage: "Offer"', 'stage: "Hired"']) {
    assert.equal(
      SRC.includes(literal),
      false,
      `JobsLifecycleStrip must not read the literal \`${literal}\` — the board's axis is workspace-editable`
    );
  }
});

test("offers and hires resolve through stage ROLES, against the axis the API sent", () => {
  assert.match(SRC, /stageHasRole\(e\.stage, "offer", axis\)/, "the offers count must ask for the offer ROLE");
  assert.match(SRC, /stageHasRole\(e\.stage, "terminal", axis\)/, "the hires count must ask for the terminal ROLE");
  // The axis is the WORKSPACE's own (from the same /api/pipeline payload as the
  // entries), with the shipped one only as the not-yet-loaded fallback.
  assert.match(SRC, /axisStages \?\? DEFAULT_STAGE_AXIS/, "the shipped axis is the fallback, not the authority");
  assert.match(SRC, /setAxisStages\(p\.stages\)/, "the axis must be read off the pipeline payload");
});

test("a deep link spends the resolved stage id, and is withheld when the axis has no such column", () => {
  assert.match(SRC, /stage: offerStage/, "the offers link must carry the axis's own offer id");
  assert.match(SRC, /stage: terminalStage/, "the hires link must carry the axis's own terminal id");
  // stageWithRole returns null for an axis that dropped the column — linking the
  // board at a stage it does not render would silently answer a different question.
  assert.match(SRC, /offersOut > 0 && offerStage/, "no offer column ⟹ no offers segment");
  assert.match(SRC, /hired > 0 && terminalStage/, "no terminal column ⟹ no hired segment");
});
