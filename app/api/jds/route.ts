import { NextResponse } from "next/server";
import { listJds, saveJd } from "@/app/_lib/db";
import { validateJdFields } from "@/app/_lib/jd-limits";

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
  const fields = validateJdFields(record.title, record.body);
  if (!fields.ok) {
    return NextResponse.json({ error: fields.error }, { status: 400 });
  }
  try {
    const saved = saveJd({ title: fields.title, body: fields.body });
    return NextResponse.json({ ...saved, title: fields.title, body: fields.body });
  } catch {
    // Generic message — never forward raw SQLite text (e.g. "UNIQUE constraint
    // failed: jds.slug") which would leak schema internals.
    return NextResponse.json({ error: "Could not save the JD. Please try again." }, { status: 500 });
  }
}
