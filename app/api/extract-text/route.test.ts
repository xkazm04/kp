// POST /api/extract-text — what the door ANSWERS when the extractor does not
// return text.
//
// The route spawns pipeline.jobfit.extract_cli per request and is PUBLIC
// (PUBLIC_API_EXACT in proxy.ts — the conversational apply drops a CV through it
// with no session). Until this file it had no test of the spawn at all: the three
// contract tests that name it pin its limiter, its size cap and its capability
// exemption, none of which reach the extractor. So both failure answers went
// unwatched, and both were wrong in the same way — they painted the engine's own
// prose onto the wire. `parseStderrError` already returns the CODE the CLI emits
// (`invalid_input`, `timeout`, …), and the catch-all forwarded a thrown
// `.message`: a Python traceback, the temp workdir path, PYTHON_CMD.
//
// Hermetic, and deliberately so — a test that needed the operator's Python
// toolchain would be skipped on most machines and would prove nothing about the
// answers. `@/app/_lib/python-runner` is resolved to a stub that re-exports the
// real module (parseStderrError and parsePythonJson stay REAL — the mapping under
// test starts from their genuine output) and replaces `spawnPython` alone.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, "route.ts"), "utf8").replace(/\r\n/g, "\n");

type SpawnOutcome = { stdout: string; stderr: string; exitCode: number | null };
type Extractor = (args: string[], opts: { timeoutMs?: number; signal?: AbortSignal }) => Promise<SpawnOutcome>;

const REAL_RUNNER = new URL("../../_lib/python-runner.ts", import.meta.url).href;
const STUB_URL =
  "data:text/javascript," +
  encodeURIComponent(
    `export * from ${JSON.stringify(REAL_RUNNER)};\n` +
      "let impl = null;\n" +
      "export const calls = [];\n" +
      "export function __setExtractor(fn) { impl = fn; }\n" +
      "export function spawnPython(args, opts) {\n" +
      "  calls.push({ args, opts });\n" +
      "  return { result: impl(args, opts) };\n" +
      "}\n"
  );

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/app/_lib/python-runner") return { url: STUB_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

type Stub = {
  calls: { args: string[]; opts: { timeoutMs?: number; signal?: AbortSignal } }[];
  __setExtractor: (fn: Extractor) => void;
  PipelineError: new (e: { message: string; status: number; code: string }) => Error;
};
type Route = { POST: (request: Request) => Promise<Response>; maxDuration: number };

let stub: Stub;
let route: Route;
// safeJsonError logs the real fault under `[api:extract-text] CODE`; that is the
// point of it, but a green run should not print tracebacks. Captured, not muted:
// the log is asserted on, so "the raw detail went to the SERVER" is proven rather
// than assumed.
const logged: unknown[][] = [];
const realError = console.error;

before(async () => {
  stub = (await import(STUB_URL)) as unknown as Stub;
  route = (await import("./route.ts")) as unknown as Route;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
});
after(() => {
  console.error = realError;
});

function upload(name = "jd.txt", type = "text/plain", body = "Senior Go engineer, Brno."): Request {
  const form = new FormData();
  form.append("file", new File([body], name, { type }));
  return new Request("http://localhost/api/extract-text", { method: "POST", body: form });
}

/** stderr as the CLI writes it: the shared error envelope, last line. */
function envelope(error: string, status: number, code?: string): string {
  return `some warning\n${JSON.stringify({ error, status, ...(code ? { code } : {}) })}`;
}

async function post(
  extractor: Extractor,
  request = upload()
): Promise<{ status: number; body: Record<string, unknown> }> {
  stub.__setExtractor(extractor);
  const res = await route.POST(request);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const ok = (text: string): Extractor => async () => ({ stdout: JSON.stringify({ text }), stderr: "", exitCode: 0 });

test("a readable document answers 200 with its text", async () => {
  const { status, body } = await post(ok("Senior Go engineer, Brno."));
  assert.equal(status, 200);
  assert.equal(body.text, "Senior Go engineer, Brno.");
});

test("the spawn is bounded 5s INSIDE maxDuration, and the number is derived, not typed twice", async () => {
  stub.calls.length = 0;
  await post(ok("x"));
  const spawn = stub.calls.at(-1);
  assert.ok(spawn, "the route must reach spawnPython");
  assert.deepEqual(spawn.args.slice(0, 2), ["-m", "pipeline.jobfit.extract_cli"]);
  assert.equal(spawn.opts.timeoutMs, (route.maxDuration - 5) * 1000);
  assert.equal(spawn.opts.timeoutMs, 55_000, "55s: the 60s function budget minus the 5s cleanup headroom");
  assert.ok(spawn.opts.signal, "an abandoned request must SIGKILL the child, not wait out the deadline");
  // Non-vacuity for the derivation: a literal would pass the numeric assertions
  // above while silently drifting from maxDuration the next time it moves.
  assert.match(src, /const EXTRACT_TIMEOUT_MS = \(maxDuration - 5\) \* 1000;/);
});

test("no file is a NAMED refusal, not a bare English sentence", async () => {
  const res = await route.POST(
    new Request("http://localhost/api/extract-text", { method: "POST", body: new FormData() })
  );
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code?: string }).code, "EXTRACT_FILE_REQUIRED");
});

test("the upload gate's own code travels, exactly as /api/analyze forwards it", async () => {
  const res = await route.POST(upload("photo.png", "image/png"));
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code?: string }).code, "UPLOAD_UNSUPPORTED_TYPE");
});

test("a coded 400 from the extractor is answered by code, with the engine's prose kept off the wire", async () => {
  const raw = "Traceback (most recent call last): PdfReadError at C:\\Temp\\jobfit-9k2\\document.pdf";
  const { status, body } = await post(async () => ({
    stdout: "",
    stderr: envelope(raw, 400, "invalid_input"),
    exitCode: 2,
  }));
  assert.equal(status, 400);
  assert.equal(body.code, "EXTRACT_TEXT_UNREADABLE");
  assert.ok(!String(body.error).includes("Traceback"), "the traceback must not reach the client");
  assert.ok(!String(body.error).includes("jobfit-9k2"), "…nor the temp workdir path");
});

test("an engine fault on a non-zero exit is a coded 500, logged server-side in full", async () => {
  logged.length = 0;
  const raw = "sqlite3.OperationalError while loading C:\\Temp\\jobfit-7p1\\document.docx";
  const { status, body } = await post(async () => ({
    stdout: "",
    stderr: envelope(raw, 500, "engine_error"),
    exitCode: 1,
  }));
  assert.equal(status, 500);
  assert.equal(body.code, "EXTRACT_TEXT_FAILED");
  assert.ok(!String(body.error).includes("jobfit-7p1"));
  assert.ok(
    logged.some((entry) => entry.some((v) => typeof v === "string" && v.includes("api:extract-text"))),
    "the real fault must still reach the server log"
  );
});

test("non-JSON stdout is a coded 500 — parsePythonJson embeds stdout+stderr in its message", async () => {
  const { status, body } = await post(async () => ({
    stdout: "PYTHONPATH=C:\\Temp\\jobfit-3a8 loaded\n",
    stderr: "",
    exitCode: 0,
  }));
  assert.equal(status, 500);
  assert.equal(body.code, "EXTRACT_TEXT_FAILED");
  assert.ok(!String(body.error).includes("jobfit-3a8"), "the diagnostic dump is for the log, not the browser");
});

test("overrunning EXTRACT_TIMEOUT_MS is answered by name at 504", async () => {
  // python-runner reports its deadline by REJECTING `result` with this exact
  // sentence (isSpawnTimeoutMessage is the one place that shape is matched).
  const { status, body } = await post(async () => {
    throw new Error("Python process timed out after 55s");
  });
  assert.equal(status, 504);
  assert.equal(body.code, "EXTRACT_TEXT_TIMEOUT");
});

test("a spawn refused at the admission door stays ENGINE_BUSY at 503", async () => {
  const { status, body } = await post(async () => {
    throw new stub.PipelineError({
      message: "The analysis engine is busy right now.",
      status: 503,
      code: "ENGINE_BUSY",
    });
  });
  assert.equal(status, 503);
  assert.equal(body.code, "ENGINE_BUSY");
});

test("every code this route answers with is declared, so useErrorMessage can resolve it", () => {
  const responses = readFileSync(path.join(HERE, "..", "..", "_lib", "api-response.ts"), "utf8");
  for (const code of [
    "EXTRACT_FILE_REQUIRED",
    "EXTRACT_TEXT_UNREADABLE",
    "EXTRACT_TEXT_TIMEOUT",
    "EXTRACT_TEXT_FAILED",
  ]) {
    assert.match(responses, new RegExp(`\\n\\s*${code}:`), `${code} must be declared in api-response.ts`);
  }
});
