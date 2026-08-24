import { NextResponse } from "next/server";
import { createThread, listProposalsForThread, listThreads, listTurns } from "@/app/_lib/db/companion";
import { companionMemoryEnabled } from "@/app/_lib/companion-brain";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { safeJsonError } from "@/app/_lib/api-response";

// The operator companion's conversations (docs/features/companion/README.md).
// GET  — the ledger, plus the newest thread's turns so the dock hydrates in ONE
//        round trip (it always opens on the most recent conversation, and a
//        second request for the thing we just listed is a wasted hop).
// POST — start a fresh conversation. No opener and no LLM call: unlike the JD
//        intake, the companion does not speak first — the dock renders a static
//        greeting from the catalog and the first spend happens when the operator
//        actually says something.
//
// Operator-gated like /api/intake. Both handlers are workspace-scoped; the store
// has no by-id exemptions (companion-tenancy.test.ts).

export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    const threads = listThreads(ws);
    const turns = threads.length > 0 ? listTurns(threads[0].id, ws) : [];
    // The newest thread's PROPOSALS ride along for the same reason its turns do:
    // the dock opens on that conversation and would otherwise paint an Accept
    // button for something the operator already answered, one round trip ago.
    const proposals = threads.length > 0 ? listProposalsForThread(threads[0].id, ws) : [];
    // Memory consent (WP4) rides along on the dock's ONE boot request, for the
    // same reason the turns do: the state line has to say "memory off" before a
    // single message is sent, and a second round trip for one boolean the DB
    // already answered would be a wasted hop. It is the cheap arm of the rule
    // only — a COUNT and a column read, never the probe spawn, which belongs to
    // the wizard that actually asks the question.
    return NextResponse.json({ threads, turns, proposals, memoryEnabled: companionMemoryEnabled(ws) });
  } catch (error) {
    return safeJsonError(error, "api:companion/threads", "COMPANION_THREADS_FAILED");
  }
}

export async function POST(request: Request) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    // No model call here, so this is row-spam protection rather than spend
    // protection — in open mode (no KP_OPERATOR_PASSWORD) the whole API is open
    // and an unbounded loop could fill the ledger. Far above human pace: a
    // conversation is a conversation, not sixty of them in ten minutes.
    if (!rateLimit(`companion-thread:${clientIpFrom(request.headers)}`, { limit: 60, windowMs: 10 * 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const ws = await currentWorkspace();
    // Titles are DERIVED, never typed (the store's contract) — the first
    // exchange renames the thread. It starts empty rather than "Untitled".
    return NextResponse.json(createThread("", ws));
  } catch (error) {
    return safeJsonError(error, "api:companion/threads", "COMPANION_THREAD_CREATE_FAILED");
  }
}
