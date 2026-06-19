import { NextRequest, NextResponse } from "next/server";
import { actOnPipelineEntry, listPipeline, recordAutomationEvent, type PipelineEntry } from "@/app/_lib/db";
import { runAutomationPass } from "@/app/_lib/automation-pass";
import { dispatchRejection } from "@/app/_lib/comms-dispatch";
import { describeCommand, isMutating, parseCommand, type ParsedCommand } from "@/app/_lib/pipeline-command";
import { safeJsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";

const PREVIEW_CAP = 50;

type PreviewRow = { id: string; label: string; score: number | null; jobTitle: string | null; stage: string };

// Resolve the candidate set a mutating command would touch (the preview). Read-
// only; never mutates. Empty for run_policy (it has no candidate preview — it runs
// the whole deterministic pass with its own fairness backstops).
function affected(cmd: ParsedCommand): PipelineEntry[] {
  const active = listPipeline().filter((e) => e.status === "active");
  if (cmd.kind === "reject_below") {
    const q = cmd.jobQuery?.toLowerCase() ?? null;
    return active.filter(
      (e) =>
        e.matchScore != null &&
        e.matchScore < cmd.threshold &&
        (!q || (e.jobTitle ?? "").toLowerCase().includes(q))
    );
  }
  if (cmd.kind === "advance_top") {
    return [...active]
      .filter((e) => e.matchScore != null && e.stage !== "Hired")
      .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
      .slice(0, cmd.count);
  }
  return [];
}

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
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { text?: string; confirm?: boolean };
    const cmd = parseCommand(typeof body.text === "string" ? body.text : "");

    if (cmd.kind === "help" || cmd.kind === "unknown") {
      return NextResponse.json({ kind: cmd.kind, description: describeCommand(cmd) });
    }

    const description = describeCommand(cmd);

    // Preview (no confirm): show what WOULD happen, execute nothing.
    if (!body.confirm) {
      const rows = affected(cmd).slice(0, PREVIEW_CAP).map(toRow);
      const total = cmd.kind === "run_policy" ? null : affected(cmd).length;
      return NextResponse.json({ kind: cmd.kind, description, mutating: isMutating(cmd), preview: rows, total });
    }

    // Execute.
    if (cmd.kind === "run_policy") {
      const result = await runAutomationPass();
      return NextResponse.json({ kind: cmd.kind, executed: true, description, summary: result.summary });
    }

    const targets = affected(cmd);
    let count = 0;
    let commsFailed = 0;
    for (const e of targets) {
      try {
        if (cmd.kind === "reject_below") {
          const updated = actOnPipelineEntry(e.id, "reject", `Command bar: below ${cmd.threshold}%`, { expectedStage: e.stage, actor: "human" });
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
                `Rejected via command bar, but the notification failed to queue — nudge manually. (${msg})`
              );
            }
          }
        } else if (cmd.kind === "advance_top") {
          if (actOnPipelineEntry(e.id, "accept", "Command bar: advance top", { expectedStage: e.stage, actor: "human" })) count += 1;
        }
      } catch (err) {
        console.error(`[pipeline:command] action failed for ${e.id}`, err);
      }
    }
    return NextResponse.json({ kind: cmd.kind, executed: true, description, count, ...(commsFailed ? { commsFailed } : {}) });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:command", "COMMAND_FAILED");
  }
}
