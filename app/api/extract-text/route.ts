import { NextResponse } from "next/server";
import {
  cleanupWorkdir,
  createWorkdir,
  parsePythonJson,
  parseStderrError,
  persistFile,
  spawnPython,
} from "@/app/_lib/python-runner";
import { ACCEPT_MIME, MAX_FILE_BYTES, MAX_FILE_MB } from "@/app/_lib/upload-constraints";

export const runtime = "nodejs";
export const maxDuration = 60;

// Extract plain text from an uploaded document (PDF/DOCX/TXT/MD) using the same
// Python extractor the CV pipeline uses. Lets a caller that only holds the file
// — e.g. the GitHub deep-dive, which runs beside the main analysis — read the
// EXACT same JD text instead of silently treating a file-only JD as empty.
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Attach a file under the field name 'file'." }, { status: 400 });
  }
  if (!ACCEPT_MIME.has(file.type)) {
    return NextResponse.json({ error: "Use PDF, DOCX, TXT, or MD." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: `The upload limit is ${MAX_FILE_MB} MB.` }, { status: 400 });
  }

  // persistFile keeps the original extension, which the extractor uses to pick
  // its PDF/DOCX/TXT/MD path — so don't flatten the file name.
  const baseDir = await createWorkdir();
  try {
    const filePath = await persistFile(baseDir, file, "document");
    const { result } = spawnPython(["-m", "pipeline.jobfit.extract_cli", filePath]);
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
