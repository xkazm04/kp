// Pins the /api/interview/connect response contract (backlog #29 /
// TP-L2-VOICE-01): the recruiter's PRIVATE interviewer brief — assessment
// annotations like "(missing must-have)" and "Internal red flag — never say
// this aloud" — must NEVER appear in the JSON the candidate's browser receives.
// The OpenAI provider gets the full brief SERVER-SIDE in the client_secrets
// session config; the ElevenLabs candidate session gets only a candidate-safe
// generic prompt (public job title + booked length) because its signed-url flow
// has no server-side prompt config.
//
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts must stay the first
// project import) with the provider HTTP calls mocked, so the credential mint is
// exercised for real without touching OpenAI/ElevenLabs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { createInterviewSession, getInterviewSessionById } from "../../../_lib/db/interviews.ts";
import { ASR_KEYWORD_LIMIT } from "../../../_lib/voice/asr-keywords.mjs";
import { createPipelineEntry } from "../../../_lib/db/pipeline.ts";
import { saveInterviewPrep } from "../../../_lib/interview-prep.ts";
import { insertJob } from "../../../_lib/job-ingest.ts";
import { buildRunOfShow } from "../../../_lib/run-of-show.ts";
import { rosStrings } from "../../../_lib/interview-prep-strings.ts";
import { DIRECTOR_TOOL_NAMES } from "../../../_lib/voice/director-tools.mjs";

// Markers that make the fixture brief unmistakably interviewer-internal — the
// exact annotation styles the UAT probe found leaking (TP-L2-VOICE-01).
const RED_FLAG = "Internal red flag — never say this aloud: claims 8 skills, largely self-taught";
const GAP_NOTE = "Test automation fundamentals (missing must-have)";
const PRIVATE_BRIEF =
  `You are an interviewer. ${GAP_NOTE}. Probe provenance: coursework only. ${RED_FLAG}. Ask about it obliquely.`;
const PRIVATE_RUN_OF_SHOW = ["Test automation fundamentals (missing must-have)", "Motivation (aspiration mismatch)"];

const realFetch = globalThis.fetch;

before(() => {
  // Both adapters must report available() so /connect reaches the mint.
  process.env.OPENAI_API_KEY = "sk-unit-test";
  process.env.ELEVENLABS_API_KEY = "el-unit-test";
  process.env.ELEVENLABS_AGENT_ID = "agent-unit-test";
  // Mock the PROVIDER hop: capture what the server sends upstream, return the
  // short-lived credential shape each adapter expects.
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("elevenlabs.io")) {
      return Response.json({ signed_url: "wss://unit.test/elevenlabs-signed" });
    }
    if (u.includes("openai.com")) {
      openAiPayloads.push(String(init?.body ?? ""));
      return Response.json({ value: "ek_unit_test_secret", expires_at: Math.floor(Date.now() / 1000) + 120 });
    }
    throw new Error(`unexpected upstream fetch in test: ${u}`);
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  for (const k of ["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID"]) delete process.env[k];
  cleanupUnitDb();
});

const openAiPayloads: string[] = [];

function connectRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/interview/connect", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function candidateSession(provider: "openai" | "elevenlabs") {
  return createInterviewSession({
    provider,
    mode: "candidate",
    candidateLabel: "Unit Candidate",
    jobTitle: "QA Engineer",
    instructions: PRIVATE_BRIEF,
    runOfShow: PRIVATE_RUN_OF_SHOW,
    durationMin: 20,
  });
}

test("connect response for an ElevenLabs candidate session carries no brief/red-flag fields", async () => {
  const session = candidateSession("elevenlabs");
  const res = await POST(connectRequest({ token: session.token, consent: true }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;

  // The leak shape itself is gone: no instructions, no groundedPrompt.
  assert.ok(!("instructions" in body), "response must not carry the interviewer brief field");
  assert.ok(!("groundedPrompt" in body), "response must not carry the legacy groundedPrompt field");

  // Nothing interviewer-internal survives ANYWHERE in the serialized payload —
  // not in agentPrompt, not in connect, not in a renamed field.
  const raw = JSON.stringify(body);
  assert.ok(!raw.includes("red flag"), "no red-flag note may reach the browser");
  assert.ok(!raw.includes("never say this aloud"), "no internal-only note may reach the browser");
  assert.ok(!raw.includes("missing must-have"), "no gap annotation may reach the browser");
  assert.ok(!raw.includes("aspiration mismatch"), "no run-of-show annotation may reach the browser");
  assert.ok(!raw.includes("coursework only"), "no provenance annotation may reach the browser");

  // The candidate-safe replacement is present and built from public facts only:
  // the job title + the booked length.
  assert.equal(typeof body.agentPrompt, "string", "ElevenLabs candidate sessions get a candidate-safe prompt");
  const prompt = body.agentPrompt as string;
  assert.match(prompt, /QA Engineer/, "the prompt names the public role");
  assert.match(prompt, /under 20 minutes/, "the prompt carries the session's booked length");

  // And the browser still gets what it actually needs to connect.
  assert.equal((body.connect as { provider: string }).provider, "elevenlabs");
  assert.equal((body.connect as { signedUrl: string }).signedUrl, "wss://unit.test/elevenlabs-signed");
});

test("the ElevenLabs ASR keyword override carries public job terms only, within the platform cap", async () => {
  // The keyword list rides the SAME client-sent override channel as the prompt,
  // so it is on the wrong side of the same trust boundary: it may carry public
  // job terms and nothing else. The fixture session has no job attached, so this
  // is the floor list — the shape assertions are what matter here, and
  // asr-keywords.test.ts pins how job terms enter it.
  const session = candidateSession("elevenlabs");
  const res = await POST(connectRequest({ token: session.token, consent: true }));
  const body = (await res.json()) as Record<string, unknown>;

  const keywords = body.asrKeywords;
  assert.ok(Array.isArray(keywords), "ElevenLabs sessions carry a keyword bias list");
  assert.ok(keywords.length > 0 && keywords.length <= ASR_KEYWORD_LIMIT, "within the per-conversation cap");
  assert.ok(
    keywords.every((k) => typeof k === "string" && k.trim() === k && k.length > 0),
    "every entry is a trimmed non-empty term"
  );
  // The same leak assertions as the brief: nothing interviewer-internal, and
  // nothing candidate-specific, may ride this field.
  const raw = JSON.stringify(keywords);
  assert.ok(!raw.includes("red flag") && !raw.includes("must-have"), "no annotation leaks through the keyword list");
  assert.ok(!raw.includes("Unit Candidate"), "the candidate is not a keyword");
});

test("OpenAI sessions carry no keyword override — their transcription is server-side", async () => {
  const session = candidateSession("openai");
  const res = await POST(connectRequest({ token: session.token, consent: true }));
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.asrKeywords, null);
});

test("connect response for an OpenAI candidate session strips the brief; the provider gets it server-side", async () => {
  openAiPayloads.length = 0;
  const session = candidateSession("openai");
  const res = await POST(connectRequest({ token: session.token, consent: true }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;

  assert.ok(!("instructions" in body), "response must not carry the interviewer brief field");
  assert.ok(!("groundedPrompt" in body), "response must not carry the legacy groundedPrompt field");
  assert.equal(body.agentPrompt, null, "OpenAI needs no client-side prompt — it is configured server-side");

  const raw = JSON.stringify(body);
  assert.ok(!raw.includes("red flag") && !raw.includes("missing must-have"), "no internal annotation in the payload");

  // The grounding is NOT lost: the full brief went to OpenAI in the server-side
  // session config (the client_secrets POST body).
  assert.equal(openAiPayloads.length, 1, "exactly one client_secrets mint");
  assert.ok(openAiPayloads[0].includes(GAP_NOTE), "the provider session config carries the full grounded brief");
});

test("lab (test-mode) connect responses are equally brief-free", async () => {
  // A tokenless lab session: enabled explicitly for this test.
  process.env.INTERVIEW_LAB_ENABLED = "1";
  try {
    const res = await POST(connectRequest({ provider: "elevenlabs", consent: true }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.ok(!("instructions" in body) && !("groundedPrompt" in body));
    // Lab sessions never carried a grounded prompt — the dashboard agent stands.
    assert.equal(body.agentPrompt, null);
  } finally {
    delete process.env.INTERVIEW_LAB_ENABLED;
  }
});

// ---- the director's agenda (spark ai-interview-parity) ------------------------------
// An ENTRY-BACKED candidate session gets ONE agenda built at connect from the current
// prep; both providers' briefs list it, and the browser receives only its projection.
// The fixture prep carries the interviewer-internal material the agenda must keep
// server-side: an annotated topic (the raw competency) and "Listen for" goals.

const LISTEN_GOAL = "Listen for: hedging about who actually wrote the suite";
let fixtureSeq = 0;

async function entryBackedSession(
  provider: "openai" | "elevenlabs",
  withPrep = true,
  // `extraQuestions` lengthens the prep's own plan (1 question = 15 min, 6 = 25 min);
  // `bookedMin` is the session's booked duration_min (null = none booked).
  opts: { extraQuestions?: number; bookedMin?: number | null } = {}
) {
  fixtureSeq += 1;
  const jobId = insertJob(
    { id: `job-contract-${fixtureSeq}`, title: "QA Engineer", company: "Acme", location: "Praha", workMode: "hybrid", description: "Public posting text." },
    undefined,
    "published"
  ).id;
  const { entry } = createPipelineEntry({
    candidateId: `cand-contract-${fixtureSeq}`,
    candidateLabel: "Unit Candidate",
    jobId,
    jobTitle: "QA Engineer",
    locale: "en",
  });
  if (withPrep) {
    const plan = buildRunOfShow(
      [
        { competency: GAP_NOTE, question: "Which tests would you write first?", whatsGoodLooksLike: LISTEN_GOAL },
        ...Array.from({ length: opts.extraQuestions ?? 0 }, (_, i) => ({ competency: `Extra ${i + 1}`, question: `Extra question ${i + 1}?` })),
      ],
      ["automation"],
      "Unit Candidate",
      "QA Engineer",
      await rosStrings("en")
    );
    saveInterviewPrep(entry.id, "Unit Candidate", "QA Engineer", { ...plan, lang: "en" });
  }
  return createInterviewSession({
    provider,
    mode: "candidate",
    entryId: entry.id,
    candidateLabel: "Unit Candidate",
    jobTitle: "QA Engineer",
    instructions: PRIVATE_BRIEF,
    runOfShow: PRIVATE_RUN_OF_SHOW,
    durationMin: opts.bookedMin === undefined ? 15 : opts.bookedMin,
  });
}

function assertAgendaViewIsAProjection(agenda: unknown) {
  const view = agenda as { durationMin: number; hardCapMin: number; blocks: Record<string, unknown>[] };
  assert.deepEqual(Object.keys(view).sort(), ["blocks", "durationMin", "hardCapMin"]);
  assert.ok(view.blocks.length >= 3);
  for (const b of view.blocks) assert.deepEqual(Object.keys(b).sort(), ["budgetMin", "id", "kind", "title"]);
  const raw = JSON.stringify(view);
  assert.doesNotMatch(raw, /"(competency|questions|scored)":/, "no server-side agenda field reaches the browser");
  for (const marker of ["missing must-have", "Listen for", "hedging", "red flag", "Which tests would you write first"]) {
    assert.ok(!raw.includes(marker), `the agenda view must not carry ${JSON.stringify(marker)}`);
  }
}

test("ElevenLabs entry-backed session: the agenda view is a projection and the client prompt lists the same blocks", async () => {
  const session = await entryBackedSession("elevenlabs");
  const res = await POST(connectRequest({ token: session.token, consent: true, recordingConsent: true }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assertAgendaViewIsAProjection(body.agenda);
  assert.equal(body.attempt, 1, "the first connect opens attempt 1");
  assert.equal(body.resume, null, "a first connect resumes nothing");
  assert.deepEqual(body.recording, { offered: false });

  // The client-sent prompt lists the agenda by id/title/budget — and nothing private.
  const prompt = body.agentPrompt as string;
  const view = body.agenda as { blocks: { id: string; title: string; budgetMin: number }[] };
  for (const b of view.blocks) assert.ok(prompt.includes(`${b.id} · ${b.title} (${b.budgetMin} min)`), `${b.id} is in the prompt`);
  assert.match(prompt, /begin_topic/);
  const raw = JSON.stringify(body);
  for (const marker of ["missing must-have", "Listen for", "hedging", "red flag", "never say this aloud", "coursework only"]) {
    assert.ok(!raw.includes(marker), `${JSON.stringify(marker)} must not reach the browser`);
  }

  // The STORED agenda keeps what the view dropped — the director and the evidence view need it.
  const stored = getInterviewSessionById(session.id);
  assert.ok(stored?.agenda);
  assert.ok(stored.agenda.blocks.some((b) => b.competency === GAP_NOTE), "the raw competency is persisted server-side");
  assert.equal(stored.recordingConsentAt, null, "a workspace that does not offer recording records no consent");
});

test("OpenAI entry-backed session: the minted config carries the directed brief, the director tools and semantic VAD", async () => {
  openAiPayloads.length = 0;
  const session = await entryBackedSession("openai");
  const res = await POST(connectRequest({ token: session.token, consent: true }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.agentPrompt, null);
  assertAgendaViewIsAProjection(body.agenda);

  assert.equal(openAiPayloads.length, 1);
  const minted = JSON.parse(openAiPayloads[0]) as { session: Record<string, unknown> };
  const tools = minted.session.tools as { type: string; name: string }[];
  assert.deepEqual(tools.map((t) => t.name), [...DIRECTOR_TOOL_NAMES]);
  assert.ok(tools.every((t) => t.type === "function"));
  assert.equal(minted.session.tool_choice, "auto");
  assert.deepEqual((minted.session.audio as { input: { turn_detection: unknown } }).input.turn_detection, {
    type: "semantic_vad",
    eagerness: "low",
  });
  // Server-side, the interviewer keeps its coaching: the raw competency and the goal.
  const instructions = minted.session.instructions as string;
  assert.match(instructions, /Director protocol/);
  assert.ok(instructions.includes(`Evidence for: ${GAP_NOTE}`));
  assert.ok(instructions.includes(LISTEN_GOAL));
  // …built from the CURRENT prep, not the invite-time snapshot.
  assert.ok(!instructions.includes(RED_FLAG), "the stored snapshot is the fallback, not the brief");
});

test("an entry with nothing grounded keeps the stored snapshot, no agenda and no tools", async () => {
  openAiPayloads.length = 0;
  const session = await entryBackedSession("openai", false);
  const res = await POST(connectRequest({ token: session.token, consent: true }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.agenda, null);
  const minted = JSON.parse(openAiPayloads[0]) as { session: Record<string, unknown> };
  assert.equal(minted.session.instructions, PRIVATE_BRIEF, "the snapshot is the fallback");
  assert.equal("tools" in minted.session, false, "no protocol in the brief → no tools");
  assert.equal(getInterviewSessionById(session.id)?.agenda, null);
});

test("the agenda follows the session's BOOKED length, not the prep's: prep 25, booked 19 → 19", async () => {
  // What the portal promised the candidate and what the minutes debit clamps against
  // is the session's duration_min — a prep regenerated since the invite must not
  // stretch the conversation past it.
  const session = await entryBackedSession("elevenlabs", true, { extraQuestions: 5, bookedMin: 19 });
  const res = await POST(connectRequest({ token: session.token, consent: true }));
  assert.equal(res.status, 200);
  const view = (await res.json()).agenda as { durationMin: number; hardCapMin: number; blocks: { budgetMin: number }[] };
  assert.equal(view.durationMin, 19);
  assert.equal(view.hardCapMin, 23, "round(19 × 1.2)");
  assert.equal(view.blocks.reduce((n, b) => n + b.budgetMin, 0), 19, "Σ budgets == the booking");
  const stored = getInterviewSessionById(session.id)?.agenda;
  assert.equal(stored?.durationMin, 19, "the persisted agenda is the one the brief listed");
});

test("a session with NO booked length falls back to the prep's own duration", async () => {
  const session = await entryBackedSession("elevenlabs", true, { extraQuestions: 5, bookedMin: null });
  const res = await POST(connectRequest({ token: session.token, consent: true }));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()).agenda as { durationMin: number }).durationMin, 25);
});
