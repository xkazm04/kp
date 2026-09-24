// The lifecycle orchestrator, driven over a REAL seeded lifecycle.
//
// `runLifecycle` is the most autonomous thing in the product — it publishes an
// assignment, evaluates strangers' work, puts people on a hiring board and writes to
// them — and it had no behavioural test at all. The only coverage that named it was a
// UI label and a source-string match, so three whole-product properties were unpinned:
//
//   TENANT   eighteen audit rows written with no workspace, i.e. filed in the DEFAULT
//            team. Every autonomous decision a non-default studio's pipeline made was
//            invisible in its own control room and visible in someone else's.
//   LANGUAGE the advance letter was hardcoded English while the case brief, the tasks
//            and the interview scenario all render in `lc.lang`, and it was filed into
//            the outbox with no workspace either — the team that sent it could not see
//            or resend it.
//   STOP     the kill switch and the cancel signal were read ONCE per outer step, and
//            the drain that follows is the longest-running thing here. Pausing did not
//            stop the batch; it stopped the NEXT one.
//
// The two long steps are kept out of the way rather than mocked: a submission with an
// empty repoRef makes runEvaluateSubmission throw before it spawns anything, and an
// evaluation bundle carrying no `transfer` block makes the observed-skills mint decline
// before its subprocess (the transfer SCORE lives on its own column, so ranking and
// promotion are unaffected). What runs is the orchestrator's own control flow, against
// the real store.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import {
  createLifecycle,
  createPosting,
  claimLifecycleClose,
  createSubmission,
  getDevCase,
  getLifecycle,
  listOutbox,
  listPostings,
  saveDevCase,
  saveDevCaseBaselineIfAbsent,
  saveDevCaseScenarioIfAbsent,
  saveDevCaseSeedIfAbsent,
  saveSubmissionEvaluation,
  updateLifecycle,
} from "./db/devcase.ts";
import { ensureDb } from "./db/core.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";
import { listAudit, setAutonomy } from "./dev-control.ts";
import { activePromoteFloor, runLifecycle } from "./devcase-orchestrator.ts";

after(() => cleanupUnitDb());
beforeEach(() => setAutonomy("on"));

const WS = "team-orchestrator";

/** A lifecycle parked at `collecting` with a live posting, in `WS`. */
function collecting(opts: { lang?: string | null; roleTitle?: string } = {}) {
  const kase = saveDevCase({ need: null, analysis: null, role: {}, case: { title: "Ship a rate limiter" } }, WS);
  const posting = createPosting({
    caseId: kase.id,
    channel: "local",
    token: `tok-${Math.random().toString(36).slice(2)}`,
    roleTitle: opts.roleTitle ?? "Backend engineer",
    caseTitle: "Ship a rate limiter",
  });
  const lc = createLifecycle({ title: opts.roleTitle ?? "Backend engineer" }, true, opts.lang ?? "en", WS);
  updateLifecycle(lc.id, { stage: "collecting", caseId: kase.id, postingId: posting.id });
  return { lifecycleId: lc.id, postingId: posting.id, caseId: kase.id };
}

/** A submission whose evaluation is already on file — the drain has nothing to do, so
 *  the walk goes straight through ranking to promotion. The bundle deliberately carries
 *  no `transfer` block: that is the precondition mintObservedFromSubmission declines on,
 *  which keeps its Python spawn out of this test while leaving the transfer SCORE (its
 *  own column) intact for ranking. */
function evaluated(postingId: string, candidateRef: string, score: number) {
  const { submission } = createSubmission({ postingId, candidateRef, repoRef: `https://example.test/${candidateRef}` });
  saveSubmissionEvaluation(
    submission.id,
    { evaluation: { summary: "Solid, well-tested work.", strengths: ["testing"], concerns: [], confidence: 0.9 } },
    score
  );
  return submission;
}

/** The drain's own progress ticks, told apart from the per-stage ones by their message —
 *  `progress` is also called once per outer step with the stage name. */
function onEvaluated(fn: () => void) {
  return (_done: number, _total: number, msg?: string) => {
    if (msg?.startsWith("evaluating")) fn();
  };
}

/** A submission the drain WILL attempt and that fails instantly: no repoRef means
 *  runEvaluateSubmission throws before it reaches the Python spawn. */
function unevaluated(postingId: string, candidateRef: string) {
  return createSubmission({ postingId, candidateRef, repoRef: "" }).submission;
}

test("every audit row an autonomous run writes is filed under the lifecycle's own team", async () => {
  const { lifecycleId, postingId } = collecting();
  evaluated(postingId, "Ada", 88);
  const defaultsBefore = listAudit(200, DEFAULT_WORKSPACE_ID).length;

  const out = await runLifecycle(lifecycleId);
  assert.equal(out.stage, "promoted", "the walk reaches its terminal stage");

  const mine = listAudit(200, WS).filter((r) => r.lifecycleId === lifecycleId);
  assert.ok(mine.length >= 2, "the run's decisions are in THIS team's log");
  assert.deepEqual(
    mine.map((r) => r.action).sort(),
    ["evaluated", "promoted"],
    "both stage decisions, and nothing else, under this tenant"
  );
  // NON-VACUITY: pre-fix every one of these rows carried no workspace, so recordAudit's
  // fallback filed them in the DEFAULT team — this count grew by exactly the same rows.
  assert.equal(
    listAudit(200, DEFAULT_WORKSPACE_ID).filter((r) => r.lifecycleId === lifecycleId).length,
    0,
    "and none of them leaked into the default team's control room"
  );
  assert.equal(listAudit(200, DEFAULT_WORKSPACE_ID).length, defaultsBefore, "the default log did not move at all");
});

test("the advance letter is written in the lifecycle's language and filed under its team", async () => {
  const { lifecycleId, postingId } = collecting({ lang: "cs", roleTitle: "Backend inženýr" });
  const sub = evaluated(postingId, "Bára", 91);

  await runLifecycle(lifecycleId);

  const mine = listOutbox(50, WS).filter((o) => o.kind === "invite" && o.ref === sub.id);
  assert.equal(mine.length, 1, "one advance letter, in this team's outbox");
  const letter = mine[0];
  // NON-VACUITY: pre-fix this read `Next step — Backend inženýr` / `Hi Bára,` in every
  // locale, and the row was in the DEFAULT team's outbox.
  assert.equal(letter.subject, "Další krok: Backend inženýr");
  assert.ok(letter.body?.startsWith("Dobrý den, Bára,"), `Czech greeting, got: ${letter.body?.slice(0, 40)}`);
  assert.ok(letter.body?.includes("(shoda 91/100)"), "the fit score rides in the localized sentence");
  assert.ok(!/Hi |hiring team/.test(letter.body ?? ""), "no English fragment survives");
  assert.equal(
    listOutbox(50, DEFAULT_WORKSPACE_ID).filter((o) => o.ref === letter.ref).length,
    0,
    "the default team never sees another studio's candidate letter"
  );
});

test("an English lifecycle still gets the English letter — the copy moved, the default did not", async () => {
  const { lifecycleId, postingId } = collecting({ lang: "en", roleTitle: "Platform engineer" });
  const sub = evaluated(postingId, "Cyril", 77);

  await runLifecycle(lifecycleId);

  const letter = listOutbox(50, WS).find((o) => o.kind === "invite" && o.ref === sub.id);
  assert.ok(letter, "the letter exists");
  assert.equal(letter.subject, "Next step: Platform engineer");
  assert.ok(letter.body?.includes("(fit 77/100)"));
});

test("pausing mid-drain stops after the submission in flight, not after the batch", async () => {
  const { lifecycleId, postingId } = collecting();
  unevaluated(postingId, "Dana");
  unevaluated(postingId, "Emil");
  unevaluated(postingId, "Filip");

  // The kill switch is thrown while the drain is running — the only way it is ever
  // actually used. `progress` fires once per finished submission.
  let finished = 0;
  const out = await runLifecycle(lifecycleId, onEvaluated(() => {
    finished += 1;
    if (finished === 1) setAutonomy("paused");
  }));

  // NON-VACUITY: pre-fix autonomy was read once, before the loop, so all three were
  // attempted and the lifecycle advanced to `ranked` despite the pause.
  assert.equal(finished, 1, "the submission in flight finishes; the next one does not start");
  assert.match(out.detail, /halted/);
  assert.equal(out.stage, "collecting");
  assert.equal(getLifecycle(lifecycleId)?.stage, "collecting", "a paused run advances nothing");
  const halted = listAudit(200, WS).filter((r) => r.lifecycleId === lifecycleId && r.action === "halted");
  assert.equal(halted.length, 1, "one halt, recorded where it happened");
  assert.match(halted[0].reason ?? "", /mid-drain/, "the audit row says WHERE it stopped");
});

test("a cancel signal mid-drain stops the batch the same way, without an audit row", async () => {
  const { lifecycleId, postingId } = collecting();
  unevaluated(postingId, "Gita");
  unevaluated(postingId, "Hugo");
  const controller = new AbortController();

  let finished = 0;
  const out = await runLifecycle(lifecycleId, onEvaluated(() => {
    finished += 1;
    controller.abort();
  }), controller.signal);

  assert.equal(finished, 1, "the abort is honoured before the second submission");
  assert.match(out.detail, /canceled/);
  assert.equal(getLifecycle(lifecycleId)?.stage, "collecting");
});

test("a failing evaluation is recorded per submission and never blocks the batch", async () => {
  const { lifecycleId, postingId } = collecting();
  const iva = unevaluated(postingId, "Iva");
  const jan = unevaluated(postingId, "Jan");

  const out = await runLifecycle(lifecycleId);

  // Both failed, so nothing is promotable — but the walk still completes rather than
  // parking forever, and each failure is auditable under THIS team.
  assert.equal(out.stage, "promoted");
  const failures = listAudit(200, WS).filter((r) => r.lifecycleId === lifecycleId && r.action === "eval_failed");
  assert.equal(failures.length, 2);
  const refs = new Set([iva.id, jan.id]);
  assert.equal(listOutbox(50, WS).filter((o) => refs.has(o.ref ?? "")).length, 0, "nobody is told they advanced");
});

test("a lifecycle already at a terminal stage is reported, not re-driven", async () => {
  const { lifecycleId } = collecting();
  updateLifecycle(lifecycleId, { stage: "closed", detail: "closed by a human" });

  const out = await runLifecycle(lifecycleId);

  assert.equal(out.stage, "closed");
  assert.equal(out.detail, "closed by a human");
  assert.equal(listAudit(200, WS).filter((r) => r.lifecycleId === lifecycleId).length, 0, "no decisions were made");
});

test("freeze-at-publish is idempotent: a resumed `approved` run never re-mints the assignment", async () => {
  // The freeze boundary is the live token. Once `postingId` is set, the whole
  // materialize-and-publish block is skipped on ANY resume — otherwise a re-enqueued
  // run would re-run the (non-deterministic) LLM and swap the seed, the interview
  // scenario and the submit channel under candidates already working on the case.
  // A separate team keeps the sourcing pool empty, so runSourceForRole returns before
  // its subprocess and what this exercises is the resume path itself.
  const WS_FREEZE = "team-orchestrator-freeze";
  const kase = saveDevCase(
    { need: null, analysis: null, role: {}, case: { title: "Frozen case" } },
    WS_FREEZE
  );
  saveDevCaseScenarioIfAbsent(kase.id, { probes: ["the frozen probe"], source: "llm" });
  saveDevCaseSeedIfAbsent(kase.id, { files: [{ path: "src/index.ts", contents: "// frozen" }], source: "llm" });
  const posting = createPosting({
    caseId: kase.id,
    channel: "local",
    token: "tok-frozen",
    roleTitle: "Frozen role",
    caseTitle: "Frozen case",
  });
  const lc = createLifecycle({ title: "Frozen role" }, true, "en", WS_FREEZE);
  updateLifecycle(lc.id, { stage: "approved", caseId: kase.id, postingId: posting.id });

  const out = await runLifecycle(lc.id);

  assert.equal(out.stage, "collecting", "the resume advances past publishing");
  assert.equal(out.detail, "awaiting submissions", "…and parks, because nobody has submitted");
  assert.equal(getLifecycle(lc.id)?.postingId, posting.id, "the live token is not re-minted");
  const after = getDevCase(kase.id);
  assert.deepEqual((after?.scenario as { probes: string[] }).probes, ["the frozen probe"], "the scenario is untouched");
  assert.deepEqual(
    (after?.seed as { files: { path: string }[] }).files.map((f) => f.path),
    ["src/index.ts"],
    "…and so is the materialized seed"
  );
  // Nothing about the resume is recorded as a fresh generation.
  const actions = listAudit(200, WS_FREEZE).filter((r) => r.lifecycleId === lc.id).map((r) => r.action);
  assert.ok(!actions.includes("interview_scenario"), "no scenario was regenerated");
  assert.ok(!actions.includes("seed_materialized"), "no seed was regenerated");
  assert.deepEqual(actions, ["published"], "one row: the publish that resumed");
});

// --- The fence (devcase-lifecycle-fence.ts): a human close lands while the runner works. ---
// The close is the real claim the close route makes (claimLifecycleClose), fired from the
// runner's own progress ticks, i.e. between two of its effects.

function entriesForCase(caseId: string): number {
  const row = ensureDb().prepare(`SELECT COUNT(*) AS n FROM pipeline_entries WHERE dev_case_id = ?`).get(caseId) as { n: number };
  return Number(row.n);
}

test("a close during the promote loop stops the next promotion and its advance letter", async () => {
  const { lifecycleId, postingId, caseId } = collecting();
  const ids = new Set([
    evaluated(postingId, "Karel", 90).id,
    evaluated(postingId, "Lenka", 85).id,
    evaluated(postingId, "Milan", 80).id,
  ]);

  let ticks = 0;
  const out = await runLifecycle(lifecycleId, (_d, _t, msg) => {
    if (!msg?.startsWith("promoting")) return;
    ticks += 1;
    if (ticks === 1) claimLifecycleClose(lifecycleId);
  });

  assert.equal(out.stage, "closed", "the run reports where the lifecycle is, not where it was");
  assert.equal(getLifecycle(lifecycleId)?.stage, "closed");
  const invites = listOutbox(50, WS).filter((o) => o.kind === "invite" && ids.has(o.ref ?? ""));
  assert.equal(invites.length, 1, "only the candidate promoted before the close was told they advanced");
  assert.equal(entriesForCase(caseId), 1, "no board write after the close");
  const stopped = listAudit(200, WS).filter((r) => r.lifecycleId === lifecycleId && r.action === "stage_moved");
  assert.equal(stopped.length, 1, "the stop is audited");
  assert.match(stopped[0].reason ?? "", /'ranked' to 'closed'/);
});

test("a close during the collecting drain stops the next evaluation", async () => {
  const { lifecycleId, postingId } = collecting();
  unevaluated(postingId, "Nina");
  unevaluated(postingId, "Oto");
  unevaluated(postingId, "Petr");

  let finished = 0;
  const out = await runLifecycle(lifecycleId, onEvaluated(() => {
    finished += 1;
    if (finished === 1) claimLifecycleClose(lifecycleId);
  }));

  assert.equal(finished, 1, "the second and third submissions are never attempted");
  assert.equal(out.stage, "closed");
  assert.equal(getLifecycle(lifecycleId)?.stage, "closed");
  const actions = listAudit(200, WS).filter((r) => r.lifecycleId === lifecycleId).map((r) => r.action);
  assert.ok(!actions.includes("evaluated"), "no evaluation decision is recorded for a closed lifecycle");
});

test("a close while publishing mints no live posting and sources nobody", async () => {
  // A separate team keeps the sourcing pool empty, and the frozen scenario/seed/baseline
  // mean no generation spawns: what runs is the publish step itself.
  const WS_PUB = "team-orchestrator-publish";
  const kase = saveDevCase({ need: null, analysis: null, role: {}, case: { title: "Publish race" } }, WS_PUB);
  saveDevCaseScenarioIfAbsent(kase.id, { probes: ["p"], source: "llm" });
  saveDevCaseSeedIfAbsent(kase.id, { files: [{ path: "src/a.ts", contents: "// a" }], source: "llm" });
  saveDevCaseBaselineIfAbsent(kase.id, { solutions: [], source: "llm" });
  const lc = createLifecycle({ title: "Publish race" }, true, "en", WS_PUB);
  updateLifecycle(lc.id, { stage: "approved", caseId: kase.id });

  const out = await runLifecycle(lc.id, (_d, _t, msg) => {
    if (msg === "publishing") claimLifecycleClose(lc.id);
  });

  assert.equal(out.stage, "closed");
  const open = listPostings(WS_PUB).filter((p) => p.caseId === kase.id && p.status === "open");
  assert.equal(open.length, 0, "no open apply token is left behind a closed lifecycle");
  assert.equal(getLifecycle(lc.id)?.postingId ?? null, null, "no posting is linked");
  assert.equal(entriesForCase(kase.id), 0, "nobody was sourced onto the board");
});

// --- The coded run outcome (devcase-stage-outcome.ts, challenge-r07 devcase-orchestration/B). ---
// Beside every English `detail` the runner writes a closed code, integer facts and coded
// warnings, so the row can render the run in the reader's language and offer each fix.

function evaluatedWithConfidence(postingId: string, candidateRef: string, score: number, confidence: number) {
  const { submission } = createSubmission({ postingId, candidateRef, repoRef: `https://example.test/${candidateRef}` });
  saveSubmissionEvaluation(
    submission.id,
    { evaluation: { summary: "Thin evidence.", strengths: [], concerns: [], confidence } },
    score
  );
  return submission;
}

test("outcome: the ranked stage stores promoted N of topN at the active floor, with the held count as a warning", async () => {
  const { lifecycleId, postingId } = collecting();
  evaluatedWithConfidence(postingId, "Quido", 90, 0.2);

  await runLifecycle(lifecycleId);

  assert.deepEqual(getLifecycle(lifecycleId)?.outcome, {
    code: "promoted",
    facts: { promoted: 1, topN: 3, floor: activePromoteFloor() },
    warnings: [{ code: "held", count: 1 }],
  });
});

test("outcome: a drain whose evaluations throw stores eval_failed with the count, and zero evaluated", async () => {
  const { lifecycleId, postingId } = collecting();
  unevaluated(postingId, "Radek");
  unevaluated(postingId, "Sona");

  // The drain's write is read at the next step's tick, before ranking replaces it.
  let atRanked: unknown = undefined;
  await runLifecycle(lifecycleId, (_d, _t, msg) => {
    if (msg === "ranked") atRanked = getLifecycle(lifecycleId)?.outcome;
  });

  const o = atRanked as { code: string; facts: Record<string, number>; warnings: unknown[] };
  assert.equal(o.code, "evaluated");
  assert.equal(o.facts.evaluated, 0);
  assert.deepEqual(o.warnings, [{ code: "eval_failed", count: 2 }]);
  // The failures stay visible on the terminal row: ranking carries them forward.
  assert.deepEqual(getLifecycle(lifecycleId)?.outcome?.warnings, [{ code: "eval_failed", count: 2 }]);
});

test("outcome: a pause mid-drain stores halted with what was done; a cancel stores canceled", async () => {
  const paused = collecting();
  unevaluated(paused.postingId, "Tomas");
  unevaluated(paused.postingId, "Ursula");
  let finished = 0;
  await runLifecycle(paused.lifecycleId, onEvaluated(() => {
    finished += 1;
    if (finished === 1) setAutonomy("paused");
  }));
  assert.deepEqual(getLifecycle(paused.lifecycleId)?.outcome, {
    code: "halted",
    facts: { evaluated: 0 },
    warnings: [{ code: "eval_failed", count: 1 }],
  });

  setAutonomy("on");
  const canceled = collecting();
  unevaluated(canceled.postingId, "Vera");
  unevaluated(canceled.postingId, "Waldemar");
  const controller = new AbortController();
  await runLifecycle(canceled.lifecycleId, onEvaluated(() => controller.abort()), controller.signal);
  assert.equal(getLifecycle(canceled.lifecycleId)?.outcome?.code, "canceled");
});

test("outcome: the store round-trips it, and a patch without one leaves it alone", () => {
  const { lifecycleId } = collecting();
  const outcome = {
    code: "collecting_open" as const,
    facts: { sourced: 0, skipped: 2 },
    warnings: [{ code: "sourcing_failed" as const, count: 1 }, { code: "seed_skeleton_only" as const, count: 1 }],
  };
  updateLifecycle(lifecycleId, { outcome, detail: "published; sourcing failed" });
  assert.deepEqual(getLifecycle(lifecycleId)?.outcome, outcome);
  updateLifecycle(lifecycleId, { detail: "something else" });
  assert.deepEqual(getLifecycle(lifecycleId)?.outcome, outcome, "untouched by a detail-only patch");
  assert.equal(getLifecycle(lifecycleId)?.detail, "something else");
});

// --- One cohort ranking (devcase-cohort-rank.ts, challenge-r10 devcase-detail/A). ---
// The ranked stage used to promote by the raw transfer number whatever instrument made
// it. A keyless TEMPLATE transfer (a per-call LLM fallback) is not comparable with a
// graded one, so in a mixed cohort the template row is withheld from auto-promotion -
// no board write, no advance letter - and the outcome says how many were withheld.

function evaluatedWithCurrency(postingId: string, candidateRef: string, score: number, transfer: "llm" | "deterministic") {
  const { submission } = createSubmission({ postingId, candidateRef, repoRef: `https://example.test/${candidateRef}` });
  saveSubmissionEvaluation(
    submission.id,
    {
      evaluation: { summary: "Solid, well-tested work.", strengths: ["testing"], concerns: [], confidence: 0.9 },
      source: transfer === "llm" ? "llm" : "deterministic",
      perStepSources: { reflect: transfer, tooling: transfer, evaluate: transfer, transfer },
    },
    score
  );
  return submission;
}

function entryForSubmission(submissionId: string): number {
  const row = ensureDb().prepare(`SELECT COUNT(*) AS n FROM pipeline_entries WHERE dev_submission_id = ?`).get(submissionId) as { n: number };
  return Number(row.n);
}

test("ranking: a mixed cohort auto-promotes the graded submission only and records mixed_currency", async () => {
  const { lifecycleId, postingId } = collecting();
  const graded = evaluatedWithCurrency(postingId, "Greta", 72, "llm");
  const tpl = evaluatedWithCurrency(postingId, "Tobias", 85, "deterministic");
  assert.ok(activePromoteFloor() <= 72, "fixture assumes the default floor");

  const out = await runLifecycle(lifecycleId);
  assert.equal(out.stage, "promoted");

  assert.equal(entryForSubmission(graded.id), 1, "the graded submission is on the board");
  assert.equal(entryForSubmission(tpl.id), 0, "the template 85 is not promoted over a graded 72");
  const invites = listOutbox(50, WS).filter((o) => o.kind === "invite");
  assert.equal(invites.filter((o) => o.ref === tpl.id).length, 0, "and gets no advance letter");
  assert.equal(invites.filter((o) => o.ref === graded.id).length, 1);

  const outcome = getLifecycle(lifecycleId)?.outcome;
  assert.equal(outcome?.facts.promoted, 1);
  assert.deepEqual(
    outcome?.warnings.filter((w) => w.code === "mixed_currency"),
    [{ code: "mixed_currency", count: 1 }]
  );
});

test("ranking: an all-template (keyless) cohort promotes as before, with no mixed_currency warning", async () => {
  const { lifecycleId, postingId } = collecting();
  const a = evaluatedWithCurrency(postingId, "Hana", 85, "deterministic");
  const b = evaluatedWithCurrency(postingId, "Ivo", 75, "deterministic");

  await runLifecycle(lifecycleId);

  assert.equal(entryForSubmission(a.id), 1);
  assert.equal(entryForSubmission(b.id), 1);
  const outcome = getLifecycle(lifecycleId)?.outcome;
  assert.equal(outcome?.facts.promoted, 2);
  assert.equal(outcome?.warnings.some((w) => w.code === "mixed_currency"), false);
});
