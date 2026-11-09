//   GET /api/outreach-letters?state=drafted[&limit=]
//     -> { letters: [{ id, entryId, candidateLabel, jobTitle, subject, state, revision, createdAt, updatedAt }], state, limit, truncated }
//
// The queue of held outreach letters in ONE state (comms scope C2) — what /one's "letters
// waiting" view and its header count read. Oldest first, so the letter waiting longest
// leads. NO BODY on the list: a reader opens one through GET ./by-entry/[entryId]
// (or ./[id]), which assembles the exact letter its release would send.
//
// `state` is clamped rather than trusted: absent or unknown folds to `drafted` (the only
// state a person acts on before anything leaves), and every row states its own `state`.
// `limit` folds to the default when absent or not a number and is capped by the store
// (OUTREACH_LETTER_LIST_MAX); one row past it is read so `truncated` is a true claim.
//
// READ-ONLY, recruiter PII class (a candidate's name and a subject written to them): the
// same posture as the by-entry read — requireOperator first, every row scoped to the
// caller's workspace inside the store (outreach-letters-tenancy.test.ts).
import { NextResponse } from "next/server";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";
import { OUTREACH_LETTER_LIST_MAX, OUTREACH_LETTER_STATES, outreachLetterListByState, type OutreachLetterState } from "@/app/_lib/db/outreach-letters";

const DEFAULT_LIMIT = 50;

export const GET = withWorkspace(async (ws: string, request: Request) => {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const params = new URL(request.url).searchParams;
    const raw = params.get("state");
    const state: OutreachLetterState = (OUTREACH_LETTER_STATES as readonly string[]).includes(raw ?? "") ? (raw as OutreachLetterState) : "drafted";
    const asked = Number(params.get("limit"));
    const limit = Number.isFinite(asked) && asked >= 1 ? Math.trunc(asked) : DEFAULT_LIMIT;
    const { letters, truncated } = outreachLetterListByState(state, limit, ws);
    return NextResponse.json({ letters, state, limit: Math.min(limit, OUTREACH_LETTER_LIST_MAX), truncated });
  } catch (error) {
    return safeJsonError(error, "api:outreach-letters", "OUTREACH_FAILED");
  }
});
