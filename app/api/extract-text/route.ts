import { NextResponse } from "next/server";
import {
  cleanupWorkdir,
  createWorkdir,
  parsePythonJson,
  parseStderrError,
  persistFile,
  ENGINE_BUSY_CODE,
  PipelineError,
  spawnPython,
} from "@/app/_lib/python-runner";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { isSpawnTimeoutMessage } from "@/app/_lib/intake-run";
import { jsonRefusal, safeJsonError, type RefusalErrorCode } from "@/app/_lib/api-response";
import { validateUploadServer } from "@/app/_lib/upload-constraints";

export const maxDuration = 60;

// Kill the Python child a few seconds INSIDE the function's own hard limit
// instead of letting it inherit spawnPython's 600s hang-backstop. If the
// extractor is still running when the platform kills the serverless function at
// maxDuration, the finally{ cleanupWorkdir } below never runs — the temp dir
// leaks and the child is orphaned — and because the only caller swallows the
// error (executeGithubAnalysis → extractFileText.catch(() => "")) it fails
// silently and accumulates. Derived from maxDuration so the two can't drift; the
// 5s headroom leaves room for the SIGKILL + cleanup to finish inside the budget.
const EXTRACT_TIMEOUT_MS = (maxDuration - 5) * 1000;

// How an engine-side failure is ANSWERED — the same shape the matrix family uses
// (app/api/matrix/matrix-error-code.ts), kept local because this door has one
// caller pair and no sibling to share a surface with.
//
// `parseStderrError` has always returned a machine `code` beside the message and
// this route threw it away, forwarding `err.message` — extract_cli's own prose,
// and on the catch-all path a Python traceback, the temp workdir path and
// PYTHON_CMD — to a PUBLIC endpoint. The client cannot localize a sentence, so a
// Czech candidate whose PDF was a scan read English, and only if the surface
// painted the server's string at all (api-contracts.md §1.1 forbids that).
//
// The forwarding is a DECIDED table, never `REFUSAL_ERRORS[err.code]`: the code is
// an untrusted string from a subprocess, and a code with no catalogue entry
// resolves to the generic fallback in all four languages — worse than the mapping
// it replaced.
type ExtractAnswer = { kind: "refusal"; code: RefusalErrorCode; status: number } | { kind: "store" };

function extractAnswer(err: { status: number; code?: string }): ExtractAnswer {
  // Refused at the admission door (the spawn semaphore) — the child never ran, so
  // "we could not read your file" would be a lie. Its remedy is "wait", like a 429.
  if (err.code === ENGINE_BUSY_CODE) return { kind: "refusal", code: "ENGINE_BUSY", status: 503 };
  if (err.status === 504 || err.code === "timeout") return { kind: "refusal", code: "EXTRACT_TEXT_TIMEOUT", status: 504 };
  // A 4xx is the FILE, not a fault: a scanned PDF with no text layer, a renamed
  // binary, an encrypted DOCX. One code — the reader's next move (pick another
  // file) is the same for every one of them, and which it was is log detail.
  if (err.status >= 400 && err.status < 500) return { kind: "refusal", code: "EXTRACT_TEXT_UNREADABLE", status: err.status };
  return { kind: "store" };
}

// Extract plain text from an uploaded document (PDF/DOCX/TXT/MD) using the same
// Python extractor the CV pipeline uses. Lets a caller that only holds the file
// — e.g. the GitHub deep-dive, which runs beside the main analysis — read the
// EXACT same JD text instead of silently treating a file-only JD as empty.
export async function POST(request: Request) {
  // Per-IP abuse containment (backlog #7): this route spawns a Python subprocess
  // per request AND is deliberately public even on a gated deploy (PUBLIC_API_EXACT
  // in proxy.ts — the conversational apply needs it), so it must self-limit.
  // Before the formData parse so a flood is rejected cheaply. 20/10min/IP covers
  // every real cadence — the analyze form and the conversational apply each fire
  // ONE extract per JD/CV file — while capping subprocess churn from a script.
  if (!rateLimit(`extract-text:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return jsonRefusal("EXTRACT_FILE_REQUIRED", 400);
  }
  // Same MIME + size gate as /api/analyze, so the two upload endpoints can't
  // drift on accepted types or the size cap (see upload-constraints.ts).
  const rejection = validateUploadServer(file, "file");
  if (rejection) {
    // The gate's `error` names the constraint in English for the log and for API
    // consumers; `code` is the half the surface renders, localized — the exact
    // pair /api/analyze forwards, and the half this route used to drop.
    return NextResponse.json({ error: rejection.error, code: rejection.code }, { status: rejection.status });
  }

  // persistFile keeps the original extension, which the extractor uses to pick
  // its PDF/DOCX/TXT/MD path — so don't flatten the file name.
  const baseDir = await createWorkdir();
  try {
    const filePath = await persistFile(baseDir, file, "document");
    // timeoutMs keeps the child inside the function's budget so cleanup always
    // runs; request.signal also SIGKILLs it the moment the caller abandons the
    // request (navigates away / closes the tab) instead of waiting out the timeout.
    const { result } = spawnPython(["-m", "pipeline.jobfit.extract_cli", filePath], {
      timeoutMs: EXTRACT_TIMEOUT_MS,
      signal: request.signal,
    });
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      const answer = extractAnswer(err);
      if (answer.kind === "refusal") return jsonRefusal(answer.code, answer.status);
      // The engine's own message still reaches the operator's log — it is the only
      // place the traceback belongs.
      return safeJsonError(new Error(err.message), "api:extract-text", "EXTRACT_TEXT_FAILED");
    }
    const { text } = parsePythonJson<{ text: string }>(stdout, stderr);
    return NextResponse.json({ text });
  } catch (error) {
    // The deadline is delivered as a REJECTION carrying a sentence, not a typed
    // error, so it is matched through the one shared predicate.
    if (error instanceof Error && isSpawnTimeoutMessage(error.message)) {
      return jsonRefusal("EXTRACT_TEXT_TIMEOUT", 504);
    }
    if (error instanceof PipelineError) {
      const answer = extractAnswer(error);
      if (answer.kind === "refusal") return jsonRefusal(answer.code, answer.status);
    }
    // Everything else is a FAULT: a wedged workdir, an ENOENT on PYTHON_CMD,
    // parsePythonJson's diagnostic dump of stdout+stderr. Logged whole, answered
    // by code — this is the leak the response-envelope ratchet counted.
    return safeJsonError(error, "api:extract-text", "EXTRACT_TEXT_FAILED");
  } finally {
    await cleanupWorkdir(baseDir);
  }
}
