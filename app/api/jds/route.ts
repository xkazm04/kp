import { NextResponse } from "next/server";
import { listJds, saveJd } from "@/app/_lib/db";
import { JD_BODY_MAX_LENGTH, JD_TITLE_MAX_LENGTH } from "@/app/_lib/jd-limits";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = listJds(200);
    return NextResponse.json({ jds: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list JDs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be a JSON object." }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const text = typeof record.body === "string" ? record.body.trim() : "";
  if (!title || !text) {
    return NextResponse.json({ error: "Both 'title' and 'body' are required." }, { status: 400 });
  }
  if (title.length > JD_TITLE_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Title must be ${JD_TITLE_MAX_LENGTH} characters or fewer.` },
      { status: 400 }
    );
  }
  if (text.length > JD_BODY_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Body must be ${JD_BODY_MAX_LENGTH.toLocaleString("en-US")} characters or fewer.` },
      { status: 400 }
    );
  }
  try {
    const saved = saveJd({ title, body: text });
    return NextResponse.json({ ...saved, title, body: text });
  } catch {
    // Generic message — never forward raw SQLite text (e.g. "UNIQUE constraint
    // failed: jds.slug") which would leak schema internals.
    return NextResponse.json({ error: "Could not save the JD. Please try again." }, { status: 500 });
  }
}
