import { NextRequest, NextResponse } from "next/server";
import type { PipelineEntry } from "@/app/_lib/db/core";
import { actOnPipelineEntry, listPipeline, recordAutomationEvent } from "@/app/_lib/db/pipeline";
import { runAutomationPass } from "@/app/_lib/automation-pass";
import { dispatchRejection } from "@/app/_lib/comms-dispatch";
import { affected, describeCommand, isMutating, parseCommand, resolveRejectTargets } from "@/app/_lib/pipeline-command";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";


const PREVIEW_CAP = 50;

type PreviewRow = { id: string; label: string; score: number | null; jobTitle: string | null; stage: string };

const toRow = (e: PipelineEntry): PreviewRow => ({
  id: e.id,
  label: e.candidateLabel,
  score: e.matchScore,
  jobTitle: e.jobTitle,
  stage: e.stage,
});

// Recruiter-facing NL command surface (#7). POST {text} previews; POST
// {text, confirm:true} executes. Every mutating intent maps to the SAME guarded
// actions the board/automation already use (actOnPipelineEntry actor:"human",
// runAutomationPass) — the command bar is a parse + preview convenience, not a new
// privilege.
//
// AUTH (perfect-board): operator-gated like /api/decisions/* and screen-wave.
// This is the board's most powerful mutation surface — one call can bulk-reject
// (with candidate emails) across the workspace OR trigger the global policy pass
// (run_policy) — so it re-verifies the operator session as defense in depth:
// proxy.ts already keeps it off the public allow-list, and requireOperator
// additionally rejects the anonymous demo-workspace session the proxy would wave
// through. In open mode (no KP_OPERATOR_PASSWORD) this is a no-op, so local dev
// and the guided sim (which drive the board through the per-card routes, never
// this bar) are unaffected.
export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    // Tenant scope: preview AND execute operate ONLY on the caller's workspace.
    const ws = await currentWorkspace();
    const body = (await request.json().catch(() => ({}))) as { text?: string; confirm?: boolean; confirmIds?: unknown };
    const cmd = parseCommand(typeof body.text === "string" ? body.text : "");

    if (cmd.kind === "help" || cmd.kind === "unknown") {
      return NextResponse.json({ kind: cmd.kind, description: describeCommand(cmd) });
    }

    const description = describeCommand(cmd);

    // Preview (no confirm): show what WOULD happen, execute nothing. Resolve the
    // affected set ONCE — the row slice and the total both read it (run_policy has
    // no candidate preview, so its total is null and the scan is skipped).
    if (!body.confirm) {
      const hits = cmd.kind === "run_policy" ? [] : affected(cmd, listPipeline(ws));
      const rows = hits.slice(0, PREVIEW_CAP).map(toRow);
      const total = cmd.kind === "run_policy" ? null : hits.length;
      // matchedIds is the FULL previewed id set — only the RENDERED rows are capped
      // at PREVIEW_CAP, ids are cheap (pipeline-board-candidate-drawer #2). The
      // reject_below confirm binds to this (not the 50 rendered ids), so confirming
      // "reject below N%" on a 120-match cohort rejects all 120 the recruiter was
      // told it "affects", not just the first 50 — while resolveRejectTargets still
      // drops any id that stopped matching between preview and confirm.
      const matchedIds = cmd.kind === "run_policy" ? [] : hits.map((e) => e.id);
      return NextResponse.json({ kind: cmd.kind, description, mutating: isMutating(cmd), preview: rows, total, matchedIds });
    }

    // Execute.
    if (cmd.kind === "run_policy") {
      // run_policy runs the deterministic GLOBAL policy pass — the SAME sweep the
      // scheduler heartbeat runs. It spans teams by design and scopes every WRITE
      // to each entry's own workspace (automation-pass.ts), so it can never mutate
      // one tenant's rows under another's; the operator gate above is what keeps a
      // non-operator (or the demo session) from triggering it at all.
      const result = await runAutomationPass();
      return NextResponse.json({ kind: cmd.kind, executed: true, description, summary: result.summary });
    }

    // The live still-matching set at execute time — same workspace scope as the preview.
    const matching = affected(cmd, listPipeline(ws));
    // bug-ui pipeline #3 — a reject_below confirm binds to the PREVIEWED id set
    // (carried on the confirm POST): execute only on ids that were shown to the
    // recruiter AND still match, so a candidate scored below the line in the gap
    // between preview and confirm can never be silently rejected + emailed. Any
    // previewed id that dropped out (no longer matching) is reported, not acted
    // on. An absent confirmIds (older client) keeps the prior act-on-current-set
    // behavior. advance_top is non-destructive (no email), so it is unbound.
    let droppedOut = 0;
    let targets = matching;
    if (cmd.kind === "reject_below" && Array.isArray(body.confirmIds)) {
      const previewedIds = body.confirmIds.filter((x): x is string => typeof x === "string");
      const { act, droppedOut: dropped } = resolveRejectTargets(previewedIds, matching.map((e) => e.id));
      const actSet = new Set(act);
      targets = matching.filter((e) => actSet.has(e.id));
      droppedOut = dropped.length;
    }
    let count = 0;
    let commsFailed = 0;
    // advance_top targets already AT Offer that were held instead of advanced —
    // reported so "advance top N" never silently swallows part of its N.
    let heldAtOffer = 0;
    for (const e of targets) {
      try {
        if (cmd.kind === "reject_below") {
          const updated = actOnPipelineEntry(e.id, "reject", `Command bar: below ${cmd.threshold}%`, { expectedStage: e.stage, actor: "human" }, ws);
          if (updated) {
            count += 1;
            // A bulk reject must NEVER ghost the candidate (UAT M3): the command bar
            // used to flip status + audit only, while the screen-wave notified — so
            // the FASTEST reject surface was the one that went silent. Mirror the
            // wave: queue the rejection comm with per-candidate isolation so one
            // comms blip neither aborts the batch nor hides who wasn't told.
            try {
              await dispatchRejection(updated);
            } catch (commsError) {
              commsFailed += 1;
              const msg = commsError instanceof Error ? commsError.message : String(commsError);
              console.warn(`[pipeline:command] rejection comms failed for ${e.id}: ${msg}`);
              recordAutomationEvent(
                e.id,
                "rejection_comms_failed",
                `Rejected via command bar, but the notification failed to queue — nudge manually. (${msg})`,
                ws
              );
            }
          }
        } else if (cmd.kind === "advance_top") {
          // Hired is OUTCOME-bearing (same rule as the /api/pipeline/[id] 422
          // guard): it is reached only when the CANDIDATE accepts an extended
          // offer. A bare accept on an Offer-stage entry used to fall through to
          // the generic one-stage advance — silently "hiring" the candidate and
          // DESTROYING any drafted offer (actOnPipelineEntry clears the
          // offer_review approval). advance-top-N therefore advances UP TO
          // Offer and STOPS there: Offer-stage targets are held and reported
          // (`heldAtOffer`) so the recruiter routes them through the offer flow.
          if (e.stage === "Offer") {
            heldAtOffer += 1;
          } else if (actOnPipelineEntry(e.id, "accept", "Command bar: advance top", { expectedStage: e.stage, actor: "human" }, ws)) {
            count += 1;
          }
        }
      } catch (err) {
        console.error(`[pipeline:command] action failed for ${e.id}`, err);
      }
    }
    return NextResponse.json({
      kind: cmd.kind,
      executed: true,
      description,
      count,
      ...(commsFailed ? { commsFailed } : {}),
      ...(heldAtOffer ? { heldAtOffer } : {}),
      ...(droppedOut ? { droppedOut } : {}),
    });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:command", "COMMAND_FAILED");
  }
}
