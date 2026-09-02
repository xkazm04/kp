// Adapter-level fidelity, on doubles: a scripted `fetch` for the cloud path and
// a counting host for the local probe. No key, no network, no binary.
//
// What these pin is the difference between what an engine was ASKED for and
// what it DID — the package's central claim, and the one that is only testable
// at the adapter, because the registry never sees the vendor's answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AssemblyAiStt } from "./assemblyai.ts";
import { WhisperCppStt } from "./whisper-cpp.ts";
import { silentWav } from "./fake.ts";
import { SttError, type SttHost, type SttRequest } from "../types.ts";

function host(env: Record<string, string> = {}): SttHost & { reads: string[] } {
  const reads: string[] = [];
  return { env: (k) => (reads.push(k), env[k]), homeDir: () => "/home/x", cwd: () => "/app", reads };
}

const clip: SttRequest = { audio: silentWav(), mimeType: "audio/wav" };

type Route = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

/** Install a scripted fetch for one test and restore it afterwards. */
async function withFetch<T>(route: Route, run: (calls: { url: string; body: unknown }[]) => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  const calls: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    let body: unknown = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body; // an octet-stream upload — kept as-is for the assertion
      }
    }
    calls.push({ url, body });
    return route(url, init);
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const json = (payload: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });

/** upload -> submit, with the submit row scripted; no polling (status completed). */
function cloudRoute(row: Record<string, unknown>, submitStatus = 200, submitHeaders: Record<string, string> = {}): Route {
  return (url) => {
    if (url.endsWith("/v2/upload")) return json({ upload_url: "https://cdn.example/clip" });
    if (submitStatus !== 200) return json({ error: "no" }, submitStatus, submitHeaders);
    return json({ id: "t1", status: "completed", text: "hello", ...row });
  };
}

test("assemblyai: `redacted` is read off the vendor row, not echoed from the request", async () => {
  const stt = new AssemblyAiStt(host({ ASSEMBLYAI_API_KEY: "k" }));
  // The vendor says it redacted; the request never asked. Echoing the request
  // would report `false` for a transcript that HAS been redacted.
  const out = await withFetch(cloudRoute({ redact_pii: true }), () => stt.transcribe(clip));
  assert.equal(out.redacted, true);

  // …and the other direction: asked for, silently not applied -> a typed
  // refusal, never a 200 carrying the spans somebody asked to have removed.
  await assert.rejects(
    withFetch(cloudRoute({ redact_pii: false }), () => stt.transcribe({ ...clip, redactPii: true })),
    (e: SttError) => e.code === "unsupported" && /redact/.test(e.message),
  );
});

test("assemblyai: a 429 is `rate_limited` with Retry-After parsed, not a generic engine failure", async () => {
  const stt = new AssemblyAiStt(host({ ASSEMBLYAI_API_KEY: "k" }));
  await assert.rejects(
    withFetch(cloudRoute({}, 429, { "retry-after": "12" }), () => stt.transcribe(clip)),
    (e: SttError) => e.code === "rate_limited" && e.retryAfterMs === 12_000,
  );
});

test("assemblyai: the vendor gets a primary language tag, never the regional one", async () => {
  const stt = new AssemblyAiStt(host({ ASSEMBLYAI_API_KEY: "k" }));
  const calls = await withFetch(cloudRoute({ language_code: "cs" }), async (calls) => {
    await stt.transcribe({ ...clip, language: "cs-cz" });
    return calls;
  });
  const submit = calls.find((c) => c.url.endsWith("/v2/transcript"))!;
  assert.equal((submit.body as { language_code?: string }).language_code, "cs");
});

test("whisper probe is cached like the cloud one, and a failed transcribe invalidates it", async () => {
  const h = host({ PATH: "" });
  const whisper = new WhisperCppStt(h);
  const first = await whisper.probe();
  assert.equal(first.state, "absent");
  const reads = h.reads.length;
  const second = await whisper.probe();
  assert.equal(second, first, "a probe inside the TTL returns the cached object");
  assert.equal(h.reads.length, reads, "…without touching the filesystem or the host again");

  await assert.rejects(whisper.transcribe(clip), (e: SttError) => e.code === "unavailable");
  await whisper.probe();
  assert.ok(h.reads.length > reads, "a real failure invalidates the cached probe");
});
