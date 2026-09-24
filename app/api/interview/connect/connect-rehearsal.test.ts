// A kit REHEARSAL at /api/interview/connect (spark interview-kit-template, WP-D).
//
// The acceptance is "the rehearsal gets the real thing": a test-mode session pinned to a
// kit gets the kit-only agenda, BOTH briefs with the director protocol, and the director
// tools — exactly what a candidate on a link pinned to that version would get, minus
// anything only a candidate carries. The strongest form of that claim is an EQUALITY, so
// it is asserted as one: a candidate with no prep of their own, on a link pinned to the
// same kit version and booked for the same length, receives the same agenda and a
// byte-identical private brief; the client-sent brief differs by the greeting line that
// names them and by nothing else.
//
// And the other half: a test session WITHOUT a kit — the lab — keeps today's behaviour
// byte for byte (no agenda, no tools, no client prompt, the stored snapshot served).
//
// Sessions are minted through the REAL rehearse door (open mode: the caller is an owner
// in the default team), so the pairing of what the door writes and what /connect reads
// is what is under test. Provider HTTP is mocked; the credential mint is real.
//
// unit-db.ts MUST stay the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST as connect } from "./route.ts";
import { POST as rehearse } from "../../jobs/[id]/interview-kit/rehearse/route.ts";
import { POST as director } from "../director/route.ts";
import { createInterviewSession, getInterviewSessionById, getInterviewSessionByToken } from "../../../_lib/db/interviews.ts";
import { interviewKitAppendVersion } from "../../../_lib/db/interview-kits.ts";
import { createPipelineEntry, listPipelineEventsForEntry } from "../../../_lib/db/pipeline.ts";
import { insertJob } from "../../../_lib/job-ingest.ts";
import { setDecisionConfig } from "../../../_lib/decision-config-store.ts";
import { DEFAULT_WORKSPACE_ID } from "../../../_lib/db/workspaces.ts";
import { DIRECTOR_TOOL_NAMES } from "../../../_lib/voice/director-tools.mjs";
import type { InterviewKit } from "../../../_lib/interview-kit-types.ts";
import { kitBookedMin } from "../../../_lib/interview-kit-booking.ts";

const realFetch = globalThis.fetch;
const openAiPayloads: string[] = [];
/** When set, the OpenAI mint answers 503 — the preferred provider is down and /connect
 *  fails over to ElevenLabs. */
let openAiDown = false;

before(() => {
  for (const k of ["ELEVENLABS_BASE_URL", "KP_VOICE_PROVIDER", "INTERVIEW_LAB_ENABLED"]) delete process.env[k];
  process.env.OPENAI_API_KEY = "sk-unit-test";
  process.env.ELEVENLABS_API_KEY = "el-unit-test";
  process.env.ELEVENLABS_AGENT_ID = "agent-unit-test";
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("elevenlabs.io")) return Response.json({ signed_url: "wss://unit.test/elevenlabs-signed" });
    if (u.includes("openai.com")) {
      if (openAiDown) return new Response("upstream down", { status: 503 });
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

// ---- fixtures -----------------------------------------------------------------------

/** Two competencies, one must-ask, one follow-up, one FAQ entry and an author note —
 *  each a marker for where it may and may not travel. */
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
        { id: "q-healthy", text: "What does a healthy suite look like to you?", mustAsk: false, followUp: "And an unhealthy one?" },
      ],
    },
    {
      id: "c-collab",
      title: "Collaboration",
      weight: 1,
      budgetMin: 4,
      questions: [{ id: "q-disagree", text: "Tell me about a disagreement with a developer.", mustAsk: false }],
    },
  ],
  faq: [{ id: "f-hybrid", question: "Is the team hybrid?", answer: "Two days in the Prague office, three remote." }],
  note: "Tone: curious, never a quiz. Never read aloud.",
};
const KIT_TITLES = ["Test strategy", "Collaboration"];

let seq = 0;
function job(): string {
  seq += 1;
  return insertJob(
    {
      id: `job-rehearsal-${seq}`,
      title: "QA Engineer",
      company: "Acme",
      location: "Praha",
      workMode: "hybrid",
      description: "Public posting text.",
      detectedSkills: ["Cypress"],
    },
    undefined,
    "published"
  ).id;
}

function draftKit(jobId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): string {
  return interviewKitAppendVersion({ jobId, kit: KIT, source: "generated" }, workspaceId).id;
}

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

/** Mint through the REAL door; returns the session token. */
async function mintRehearsal(jobId: string, kitId: string): Promise<string> {
  const res = await rehearse(jsonRequest(`http://localhost/api/jobs/${jobId}/interview-kit/rehearse`, { kitId }), {
    params: Promise.resolve({ id: jobId }),
  });
  assert.equal(res.status, 200, "the rehearse door mints");
  return ((await res.json()) as { url: string }).url.slice("/interview/".length);
}

async function connectAs(token: string, provider: "openai" | "elevenlabs", extra: Record<string, unknown> = {}) {
  openAiPayloads.length = 0;
  const res = await connect(jsonRequest("http://localhost/api/interview/connect", { token, provider, ...extra }));
  assert.equal(res.status, 200, "a rehearsal connects");
  const body = (await res.json()) as Record<string, unknown>;
  const minted = openAiPayloads.length ? (JSON.parse(openAiPayloads[0]) as { session: Record<string, unknown> }).session : null;
  return { body, minted };
}

const topicTitles = (agenda: unknown) =>
  (agenda as { blocks: { kind: string; title: string }[] }).blocks.filter((b) => b.kind === "topic").map((b) => b.title);

// ---- the rehearsal gets the real thing ----------------------------------------------

test("OpenAI rehearsal: the directed private brief, the director tools and the kit-only agenda — no consent needed", async () => {
  const jobId = job();
  const token = await mintRehearsal(jobId, draftKit(jobId));
  // (No `consent`: a test session carries no candidate, so /connect does not require it.)
  const { body, minted } = await connectAs(token, "openai");

  assert.equal(body.agentPrompt, null, "OpenAI is briefed server-side");
  assert.equal(body.asrKeywords, null);
  assert.deepEqual(topicTitles(body.agenda), KIT_TITLES, "the kit's competencies, in the kit's order");
  assert.doesNotMatch(JSON.stringify(body.agenda), /"(competency|questions|scored|mustAsks|weight)":/, "the browser gets the projection only");

  assert.ok(minted, "one client_secrets mint");
  const tools = minted.tools as { name: string }[];
  assert.deepEqual(tools.map((t) => t.name), [...DIRECTOR_TOOL_NAMES], "the director's tools ride with the brief");
  const instructions = minted.instructions as string;
  assert.match(instructions, /Director protocol/);
  assert.match(instructions, /“How do you decide what to automate first\?” — Required, never skipped even if you are over time\./);
  assert.match(instructions, /This competency carries the most of the decision — protect its time\./);
  assert.ok(instructions.includes("Two days in the Prague office, three remote."), "the kit FAQ is a role fact the interviewer may give");
  assert.ok(!/You are speaking with/.test(instructions), "no candidate is named — there is none");

  // The STORED agenda keeps what the view dropped: the director validates against it.
  const stored = getInterviewSessionByToken(token)?.agenda;
  assert.ok(stored);
  assert.deepEqual(stored.blocks.filter((b) => b.kind === "topic").map((b) => b.competency), KIT_TITLES);
  assert.deepEqual(stored.blocks.find((b) => b.mustAsks)?.mustAsks, [{ id: "q-first", text: "How do you decide what to automate first?" }]);
});

test("ElevenLabs rehearsal: the candidate-safe brief lists the same blocks, with the protocol and the job's own ASR terms", async () => {
  const jobId = job();
  const token = await mintRehearsal(jobId, draftKit(jobId));
  const { body } = await connectAs(token, "elevenlabs");

  const prompt = body.agentPrompt as string;
  assert.equal(typeof prompt, "string", "a rehearsal sends the client-side brief, like a candidate session");
  const view = body.agenda as { blocks: { id: string; title: string; budgetMin: number }[] };
  for (const b of view.blocks) assert.ok(prompt.includes(`${b.id} · ${b.title} (${b.budgetMin} min)`), `${b.id} is in the prompt`);
  assert.match(prompt, /begin_topic/);
  assert.match(prompt, /report_extra_time/);
  assert.match(prompt, /How do you decide what to automate first\?/, "aloud questions stay aloud");
  assert.ok(prompt.includes("Two days in the Prague office, three remote."), "the FAQ reaches both providers");
  for (const marker of ["Required, never skipped", "protect its time", "Never read aloud", "Tone: curious", "And an unhealthy one?"]) {
    assert.ok(!JSON.stringify(body).includes(marker), `${JSON.stringify(marker)} stays server-side`);
  }
  assert.ok(Array.isArray(body.asrKeywords) && (body.asrKeywords as string[]).includes("Cypress"), "the job's public terms bias the recognizer");
});

test("EQUALITY: a no-prep candidate on the same kit version gets the same agenda and a byte-identical private brief", async () => {
  const jobId = job();
  const kitId = draftKit(jobId);
  const rehearsalToken = await mintRehearsal(jobId, kitId);
  const booked = getInterviewSessionByToken(rehearsalToken)?.durationMin ?? null;
  // The door books the ONE kit-booking rule's no-plan value — the length a no-prep
  // candidate's link on this version is minted at — not a rehearsal-only max(20, …).
  assert.equal(booked, kitBookedMin(KIT), "the rehearsal is booked like a no-plan candidate link");

  // The candidate: same job, an explicit locale (so both open in English), no prep of
  // their own, a link pinned to the SAME version and booked for the same length.
  const { entry } = createPipelineEntry({ candidateId: "cand-rehearsal-eq", candidateLabel: "Eva Kandidátka", jobId, jobTitle: "QA Engineer", locale: "en" });
  const candidate = createInterviewSession({
    provider: "openai",
    mode: "candidate",
    entryId: entry.id,
    candidateLabel: "Eva Kandidátka",
    jobId,
    jobTitle: "QA Engineer",
    instructions: "stored snapshot",
    durationMin: booked,
    kitId,
  });

  const r = await connectAs(rehearsalToken, "openai");
  const c = await connectAs(candidate.token, "openai", { consent: true });
  // Non-vacuity: both sides really are directed by the kit, so the equalities below
  // compare two real briefs rather than two absent ones.
  for (const side of [r, c]) {
    assert.match(side.minted?.instructions as string, /Director protocol/);
    assert.deepEqual(topicTitles(side.body.agenda), KIT_TITLES);
  }
  assert.deepEqual(r.body.agenda, c.body.agenda, "the same agenda view");
  assert.deepEqual(getInterviewSessionByToken(rehearsalToken)?.agenda, getInterviewSessionById(candidate.id)?.agenda, "the same stored agenda");
  assert.equal(r.minted?.instructions, c.minted?.instructions, "the same private brief, byte for byte");
  assert.deepEqual(r.minted?.tools, c.minted?.tools, "the same tools");

  const rEl = await connectAs(await mintRehearsal(jobId, kitId), "elevenlabs");
  const candidateEl = createInterviewSession({
    provider: "elevenlabs", mode: "candidate", entryId: entry.id, candidateLabel: "Eva Kandidátka", jobId, jobTitle: "QA Engineer", durationMin: booked, kitId,
  });
  const cEl = await connectAs(candidateEl.token, "elevenlabs", { consent: true });
  assert.ok((cEl.body.agentPrompt as string).includes(" You are speaking with Eva Kandidátka."), "the candidate's brief names them");
  assert.ok(!(rEl.body.agentPrompt as string).includes("You are speaking with"), "the rehearsal's names nobody");
  assert.equal(
    rEl.body.agentPrompt,
    (cEl.body.agentPrompt as string).replace(" You are speaking with Eva Kandidátka.", ""),
    "the client-sent brief differs ONLY by the line that names the candidate"
  );
});

test("the director runs a rehearsal: a tool call against the rehearsal's own agenda is answered", async () => {
  const jobId = job();
  const token = await mintRehearsal(jobId, draftKit(jobId));
  const { body } = await connectAs(token, "openai");
  const session = getInterviewSessionByToken(token);
  assert.ok(session);
  const topic = (body.agenda as { blocks: { id: string; kind: string }[] }).blocks.find((b) => b.kind === "topic");
  assert.ok(topic, "the rehearsal has a topic block to begin");
  const res = await director(
    jsonRequest("http://localhost/api/interview/director", {
      token,
      sessionId: session.id,
      attempt: body.attempt,
      turns: [{ seq: 1, role: "interviewer", text: "Shall we start with test strategy?", at: new Date().toISOString() }],
      events: [],
      tool: { callId: "r1", name: "begin_topic", args: { block_id: topic.id } },
    })
  );
  assert.equal(res.status, 200, "the director answers a rehearsal exactly as it answers a candidate's call");
  const answer = (await res.json()) as { ok: boolean; toolResult: string | null };
  assert.equal(answer.ok, true);
  assert.equal(typeof answer.toolResult, "string", "the tool call got a result");
});

// ---- what a rehearsal never gets --------------------------------------------------------

test("a rehearsal is never offered a recording, even in a workspace that records candidates", async () => {
  setDecisionConfig("compliance", { jurisdiction: "eu", interviewRecordingOffered: true }, DEFAULT_WORKSPACE_ID, "team");
  try {
    const jobId = job();
    const token = await mintRehearsal(jobId, draftKit(jobId));
    const { body } = await connectAs(token, "openai", { consent: true, recordingConsent: true });
    assert.deepEqual(body.recording, { offered: false });
    assert.equal(getInterviewSessionByToken(token)?.recordingConsentAt, null, "no audio consent is stamped on a rehearsal");
  } finally {
    setDecisionConfig("compliance", { jurisdiction: "eu", interviewRecordingOffered: false }, DEFAULT_WORKSPACE_ID, "team");
  }
});

test("a pinned kit this session's team cannot read falls back to the stored snapshot — no agenda, no tools", async () => {
  // A kit id that exists, but in ANOTHER team: the connect-time read is workspace-bound,
  // so the rehearsal must not run it (and must not crash either).
  const jobId = job();
  const foreignKit = draftKit(jobId, "team-foreign-rehearsal");
  const session = createInterviewSession({
    provider: "openai",
    mode: "test",
    jobId,
    jobTitle: "QA Engineer",
    instructions: "SNAPSHOT-FALLBACK",
    durationMin: 20,
    workspaceId: DEFAULT_WORKSPACE_ID,
    kitId: foreignKit,
  });
  const { body, minted } = await connectAs(session.token, "openai");
  assert.equal(body.agenda, null);
  assert.equal(minted?.instructions, "SNAPSHOT-FALLBACK", "the stored snapshot is the fallback");
  assert.equal("tools" in (minted ?? {}), false, "no protocol in the brief → no tools");
  assert.equal(getInterviewSessionById(session.id)?.agenda, null);
});

test("a provider failover marks a CANDIDATE's timeline, and never the entry a test session carries", async () => {
  // The failover marker is the one write /connect makes onto a pipeline entry. It follows
  // the same rule as /complete's scorecard: a test session — a rehearsal, a lab call —
  // writes nothing onto anyone's timeline, even one that somehow carries an entry.
  const jobId = job();
  const { entry } = createPipelineEntry({ candidateId: "cand-failover", candidateLabel: "Fail Over", jobId, jobTitle: "QA Engineer", locale: "en" });
  const failovers = () => listPipelineEventsForEntry(entry.id, 50, DEFAULT_WORKSPACE_ID).filter((e) => e.kind === "interview_failover").length;
  openAiDown = true;
  try {
    const candidate = createInterviewSession({ provider: "openai", mode: "candidate", entryId: entry.id, jobId, jobTitle: "QA Engineer", durationMin: 20 });
    const served = await connectAs(candidate.token, "openai", { consent: true });
    assert.equal(served.body.provider, "elevenlabs", "the alternate served");
    assert.equal(failovers(), 1, "CONTROL: the candidate's timeline records the failover");

    const stray = createInterviewSession({ provider: "openai", mode: "test", entryId: entry.id, jobId, jobTitle: "QA Engineer", durationMin: 20 });
    const strayServed = await connectAs(stray.token, "openai");
    assert.equal(strayServed.body.provider, "elevenlabs", "the test session failed over too");
    assert.equal(failovers(), 1, "…and wrote nothing onto the candidate's timeline");
    assert.equal(getInterviewSessionById(stray.id)?.failoverFrom, "openai", "the session's own breadcrumb is still kept");
  } finally {
    openAiDown = false;
  }
});

// ---- the lab is untouched --------------------------------------------------------------

test("a test session with NO kit keeps the lab behaviour: no agenda, no tools, no client prompt, the stored snapshot", async () => {
  for (const provider of ["openai", "elevenlabs"] as const) {
    const lab = createInterviewSession({ provider, mode: "test", jobTitle: "QA Engineer", instructions: "LAB-SNAPSHOT", durationMin: 5 });
    const { body, minted } = await connectAs(lab.token, provider);
    assert.equal(body.agenda, null, `${provider}: no agenda`);
    assert.equal(body.agentPrompt, null, `${provider}: the dashboard agent's own prompt stands`);
    if (provider === "openai") {
      assert.equal(minted?.instructions, "LAB-SNAPSHOT");
      assert.equal("tools" in (minted ?? {}), false);
    } else {
      assert.ok(Array.isArray(body.asrKeywords) && !(body.asrKeywords as string[]).includes("Cypress"), "the floor list, no job terms");
    }
    assert.equal(getInterviewSessionById(lab.id)?.agenda, null);
  }
});
