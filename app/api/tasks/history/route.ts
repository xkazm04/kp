import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { countTaskHistory, listTaskHistory, listTaskParams } from "@/app/_lib/db/tasks";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { callerCapabilities } from "@/app/_lib/auth/current-user";
import { recentTaskCutoffIso } from "@/app/_lib/tasks";
import { attachReplayVerdicts } from "@/app/_lib/task-replay";


const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Parse an offset/limit query param defensively: a missing, non-numeric, or
// out-of-range value falls back to a safe default rather than paging off the end
// or pulling the whole history in one request.
function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

// DATA6 — the terminal statuses the ?status= filter accepts (the history shows
// finished rows only, so queued/running are not valid filter values).
const FILTER_STATUSES = new Set(["succeeded", "failed", "canceled", "interrupted"]);
const MAX_KIND_LENGTH = 64;

// Offset-paged history of finished tasks older than the recent window. The
// Background-tasks tab loads this 20 at a time once the user opts into "show
// history", so the full (potentially huge) trail is never pulled at once. Shape
// mirrors /api/analytics/decisions: hasMore/nextOffset chain the pages, total
// powers the "showing X of Y" footer. Optional ?kind=/?status= narrow the page
// server-side (an invalid value falls back to unfiltered, never an error).
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = clampInt(searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = clampInt(searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    const rawKind = (searchParams.get("kind") ?? "").trim();
    const rawStatus = (searchParams.get("status") ?? "").trim();
    const filter = {
      kind: rawKind && rawKind.length <= MAX_KIND_LENGTH ? rawKind : undefined,
      status: FILTER_STATUSES.has(rawStatus) ? rawStatus : undefined,
    };
    const before = recentTaskCutoffIso();
    // Same tenant scope as the live poll: task labels carry candidate names, so an
    // unscoped history paged another team's roster into this one.
    const ws = await currentWorkspace();
    const total = countTaskHistory(before, filter, ws);
    const page = listTaskHistory(before, limit, offset, filter, ws);
    // The same replay verdict the live poll stamps (app/_lib/task-replay.ts), from one
    // bounded params read for this page's dead path-bearing rows.
    const caps = new Set(await callerCapabilities());
    const tasks = attachReplayVerdicts(page, {
      loadParams: (ids) => listTaskParams(ids, ws),
      exists: existsSync,
      hasCapability: (cap) => caps.has(cap),
    });
    const nextOffset = offset + tasks.length;
    return NextResponse.json({ tasks, total, hasMore: nextOffset < total, nextOffset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load task history.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
