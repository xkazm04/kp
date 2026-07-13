import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  cleanupWorkdir,
  createWorkdir,
  parsePythonJson,
  parseStderrError,
  spawnPython,
} from "@/app/_lib/python-runner";
import { getServerLocale } from "@/i18n/server";

// bug-ui-scan-2026-07-09 (pipeline-clis-script-bridges #2): this route spawns a
// Gemini child, so it needs the same function budget + child-timeout contract as
// extract-text. Without maxDuration the platform kills the serverless function at
// its default budget BEFORE the finally{ cleanupWorkdir } runs, leaking notes.json
// (recruiter PII) into os.tmpdir(); without a derived timeout the child could
// outlive the function. Kill the child 5s inside the budget so cleanup always runs.
export const maxDuration = 60;
const DRAFT_TIMEOUT_MS = (maxDuration - 5) * 1000;

// AI-assisted intake: free-text notes -> a routed CandidateProfileV2 draft the
// Profile editor loads for review. Does NOT persist — the recruiter edits then
// saves via POST/PUT /api/profile. Requires a Gemini key; without one the CLI
// fails with a clear message that surfaces in the editor.
export async function POST(request: NextRequest) {
  let workdir: string | null = null;
  try {
    const body = (await request.json()) as { text?: string };
    const text = (body.text ?? "").trim();
    if (!text) {
      return NextResponse.json({ error: "Add some notes for the AI to draft from." }, { status: 400 });
    }

    workdir = await createWorkdir();
    const inputPath = path.join(workdir, "notes.json");
    await writeFile(inputPath, JSON.stringify({ text }), "utf-8");

    // Draft the profile's free-form narrative (basics, skill-claim evidence) in the
    // org language — the CLI already accepts --lang and appends the directive.
    const lang = await getServerLocale();
    // bug-ui-scan-2026-07-09 (pipeline-clis-script-bridges #2): pass request.signal
    // so closing the modal / navigating away SIGKILLs the orphaned Gemini child
    // instead of letting it burn a paid call whose result is discarded; timeoutMs
    // keeps it inside the function budget so cleanupWorkdir always runs.
    const { result } = spawnPython(
      ["-m", "pipeline.jobfit.profile_draft_cli", "--input-json", inputPath, "--lang", lang],
      { signal: request.signal, timeoutMs: DRAFT_TIMEOUT_MS },
    );
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // bug-ui-scan-2026-07-09 (candidate-profile-job-matching #3): parse via
    // parsePythonJson, not a bare parse of the child's stdout. This route drives an
    // LLM (Gemini) — the path most prone to interpreter teardown chatter ("Event loop
    // is closed", a ResourceWarning) printed on stdout AFTER the result JSON line. A
    // bare parse chokes on that trailing noise and 500s a successful (paid) draft;
    // scanning from the end for the last JSON object matches every sibling CLI seam
    // (profile/route.ts, match/route.ts, reasoning-run.ts).
    return NextResponse.json(parsePythonJson<Record<string, unknown>>(stdout, stderr));
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI draft failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
