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
