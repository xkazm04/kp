// The code -> status table of /api/stt, pinned by INVOKING the handler.
//
// The route had ZERO callers when this was written (the dock's mic is an honest
// disabled placeholder), which is exactly why the table needs a test: nothing in
// the app would notice if a refusal changed shape. Every case here is refused
// before any engine is reached, so the suite spends nothing and needs no key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MAX_AUDIO_BYTES } from "@/app/_lib/upload-constraints";
import { maxDuration, POST } from "./route.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/** A distinct IP per case: the limiter is per-IP and in-process. */
function multipart(ip: string, form: FormData): Request {
  return new Request("http://localhost/api/stt", { method: "POST", headers: { "x-forwarded-for": ip }, body: form });
}

async function codeOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { code?: string }).code;
}

function audio(bytes: number, type: string, name = "clip.wav"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

test("a body that is not multipart is a coded 400", async () => {
  const res = await POST(
    new Request("http://localhost/api/stt", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.1.0.1" },
      body: "{}",
    }),
  );
  assert.equal(res.status, 400);
  assert.equal(await codeOf(res), "AUDIO_MISSING");
});

test("a multipart body with no audio part, or an empty one, is the SAME refusal", async () => {
  const empty = new FormData();
  empty.set("language", "en");
  assert.equal(await codeOf(await POST(multipart("10.1.0.2", empty))), "AUDIO_MISSING");
  const zero = new FormData();
  zero.set("audio", audio(0, "audio/wav"));
  assert.equal(await codeOf(await POST(multipart("10.1.0.3", zero))), "AUDIO_MISSING");
});

test("a container no engine here accepts is a coded 400 — convert it", async () => {
  const form = new FormData();
  form.set("audio", audio(1024, "application/pdf", "cv.pdf"));
  const res = await POST(multipart("10.1.0.4", form));
  assert.equal(res.status, 400);
  assert.equal(await codeOf(res), "AUDIO_UNSUPPORTED_TYPE");
});

test("past the byte ceiling is the shared 413 — shorten it", async () => {
  const form = new FormData();
  form.set("audio", audio(MAX_AUDIO_BYTES + 1, "audio/wav"));
  const res = await POST(multipart("10.1.0.5", form));
  assert.equal(res.status, 413);
  assert.equal(await codeOf(res), "AUDIO_TOO_LARGE");
});

test("the per-IP throttle answers 429 through the refusal chokepoint", async () => {
  const ip = "10.1.0.6";
  const bad = () =>
    new Request("http://localhost/api/stt", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: "{}",
    });
  for (let i = 0; i < 20; i += 1) await POST(bad());
  const res = await POST(bad());
  assert.equal(res.status, 429);
  assert.equal(await codeOf(res), "TOO_MANY_REQUESTS");
  assert.equal(res.headers.get("retry-after"), null, "our own throttle does not claim to know how long");
});

test("the engine code table covers the package's union, refusals included", () => {
  const src = readFileSync(path.join(here, "route.ts"), "utf-8");
  // THREE engine codes answer as refusals rather than through the lookup: each
  // is something an operator can act on, in their own language.
  assert.match(src, /err\.code === "rate_limited"\) return engineThrottled\(err\.retryAfterMs\)/);
  assert.match(src, /err\.code === "too_long"\) return jsonRefusal\("STT_TOO_LONG", 413\)/);
  assert.match(src, /err\.code === "unavailable"\) return jsonRefusal\("STT_UNAVAILABLE", 503\)/);
  for (const [code, status] of [
    ["invalid_audio", 400],
    ["invalid_language", 400],
    ["invalid_model", 400],
    ["unsupported", 422],
    ["timeout", 504],
  ] as const) {
    assert.match(src, new RegExp(`${code}: ${status},`), `${code} must map to ${status}`);
  }
  // A code answered above must NOT also sit in the lookup: the row is
  // unreachable, and an unreachable row is where a second, divergent status for
  // the same failure quietly grows.
  const table = /const STT_ERROR_STATUS[^}]*}/.exec(src)?.[0] ?? "";
  for (const dead of ["rate_limited", "too_long", "unavailable"]) {
    assert.doesNotMatch(table, new RegExp(`${dead}:`), `${dead} is answered as a refusal; a lookup row for it is dead`);
  }
  assert.match(src, /STT_ERROR_STATUS\[err\.code\] \?\? 502/);
  assert.match(src, /safeJsonError\(err, "api:stt", "STT_FAILED"\)/);
});

// cloud-transcription-is-metered. Source rather than invocation: the ledger
// write is past the engine, and the engine is what a keyless suite does not have.
// What is pinned is the SHAPE that makes the row truthful and harmless — priced
// on the clip's length rather than the wall clock, and best-effort so telemetry
// can never fail a transcript that succeeded.
test("every transcript writes an llm_usage row, priced by duration and best-effort", () => {
  const src = readFileSync(path.join(here, "route.ts"), "utf-8").replace(/\r\n/g, "\n");
  assert.match(src, /insertLlmUsage\(\s*sttUsageRow\(/, "a served transcript is metered like every other paid leg");
  assert.match(src, /durationMs: out\.durationMs/, "the vendor bills for the clip's length, not for how long the engine took");
  assert.doesNotMatch(src, /sttUsageRow\([^)]*elapsedMs/, "elapsedMs is wall clock and prices nothing");
  assert.match(
    src,
    /try \{\n\s*insertLlmUsage[\s\S]*?\} catch \(ledgerErr\) \{\n\s*console\.warn/,
    "the ledger is telemetry: a failed write is logged, never raised into the response",
  );
});

// the-keyless-voice-failure-reaches-the-operator-in-their-language — the twin of
// the /api/tts guard. Source rather than invocation for the same reason: the
// engine branch is past every keyless refusal.
test("an engine failure answers a registry code, never the engine's own sentence", () => {
  const src = readFileSync(path.join(here, "route.ts"), "utf-8");
  assert.doesNotMatch(src, /error:\s*err\.message/, "the engine's sentence is a server-log fact, never a response body");
  assert.match(
    src,
    /safeJsonError\(err, "api:stt:engine", "STT_FAILED", STT_ERROR_STATUS\[err\.code\] \?\? 502\)/,
    "the engine branch answers through the chokepoint at the engine's own status",
  );
});

// the-stt-route-has-a-deadline-and-honest-edges.
test("the route declares a deadline and DERIVES the engine budget from it", () => {
  const src = readFileSync(path.join(here, "route.ts"), "utf-8").replace(/\r\n/g, "\n");
  // Both adapters budget 300 s of their own; a route that declared nothing let
  // the platform kill the handler first, orphaning the local sidecar and its
  // scratch dir. The precedent is app/api/extract-text/route.ts, which pins the
  // same derivation for the same reason.
  assert.equal(maxDuration, 300);
  assert.match(
    src,
    /const STT_ENGINE_TIMEOUT_MS = \(maxDuration - \d+\) \* 1000;/,
    "the engine budget is derived from maxDuration so the two cannot drift",
  );
  assert.match(src, /timeoutMs: STT_ENGINE_TIMEOUT_MS/, "and it is PASSED to the engine — maxDuration alone binds nothing on a self-hosted next start");
});

test("a caller that went away is not an engine fault", () => {
  const src = readFileSync(path.join(here, "route.ts"), "utf-8").replace(/\r\n/g, "\n");
  // `aborted` used to fall through to the 502 engine branch, which LOGS under
  // `api:stt:engine`: every cancelled upload and every navigation wrote an
  // engine fault no engine committed.
  assert.match(src, /err\.code === "aborted"\) return new NextResponse\(null, \{ status: 499 \}\)/);
  const abortIdx = src.indexOf('err.code === "aborted"');
  const engineIdx = src.indexOf('safeJsonError(err, "api:stt:engine"');
  assert.ok(abortIdx > 0 && abortIdx < engineIdx, "the abort branch answers BEFORE the engine-fault chokepoint");
});

test("the served payload says what was ASKED for, not only what fell back", () => {
  const src = readFileSync(path.join(here, "route.ts"), "utf-8").replace(/\r\n/g, "\n");
  // A provider outside KP_STT_PROVIDERS is dropped before the resolution order
  // is built, so fallbackFrom is null and the overrule was invisible.
  assert.match(src, /requestedProvider: out\.requestedProvider/);
  assert.match(src, /fallbackFrom: out\.fallbackFrom/);
});
