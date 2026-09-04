import { NextResponse } from "next/server";
import {
  cleanupWorkdir,
  createWorkdir,
  parsePythonJson,
  parseStderrError,
  persistFile,
  spawnPython,
} from "@/app/_lib/python-runner";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal } from "@/app/_lib/api-response";
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
    return NextResponse.json({ error: "Attach a file under the field name 'file'." }, { status: 400 });
  }
  // Same MIME + size gate as /api/analyze, so the two upload endpoints can't
  // drift on accepted types or the size cap (see upload-constraints.ts).
  const rejection = validateUploadServer(file, "file");
  if (rejection) {
    return NextResponse.json({ error: rejection.error }, { status: rejection.status });
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
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const { text } = parsePythonJson<{ text: string }>(stdout, stderr);
    return NextResponse.json({ text });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Text extraction failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await cleanupWorkdir(baseDir);
  }
}
