import { NextResponse } from "next/server";
import { listJds, saveJd } from "@/app/_lib/db";

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
  try {
    const saved = saveJd({ title, body: text });
    return NextResponse.json({ ...saved, title, body: text });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save JD.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
