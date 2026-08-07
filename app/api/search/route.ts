import { NextResponse } from "next/server";
import { searchEntities } from "@/app/_lib/db/analytics";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { safeJsonError } from "@/app/_lib/api-response";


// SHELL1 — the command palette's cross-entity search. Read-only LIKE lookup
// across profiles / pipeline entries / jobs / saved JDs / analyses (capped per
// type in searchEntities); the palette maps each hit's type to its deep link.
// Input is bounded BEFORE it reaches SQL: a sub-minimum query returns an empty
// result (not an error — the palette clears as the user deletes), and an
// over-long one is truncated, never rejected mid-keystroke.
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 64;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
    if (q.length < MIN_QUERY_LENGTH) {
      return NextResponse.json({ results: [] });
    }
    return NextResponse.json({ results: searchEntities(q, 5, await currentWorkspace()) });
  } catch (error) {
    return safeJsonError(error, "api:search", "SEARCH_FAILED");
  }
}
