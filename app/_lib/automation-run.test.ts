// BEHAVIOURAL COVER FOR automation-run.ts — the module that holds every side effect
// in the automation context (the screen CAS, the unattended auto-ratify, the
// unattended offer extension, the outreach single-flight) and, until this file, had
// no test of its own: four suites read its SOURCE, none of them ran it.
//
// HOW IT RUNS WITHOUT PYTHON. The established idiom (reasoning-cache-first.test.ts):
// a bogus PYTHON_CMD makes any spawn fail fast, and a prompt-cache row seeded at the
// EXACT key runAutomationTask computes turns every case below into a cache HIT. So
// the model hop is skipped while the whole post-verdict half — approvals, events,
// gates, CAS — executes for real against an isolated SQLite file. A key reconstructed
// from the same primitives, never a hand-forged hash, so a key-axis change breaks
// these tests loudly instead of silently spawning.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "./testing/unit-db.ts";

process.env.PYTHON_CMD = "kp-no-python-for-this-test";

const { storePromptCache } = await import("./db/analyses.ts");
const { saveProfile, getProfileRecord } = await import("./db/profiles.ts");
const { actOnPipelineEntry, createPipelineEntry, getPipelineEntry, recordAutomationEvent, listPipelineEventsForEntry } =
  await import("./db/pipeline.ts");
const { createWorkspace, setWorkspaceDefaultLocale, DEFAULT_WORKSPACE_ID } = await import("./db/workspaces.ts");
const { setDecisionConfig } = await import("./decision-config-store.ts");
const { getPipelineAxis } = await import("./pipeline-axis-server.ts");
const { stagesWithRole } = await import("./pipeline-stages.ts");
const { meterAllows } = await import("./billing/enforce.ts");
const { resolveCommsLocale } = await import("./comms-locale.ts");
const { LETTER_LANG_TASKS } = await import("./automation-cache-key.ts");
const { computeAutomationCacheKey } = await import("./automation-cache-key.ts");
const { AUTOMATION_VERSION, runAutomationTask, verdictSourceOf, automationReasonDetail, AUTOMATION_REASON_PREFIX } =
  await import("./automation-run.ts");

after(() => cleanupUnitDb());

// ---- fixtures ---------------------------------------------------------------

let seq = 0;
/** A candidate + a board entry, in `ws`. Returns everything the key needs. */
function fixture(ws: string = DEFAULT_WORKSPACE_ID, locale: string | null = null, stage?: string) {
  seq += 1;
  const { id: candidateId } = saveProfile(
    { label: `Cand ${seq}`, archetype: "bau", roleFamily: "software_engineering", completeness: 90, payload: { skills: ["ts"] } },
    ws
  );
  const jobId = `job-am-${seq}`;
  const { entry } = createPipelineEntry({
    candidateId,
    candidateLabel: `Cand ${seq}`,
    jobId,
    jobTitle: "Backend Engineer",
    ...(stage ? { stage } : {}),
    locale,
    workspaceId: ws,
  });
  const profileJson = JSON.stringify(getProfileRecord(candidateId, ws)?.payload);
  return { candidateId, jobId, entry, profileJson, ws };
}

/** Seed the prompt cache at the key runAutomationTask will compute, so the run is a
 *  HIT and never reaches the (deliberately broken) spawn seam. */
function seedVerdict(
  f: ReturnType<typeof fixture>,
  task: string,
  result: Record<string, unknown>,
  source: string,
  lang?: string
): void {
  const version = AUTOMATION_VERSION[task];
  const key = computeAutomationCacheKey({
    version,
    task,
    candidateId: f.candidateId,
    profileJson: f.profileJson,
    jobId: f.jobId,
    stage: f.entry.stage,
    notes: "",
    // The letter tasks key on the RESOLVED comms locale, the recruiter-narrative ones on
    // the caller's UI locale. Reconstructed through the same resolver the module uses, so
    // a test asserting the locale fix cannot accidentally pass by hard-coding the answer.
    lang: LETTER_LANG_TASKS.has(task) ? resolveCommsLocale(f.entry.locale, f.ws) : lang,
    degraded: !meterAllows("ai_candidates", { workspace: f.ws }),
  });
  storePromptCache(key, { result, source }, version, 168);
}

/** The stage the workspace's axis gives the screening role. */
const screeningStage = (ws: string) => stagesWithRole("screening", getPipelineAxis(ws).stages)[0];

/** Put one role's gate on "auto" for `ws`. */
function setGate(ws: string, role: "screening" | "offer", gate: "auto" | "human"): void {
  const stageId = stagesWithRole(role, getPipelineAxis(ws).stages)[0];
  setDecisionConfig("interviewPlan", { steps: [{ stageId, gate }] }, ws);
}

const parseApproval = (id: string, ws: string) =>
  JSON.parse(getPipelineEntry(id, ws)?.approvalDetail ?? "{}") as Record<string, unknown>;

// ---- 1. verdict provenance ---------------------------------------------------
//
// RED FIRST (before the change): the approval payload was `JSON.stringify(result)`,
// so `verdictSource` was undefined on both of these and a recruiter could not tell a
// deterministic template's verdict from the model's.

test("a KEYLESS run (deterministic serve) persists verdictSource 'template' on the approval", async () => {
  const f = fixture(DEFAULT_WORKSPACE_ID, null, screeningStage(DEFAULT_WORKSPACE_ID));
  seedVerdict(f, "screen", { route: "hold", recommendation: "hold", rationale: "template prose" }, "deterministic", "en");

  const out = await runAutomationTask(f.entry.id, "screen", "", undefined, "en");
  assert.equal(out.source, "deterministic", "the CLI's own word is still returned untouched");

  const payload = parseApproval(f.entry.id, f.ws);
  assert.equal(payload.verdictSource, "template", "the review card must be able to disclose a template verdict");
  assert.equal(payload.verdictProvider, null, "a template verdict asked no provider — never name one");
  assert.equal(payload.rationale, "template prose", "the engine's own payload survives beside the provenance");
});

test("an LLM run persists verdictSource 'llm' and names the configured provider", async () => {
  const f = fixture(DEFAULT_WORKSPACE_ID, null, screeningStage(DEFAULT_WORKSPACE_ID));
  seedVerdict(f, "screen", { route: "hold", recommendation: "hold" }, "llm", "en");

  await runAutomationTask(f.entry.id, "screen", "", undefined, "en");
  const payload = parseApproval(f.entry.id, f.ws);
  assert.equal(payload.verdictSource, "llm");
  // Unconfigured install ⇒ the Claude CLI, which is exactly what the spawn defaults to.
  assert.equal(payload.verdictProvider, "claude_cli");
});

test("verdictSourceOf treats every non-'llm' word as a template serve", () => {
  assert.equal(verdictSourceOf("llm"), "llm");
  assert.equal(verdictSourceOf("deterministic"), "template");
  // A future degrade word must fail to the honest side, never claim the model answered.
  assert.equal(verdictSourceOf("some-future-degrade"), "template");
});

test("the automation event carries the engine as its ACTOR", async () => {
  const f = fixture(DEFAULT_WORKSPACE_ID, null, screeningStage(DEFAULT_WORKSPACE_ID));
  seedVerdict(f, "screen", { route: "hold", recommendation: "hold" }, "deterministic", "en");
  await runAutomationTask(f.entry.id, "screen", "", undefined, "en");

  const hold = listPipelineEventsForEntry(f.entry.id, 50, f.ws).find((e) => e.kind === "screening_hold");
  assert.ok(hold, "the hold event was recorded");
  assert.equal(hold.actor, "auto:automation-template", "the decision log can attribute the verdict to an engine");
});

// ---- 2. the auto-ratify gate -------------------------------------------------

test("screening gate 'auto' ratifies an ADVANCE verdict and seals a coded rationale", async () => {
  const f = fixture(DEFAULT_WORKSPACE_ID, null, screeningStage(DEFAULT_WORKSPACE_ID));
  setGate(f.ws, "screening", "auto");
  seedVerdict(f, "screen", { route: "hold", recommendation: "advance" }, "llm", "en");

  const out = await runAutomationTask(f.entry.id, "screen", "", undefined, "en");
  assert.equal(out.applied, "auto_ratified");
  // Ratified through the SAME accept machinery a recruiter's click uses, so the
  // screening_review is cleared and the calendar gate arms behind it.
  assert.equal(getPipelineEntry(f.entry.id, f.ws)?.approvalKind, "calendar");
  setGate(f.ws, "screening", "human"); // leave the shared workspace as found
});

test("screening gate 'auto' NEVER overrides a cautious verdict — a hold still parks", async () => {
  const f = fixture(DEFAULT_WORKSPACE_ID, null, screeningStage(DEFAULT_WORKSPACE_ID));
  setGate(f.ws, "screening", "auto");
  seedVerdict(f, "screen", { route: "hold", recommendation: "hold" }, "llm", "en");

  const out = await runAutomationTask(f.entry.id, "screen", "", undefined, "en");
  assert.notEqual(out.applied, "auto_ratified");
  assert.equal(getPipelineEntry(f.entry.id, f.ws)?.approvalKind, "screening_review", "a human still decides");
  setGate(f.ws, "screening", "human");
});

test("the CAS primitive the screen path arms drops a decision computed against a moved row", () => {
  const f = fixture(DEFAULT_WORKSPACE_ID, null, screeningStage(DEFAULT_WORKSPACE_ID));
  const snapshot = f.entry.stage;
  // Someone else moves the entry during the (here: simulated) model hop…
  assert.ok(actOnPipelineEntry(f.entry.id, "accept", undefined, { expectedStage: snapshot, actor: "human" }, f.ws));
  // …and the stale verdict's write is refused rather than applied to whatever stage it is on now.
  assert.equal(
    actOnPipelineEntry(f.entry.id, "accept", undefined, { expectedStage: snapshot, actor: "system" }, f.ws),
    null,
    "a decision computed against the pre-hop snapshot is dropped, not re-aimed"
  );
  // Same for the approval CAS the auto-ratify uses: no screening_review is pending here.
  assert.equal(
    actOnPipelineEntry(f.entry.id, "accept", undefined, { expectedApprovalKind: "screening_review", actor: "system" }, f.ws),
    null
  );
});

// ---- 3. the unattended offer extension ---------------------------------------

test("an UNPRICED offer draft parks for a human even with the offer gate on 'auto'", async () => {
  const f = fixture();
  setGate(f.ws, "offer", "auto");
  seedVerdict(f, "offer", { recommended: null, rationale: "no band configured" }, "llm");

  const out = await runAutomationTask(f.entry.id, "offer", "", undefined, undefined);
  assert.equal(out.applied, "offer_ready", "never extended — nobody was willing to invent the figure");
  assert.equal(getPipelineEntry(f.entry.id, f.ws)?.approvalKind, "offer_review");
  setGate(f.ws, "offer", "human");
});

test("the offer gate 'human' drafts and parks, extending nothing", async () => {
  const f = fixture();
  seedVerdict(f, "offer", { recommended: 90000, currency: "CZK" }, "llm");
  const out = await runAutomationTask(f.entry.id, "offer", "", undefined, undefined);
  assert.equal(out.applied, "offer_ready");
  const payload = parseApproval(f.entry.id, f.ws);
  assert.equal(payload.verdictSource, "llm", "the offer approval carries provenance too");
});

// ---- 4. the outreach single-flight -------------------------------------------

test("outreach is delivered at most once per entry — the durable marker short-circuits", async () => {
  const f = fixture();
  seedVerdict(f, "outreach", { subject: "Hello", body: "…" }, "llm");
  // The marker dispatchOutreach itself writes on a successful send.
  recordAutomationEvent(f.entry.id, "outreach_sent", "", f.ws);

  const out = await runAutomationTask(f.entry.id, "outreach", "", undefined, undefined);
  assert.equal(out.applied, "already_sent", "a cache HIT must not re-fire a real send");
  const sends = listPipelineEventsForEntry(f.entry.id, 50, f.ws).filter((e) => e.kind === "outreach_sent");
  assert.equal(sends.length, 1, "no second dispatch");
});

// ---- 5. a hired candidate is never re-matched --------------------------------

test("rematch on a terminal-stage entry short-circuits with a CODED reason", async () => {
  const terminal = getPipelineAxis(DEFAULT_WORKSPACE_ID).stages.find((s) => s.role === "terminal")?.id;
  assert.ok(terminal, "the shipped axis has a terminal stage");
  const f = fixture(DEFAULT_WORKSPACE_ID, null, terminal);

  // No cache row seeded on purpose: a placed person must be short-circuited BEFORE the
  // model/corpus hop, so a spawn here (bogus PYTHON_CMD) would reject.
  const out = await runAutomationTask(f.entry.id, "rematch", "", undefined, undefined);
  assert.equal(out.applied, "skipped_hired");
  assert.equal(out.result.reasonCode, "rematchSkippedHired", "the screen resolves this in the reader's language");
  assert.equal(typeof out.result.reason, "string", "the canonical English survives for a legacy client");
});

// ---- 6. the letter locale is resolved in the ENTRY'S OWN team -----------------
//
// RED FIRST (before the change): `resolveCommsLocale(entry.locale)` omitted the
// workspace, so a NULL-locale candidate in a team that set its own default_locale had
// the letter BODY drafted in the DEFAULT team's language while comms-dispatch wrapped
// it in their own team's. Observed through the cache key, which carries the resolved
// letter locale as an axis: seeded at the TEAM's locale, a run that resolved the wrong
// one misses and reaches the (broken) spawn.

test("a NULL-locale candidate's letter is drafted in THEIR team's language", async () => {
  const team = createWorkspace("Team DE");
  setWorkspaceDefaultLocale("de", team.id);
  setWorkspaceDefaultLocale("en", DEFAULT_WORKSPACE_ID); // the WRONG answer, made distinguishable
  const f = fixture(team.id, null);

  seedVerdict(f, "rejection", { subject: "Absage", body: "…" }, "llm");
  const out = await runAutomationTask(f.entry.id, "rejection", "", undefined, undefined, team.id);
  assert.equal(out.applied, "drafted");
  assert.equal((out.result as { subject?: string }).subject, "Absage", "the German draft was served — the key resolved 'de'");
});

test("a background pass narrates in the ENTRY'S team language, not the default team's", async () => {
  // The recruiter-narrative sibling of the letter-locale fix: with no caller UI locale
  // (a background/task-runner pass), `uiLang` falls back to a workspace default, and a
  // bare read took the DEFAULT team's. Observed the same way — the resolved locale is a
  // cache-key axis, so a run that resolved the wrong team misses and reaches the
  // (deliberately broken) spawn.
  const team = createWorkspace("Team FR narrative");
  setWorkspaceDefaultLocale("fr", team.id);
  setWorkspaceDefaultLocale("en", DEFAULT_WORKSPACE_ID); // the WRONG answer, made distinguishable
  const f = fixture(team.id, null, screeningStage(team.id));

  seedVerdict(f, "screen", { route: "hold", recommendation: "hold", rationale: "Motif en français" }, "llm", "fr");
  await runAutomationTask(f.entry.id, "screen", "", undefined, undefined, team.id);
  assert.equal(parseApproval(f.entry.id, team.id).rationale, "Motif en français", "the key resolved 'fr' — the entry's own team");
});

test("an EXPLICIT entry locale still wins over the team default", async () => {
  const team = createWorkspace("Team DE 2");
  setWorkspaceDefaultLocale("de", team.id);
  const f = fixture(team.id, "fr");
  seedVerdict(f, "rejection", { subject: "Refus", body: "…" }, "llm");

  const out = await runAutomationTask(f.entry.id, "rejection", "", undefined, undefined, team.id);
  assert.equal((out.result as { subject?: string }).subject, "Refus");
});

// ---- 7. source guards: the seams a behavioural test cannot reach --------------
//
// Two invariants live in a window this suite cannot open (a concurrent write during an
// awaited hop) and one crosses a client/server boundary the runner cannot import. They
// are pinned in the source instead — CRLF-normalised, because this checkout carries CRLF
// while the worktree may be LF.
const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

test("the screen path arms BOTH compare-and-swaps at their call sites", () => {
  const s = src("./automation-run.ts");
  assert.match(s, /expectedStage: entry\.stage, actor: "system"/, "the advance is CAS'd on the SNAPSHOT stage");
  assert.match(s, /expectedApprovalKind: "screening_review", actor: "system"/, "the auto-ratify is CAS'd on the approval it just wrote");
});

test("the unattended extend runs on a FRESHLY re-read row, never the pre-hop snapshot", () => {
  const s = src("./automation-run.ts");
  const fresh = s.indexOf("const fresh = getPipelineEntry(entry.id, workspaceId);");
  const guard = s.indexOf('fresh.approvalKind === "offer_review"');
  const extend = s.indexOf("await extendDraftedOffer(fresh,");
  assert.ok(fresh > 0 && guard > fresh && extend > guard, "re-read → re-check → extend, in that order");
});

test("the coded-detail wire format is understood by the event-detail renderer", () => {
  assert.equal(automationReasonDetail("offerAutoExtended"), "reason:offerAutoExtended");
  // pipelineEventCatalog.ts is a client component and cannot import this module (it
  // opens SQLite), so the prefix is duplicated there. This is the pin that keeps the
  // writer and the reader from drifting apart.
  const renderer = src("../features/hiring/pipeline/pipelineEventCatalog.ts");
  assert.match(renderer, /const prefix = "reason:";/, "the renderer parses the prefix this module writes");
  assert.equal(AUTOMATION_REASON_PREFIX, "reason:");
});
