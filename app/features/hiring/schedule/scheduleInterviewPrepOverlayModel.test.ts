// What the prep modal's kit section shows (spark interview-kit-template, WP-C): which
// questions come from the kit, which from the candidate's CV, which the recruiter
// changed — and whether each is actually asked. Plus the overlay's edit operations.
// (That the "asked" rows match the real agenda is pinned end to end in
// app/_lib/interview-kit-overlay.test.ts; this file pins the arrangement and the edits.)
import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_KIT_OVERLAY, KIT_MAX_MUST_ASKS, type InterviewKit, type KitOverlay } from "../../../_lib/interview-kit-types.ts";
import { KIT_OVERLAY_CV_PROBES_ASKED, KIT_OVERLAY_MAX_ADDED, kitProbeId } from "../../../_lib/interview-kit-overlay.ts";
import {
  canAddToOverlay,
  canMarkAddedMustAsk,
  composeOverlayView,
  overlayAdd,
  overlayDrop,
  overlayEdit,
  overlayPatchAdded,
  overlayPruneStale,
  overlayRemoveAdded,
  overlayRestore,
  overlayRevert,
  type OverlayView,
} from "./scheduleInterviewPrepOverlayModel.ts";

const KIT: InterviewKit = {
  version: 1,
  competencies: [
    {
      id: "c-strategy",
      title: "Test strategy",
      weight: 3,
      budgetMin: 6,
      questions: [
        { id: "q-first", text: "How do you decide what to automate first?", mustAsk: true },
        { id: "q-healthy", text: "What does a healthy suite look like to you?", mustAsk: false },
      ],
    },
    { id: "c-collab", title: "Collaboration", weight: 1, budgetMin: 4, questions: [{ id: "q-disagree", text: "Tell me about a disagreement.", mustAsk: true }] },
  ],
  faq: [],
};

const PREP = {
  importedQuestions: ["What did you ship last quarter?", { question: "How do you review a PR?", blockRef: "Depth" }],
  chronology: [
    { topic: "Intro", questions: [] },
    { topic: "Depth", questions: ["How do you decide what to automate first?", "Walk me through your flakiest test."], followUp: "What did it cost?" },
    { topic: "Tooling", questions: ["Which runner did you replace?"] },
  ],
};

const ov = (o: Partial<KitOverlay>): KitOverlay => ({ ...EMPTY_KIT_OVERLAY, ...o });
const rows = (view: OverlayView, kind: string) => view.groups.filter((g) => g.kind === kind).flatMap((g) => g.rows);
let n = 0;
const mint = () => `ov-${++n}`;

test("with no overlay: every kit question is 'kit' and kept, the CV probes are 'cv', the cap marks who rides", () => {
  const view = composeOverlayView(KIT, PREP, EMPTY_KIT_OVERLAY, { cvProbesRide: true });
  assert.deepEqual(view.groups.map((g) => g.kind), ["competency", "competency", "cv"]);
  assert.deepEqual(view.groups[0].rows.map((r) => [r.origin, r.state, r.asked]), [
    ["kit", "kept", true],
    ["kit", "kept", true],
  ]);
  const cv = rows(view, "cv");
  // Imports first, then the plan; the plan's copy of a kit question is not repeated.
  assert.deepEqual(cv.map((r) => r.text), [
    "What did you ship last quarter?",
    "How do you review a PR?",
    "Walk me through your flakiest test.",
    "What did it cost?",
    "Which runner did you replace?",
  ]);
  assert.deepEqual(cv.map((r) => r.asked), [true, true, true, false, false], `only the first ${KIT_OVERLAY_CV_PROBES_ASKED} ride`);
  assert.ok(cv.every((r) => r.origin === "cv" && r.id === kitProbeId(r.text)), "a CV row is addressed by the agenda's own probe id");
  assert.equal(view.keptKitMustAsks, 2);
  assert.equal(view.staleRefs, 0);
});

test("the recruiter's changes are marked as theirs, and move what is asked", () => {
  const overlay = ov({
    dropped: ["q-first", kitProbeId("What did you ship last quarter?")],
    edited: [{ id: "q-healthy", text: "What does a suite you trust look like?" }],
    added: [
      { id: "ov-a", competencyId: "c-collab", text: "Who do you pair with?", mustAsk: false },
      { id: "ov-b", competencyId: null, text: "What is your notice period?", mustAsk: true },
    ],
  });
  const view = composeOverlayView(KIT, PREP, overlay, { cvProbesRide: true });
  assert.deepEqual(view.groups.map((g) => g.kind), ["competency", "competency", "loose", "cv"], "loose additions come before the probes, as in the agenda");
  const [first, healthy] = view.groups[0].rows;
  assert.deepEqual([first.state, first.asked], ["dropped", false]);
  assert.deepEqual([healthy.state, healthy.text, healthy.original], ["edited", "What does a suite you trust look like?", "What does a healthy suite look like to you?"]);
  assert.deepEqual(view.groups[1].rows.map((r) => [r.origin, r.text]), [
    ["kit", "Tell me about a disagreement."],
    ["added", "Who do you pair with?"],
  ]);
  assert.deepEqual(view.groups[2].rows.map((r) => [r.origin, r.mustAsk]), [["added", true]]);
  // The dropped import frees its slot, and the dropped KIT question no longer suppresses
  // the plan's copy of it — which is now a probe of its own and moves into the cap.
  const cv = rows(view, "cv");
  assert.equal(cv[0].state, "dropped");
  assert.deepEqual(cv.filter((r) => r.asked).map((r) => r.text), [
    "How do you review a PR?",
    "How do you decide what to automate first?",
    "Walk me through your flakiest test.",
  ]);
  // Dropping a kit must-ask withdraws it from this candidate's budget.
  assert.equal(view.keptKitMustAsks, 1);
});

test("a dropped kit question no longer hides the plan's copy of it; an addition does", () => {
  const dropped = composeOverlayView(KIT, PREP, ov({ dropped: ["q-first"] }), { cvProbesRide: true });
  assert.ok(rows(dropped, "cv").some((r) => r.text === "How do you decide what to automate first?"));
  const added = composeOverlayView(
    KIT,
    PREP,
    ov({ added: [{ id: "ov-x", competencyId: null, text: "Which runner did you replace?", mustAsk: false }] }),
    { cvProbesRide: true }
  );
  assert.ok(!rows(added, "cv").some((r) => r.text === "Which runner did you replace?"));
});

test("when this candidate's branch takes no CV probes, the group is hidden but edits to it stay live", () => {
  const overlay = ov({ dropped: [kitProbeId("Walk me through your flakiest test.")] });
  const view = composeOverlayView(KIT, PREP, overlay, { cvProbesRide: false });
  assert.deepEqual(view.groups.map((g) => g.kind), ["competency", "competency"]);
  assert.equal(view.staleRefs, 0, "not stale: it applies again the moment the branch does");
  assert.ok(view.liveIds.has(kitProbeId("Walk me through your flakiest test.")));
});

test("drops and rewrites that match nothing are counted as stale and can be pruned", () => {
  const overlay = ov({ dropped: ["q-gone", "q-first"], edited: [{ id: "cv-00000000", text: "Old probe" }] });
  const view = composeOverlayView(KIT, PREP, overlay, { cvProbesRide: true });
  assert.equal(view.staleRefs, 2);
  const pruned = overlayPruneStale(overlay, view);
  assert.deepEqual(pruned, ov({ dropped: ["q-first"] }));
  assert.equal(overlayPruneStale(pruned, composeOverlayView(KIT, PREP, pruned, { cvProbesRide: true })), pruned, "nothing to prune is a no-op");
});

// ---- the edit operations ----------------------------------------------------------------

test("drop and restore", () => {
  const dropped = overlayDrop(EMPTY_KIT_OVERLAY, "q-first");
  assert.deepEqual(dropped.dropped, ["q-first"]);
  assert.equal(overlayDrop(dropped, "q-first"), dropped, "dropping twice is a no-op");
  assert.deepEqual(overlayRestore(dropped, "q-first"), EMPTY_KIT_OVERLAY);
  // A rewrite survives a drop, so restoring brings the rewrite back.
  const rewritten = overlayEdit(EMPTY_KIT_OVERLAY, "q-first", "Rewritten?", "How do you decide what to automate first?");
  const view = composeOverlayView(KIT, PREP, overlayRestore(overlayDrop(rewritten, "q-first"), "q-first"), { cvProbesRide: true });
  assert.equal(view.groups[0].rows[0].text, "Rewritten?");
});

test("rewrite: storing, replacing, and clearing by rewriting back to the original", () => {
  const original = "How do you decide what to automate first?";
  let o = overlayEdit(EMPTY_KIT_OVERLAY, "q-first", "  What would you automate on day one?  ", original);
  assert.deepEqual(o.edited, [{ id: "q-first", text: "What would you automate on day one?" }]);
  o = overlayEdit(o, "q-first", "And on day two?", original);
  assert.deepEqual(o.edited, [{ id: "q-first", text: "And on day two?" }], "replaced in place, never duplicated");
  assert.deepEqual(overlayEdit(o, "q-first", original, original).edited, [], "back to the original is no rewrite at all");
  assert.deepEqual(overlayEdit(o, "q-first", "   ", original).edited, [], "a blank rewrite clears rather than stores");
  assert.deepEqual(overlayRevert(o, "q-first").edited, []);
});

test("add, rewrite, re-flag and delete a question of the recruiter's own", () => {
  let o = overlayAdd(EMPTY_KIT_OVERLAY, { competencyId: "c-collab", text: "  Who do you pair with?  ", mustAsk: false }, mint);
  assert.equal(o.added.length, 1);
  const id = o.added[0].id;
  assert.equal(o.added[0].text, "Who do you pair with?");
  assert.equal(overlayAdd(o, { competencyId: null, text: "   ", mustAsk: false }, mint), o, "a blank question is not added");
  o = overlayPatchAdded(o, id, { text: "Who do you pair with most?", mustAsk: true });
  assert.deepEqual([o.added[0].text, o.added[0].mustAsk], ["Who do you pair with most?", true]);
  assert.equal(overlayPatchAdded(o, id, { text: " " }), o, "blanking an addition is not how it is removed");
  assert.deepEqual(overlayRemoveAdded(o, id).added, []);
});

test("the addition cap and the kit-wide must-ask budget", () => {
  let o: KitOverlay = EMPTY_KIT_OVERLAY;
  for (let i = 0; i < KIT_OVERLAY_MAX_ADDED + 2; i += 1) o = overlayAdd(o, { competencyId: null, text: `Q${i}?`, mustAsk: false }, mint);
  assert.equal(o.added.length, KIT_OVERLAY_MAX_ADDED);
  assert.equal(canAddToOverlay(o), false);

  // The kit keeps 2 must-asks for this candidate; the recruiter may add up to the cap.
  let m: KitOverlay = EMPTY_KIT_OVERLAY;
  for (let i = 0; i < KIT_MAX_MUST_ASKS - 2; i += 1) m = overlayAdd(m, { competencyId: null, text: `Must ${i}?`, mustAsk: true }, mint);
  assert.equal(canMarkAddedMustAsk(m, 2), false, "the budget is spent");
  assert.equal(canMarkAddedMustAsk(m, 2, m.added[0].id), true, "an already-required addition may stay required");
  assert.equal(canMarkAddedMustAsk(m, 1), true, "dropping a kit must-ask frees a slot");
});
