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
  createSubmission,
  getLifecycle,
  listOutbox,
  saveDevCase,
  saveSubmissionEvaluation,
  updateLifecycle,
} from "./db/devcase.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";
import { listAudit, setAutonomy } from "./dev-control.ts";
import { runLifecycle } from "./devcase-orchestrator.ts";

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
