import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  cleanupWorkdir,
  createWorkdir,
  parseStderrError,
  spawnPython,
} from "@/app/_lib/python-runner";
import { getServerLocale } from "@/i18n/server";


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
    const { result } = spawnPython(["-m", "pipeline.jobfit.profile_draft_cli", "--input-json", inputPath, "--lang", lang]);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI draft failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
