import { NextResponse } from "next/server";
import { route } from "@/app/_lib/auth/workspace-context";
import { withOperator } from "@/app/_lib/auth/route-guards";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonOk, requireCapabilityCoded } from "@/app/_lib/api-response";
import { demoChoicePending, recordEmptyChoice, seedDemoOnDemand } from "@/app/_lib/db/demo-seed";

// The first-run data choice (operator triage T1): a fresh install no longer seeds the demo
// corpus at boot, so '/' asks "start empty, or explore with demo data?" (app/setup/
// FirstRunDataChoice.tsx) and posts the answer here.
//
//   GET                      -> { pending }   whether the choice is still open for this workspace
//   POST { choice: "empty" } -> { outcome: "recorded" }       the answer is stored; nothing seeds
//   POST { choice: "demo" }  -> { outcome: "seeded" | "already-seeded" }   the corpus lands (idempotent)
//                            -> 409 { outcome: "refused-has-data" | "refused-workspace" }
//
// Gated like the other studio/workspace writes: an operator session (open mode folds to
// owner) holding the team-admin seat, because seeding fills the whole team's board. The
// refusal outcomes are DATA the client renders in the reader's language — no server prose
// travels (docs/architecture/api-contracts.md §1.1). Not rate-limited: it spends no money,
// spawns nothing, and a repeat is a no-op.
export const GET = route(withOperator)(async (ws: string) => {
  return jsonOk({ pending: demoChoicePending(ws) });
});

export const POST = route(withOperator)(async (ws: string, request: Request) => {
  const denied = await requireCapabilityCoded("team:manage", requireCapability);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { choice?: unknown } | null;
  const choice = body?.choice;
  if (choice !== "empty" && choice !== "demo") {
    return NextResponse.json({ outcome: "bad-choice" }, { status: 400 });
  }
  try {
    if (choice === "empty") {
      recordEmptyChoice(ws);
      return jsonOk({ outcome: "recorded" });
    }
    const outcome = seedDemoOnDemand(ws);
    return jsonOk({ outcome }, outcome.startsWith("refused") ? 409 : 200);
  } catch (error) {
    // The raw error stays in the server log; the client shows its own localized line.
    console.error("[api:setup/first-run] seed failed", error);
    return NextResponse.json({ outcome: "failed" }, { status: 500 });
  }
});
