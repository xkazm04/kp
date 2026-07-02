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
import { createInterviewSession } from "../../../_lib/db/interviews.ts";

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
      return Response.json({ value: "ek_unit_test_secret" });
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
