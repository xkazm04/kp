import { NextResponse } from "next/server";
import { listPostings, listSubmissions } from "@/app/_lib/db";

export const runtime = "nodejs";

// Postings (OUT) with their received submissions (IN) inlined.
export async function GET() {
  try {
    const postings = listPostings().map((p) => ({ ...p, submissions: listSubmissions(p.id) }));
    return NextResponse.json({ postings });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to list postings." }, { status: 500 });
  }
}
