// The AI voice interview's install switch (enabled.ts), its path predicate, and the door
// that enforces it (proxy.ts). Pinned: only KP_VOICE_INTERVIEW=1 turns it on; the predicate
// catches session-starting doors by whole segment and leaves recorded-session reads alone;
// the real proxy answers a gated path as an unknown route when off and passes it when on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isVoiceInterviewPath, voiceInterviewEnabled } from "./enabled.ts";
import { UNKNOWN_ROUTE_PATH } from "../jobseeker/enabled.ts";

test("voice is on only for KP_VOICE_INTERVIEW=1 exactly", () => {
  assert.equal(voiceInterviewEnabled({ KP_VOICE_INTERVIEW: "1" }), true);
  for (const value of [undefined, "", "0", "true", "yes", "on", " 1", "1 ", "TRUE"]) {
    assert.equal(voiceInterviewEnabled({ KP_VOICE_INTERVIEW: value }), false, JSON.stringify(value));
  }
  assert.equal(voiceInterviewEnabled({}), false);
});

test("the predicate catches session-starting doors, by whole segment", () => {
  for (const p of [
    "/interview/abc", "/interview", "/api/interview/connect", "/api/interview/create", "/api/interview/director",
    "/api/interview/simulate", "/api/interview/simulate/attach", "/api/intake/i1/voice-connect",
    "/api/intake/i1/voice-turn", "/api/intake/i1/voice-complete", "/api/jobs/j1/interview-kit/rehearse",
  ]) assert.equal(isVoiceInterviewPath(p), true, p);
  for (const p of [
    "/", "/interviews", "/interview-lab", "/api/interview/sessions", "/api/interview/sessions/s1/evidence",
    "/api/interview/recording", "/api/interview/by-entry", "/api/interview/connection", "/api/interview-prep/scorecard",
    "/api/intake/i1/message", "/api/intake/i1", "/api/jobs/j1/interview-kit", "/api/tts", "/api/voice/readiness",
  ]) assert.equal(isVoiceInterviewPath(p), false, p);
});

// Next resolves a route from the DECODED path (server/lib/router-utils/filesystem.js) while
// nextUrl.pathname stays encoded, so the predicate has to judge what Next will route.
const GATED_SPELLINGS = [
  "/api/interview/connect/",
  "/interview/tok/",
  "/api/interview/%63onnect",
  "/api/intake/i1/voice%2Dconnect",
  "/%69nterview/tok",
  "/api%2Finterview%2Fconnect",
  "/api/interview/CONNECT",
  "/API/Interview/Connect",
  "/Interview/tok",
  "/api//interview//connect",
];

test("the predicate holds for a trailing slash, case and an encoded segment, under both flag states", () => {
  const hidden = (path: string, env: Record<string, string>, method?: string) =>
    isVoiceInterviewPath(path, method) && !voiceInterviewEnabled(env);
  for (const p of GATED_SPELLINGS) {
    assert.equal(hidden(p, {}), true, `off: ${p}`);
    assert.equal(hidden(p, { KP_VOICE_INTERVIEW: "1" }), false, `on: ${p}`);
  }
  // Decoding must not widen the gate onto a door that is open by design.
  for (const p of ["/api/interview/sessions/", "/api/interview/%73essions", "/api/interview/REVOKE", "/api/interview/sessions%2Fconnect"]) {
    assert.equal(hidden(p, {}), false, p);
  }
  // A malformed escape is judged as written rather than thrown on.
  assert.equal(isVoiceInterviewPath("/api/interview/connect%ZZ"), false);
  assert.equal(isVoiceInterviewPath("/interview/%ZZ"), true);
});

test("the readiness probe is gated by METHOD: POST mints a credential, GET only reports", () => {
  const hidden = (method: string, env: Record<string, string>) =>
    isVoiceInterviewPath("/api/voice/readiness", method) && !voiceInterviewEnabled(env);
  assert.equal(hidden("POST", {}), true);
  assert.equal(hidden("post", {}), true);
  assert.equal(hidden("POST", { KP_VOICE_INTERVIEW: "1" }), false);
  assert.equal(hidden("GET", {}), false, "the strip still has to read that voice is switched off");
  assert.equal(isVoiceInterviewPath("/api/voice/%72eadiness", "POST"), true);
});

const { proxy } = await import("../../../proxy.ts");
const { NextRequest } = await import("next/server.js");

async function withEnv<T>(env: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return await run();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}
const call = (path: string) => proxy(new NextRequest(`https://kp.test${path}`));
const rewrittenTo = (res: Response) => {
  const to = res.headers.get("x-middleware-rewrite");
  return to ? new URL(to).pathname : null;
};
const OPEN = { KP_OPERATOR_PASSWORD: undefined, KP_ALLOW_OPEN: undefined };

test("OFF: gated paths answer as an unknown route; recorded-session reads pass", async () => {
  await withEnv({ ...OPEN, KP_VOICE_INTERVIEW: undefined }, async () => {
    for (const p of ["/interview/tok", "/api/interview/connect", "/api/interview/create", "/api/intake/i1/voice-connect", "/api/jobs/j1/interview-kit/rehearse"]) {
      assert.equal(rewrittenTo(await call(p)), UNKNOWN_ROUTE_PATH, p);
    }
    for (const p of ["/api/interview/sessions", "/api/interview/by-entry", "/api/interview/recording"]) {
      assert.equal(rewrittenTo(await call(p)), null, `${p} stays reachable`);
    }
  });
});

test("ON: gated paths pass through", async () => {
  await withEnv({ ...OPEN, KP_VOICE_INTERVIEW: "1" }, async () => {
    for (const p of ["/interview/tok", "/api/interview/connect", "/api/interview/create"]) {
      const res = await call(p);
      assert.equal(rewrittenTo(res), null, p);
      assert.equal(res.headers.get("x-middleware-next"), "1");
    }
  });
});

const callPost = (path: string) => proxy(new NextRequest(`https://kp.test${path}`, { method: "POST" }));

test("the real proxy applies the gate to every spelling, and only to the probe's POST", async () => {
  await withEnv({ ...OPEN, KP_VOICE_INTERVIEW: undefined }, async () => {
    for (const p of GATED_SPELLINGS) assert.equal(rewrittenTo(await call(p)), UNKNOWN_ROUTE_PATH, p);
    assert.equal(rewrittenTo(await callPost("/api/voice/readiness")), UNKNOWN_ROUTE_PATH, "the probe mints nothing while off");
    assert.equal(rewrittenTo(await call("/api/voice/readiness")), null, "the read stays");
  });
  await withEnv({ ...OPEN, KP_VOICE_INTERVIEW: "1" }, async () => {
    for (const p of GATED_SPELLINGS) assert.equal(rewrittenTo(await call(p)), null, p);
    assert.equal(rewrittenTo(await callPost("/api/voice/readiness")), null);
  });
});
