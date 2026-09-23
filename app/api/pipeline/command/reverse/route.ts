// Undo a command-bar reject wave (challenge-r05 pipeline-actions-commands/B).
//   POST /api/pipeline/command/reverse  { ids: string[] (<= 200), threshold?: 1..100, text?: string }
//        -> { restored, notified, skipped }   (see ../reverse.ts)
// `text` is the command the recruiter typed, parsed by the SAME parser the command
// route used, so the client never re-derives the threshold.
//
// AUTH: gated exactly like POST /api/pipeline/command — operator session, then the
// seat's `pipeline:write` — because an undo is a write of the same weight as the
// reject it reverses. The reversal is sealed to the SESSION's actor, never the body.
// Not rate-limited: it spends nothing and spawns nothing, and every id it touches is
// bounded by WAVE_REVERSAL_CAP and the caller's own workspace.

import { NextRequest, NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { humanActor } from "@/app/_lib/auth/operator-approver";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { parseCommand } from "@/app/_lib/pipeline-command";
import { reverseCommandWave, WAVE_REVERSAL_CAP } from "../reverse";

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  try {
    const ws = await currentWorkspace();
    const body = (await request.json().catch(() => ({}))) as { ids?: unknown; threshold?: unknown; text?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
    if (ids.length === 0) return jsonRefusal("PIPELINE_BATCH_PAYLOAD_INVALID", 400);
    if (ids.length > WAVE_REVERSAL_CAP) return jsonRefusal("PIPELINE_BATCH_PAYLOAD_INVALID", 400, { max: WAVE_REVERSAL_CAP });

    let threshold: number | null = null;
    if (typeof body.threshold === "number" && Number.isInteger(body.threshold) && body.threshold >= 1 && body.threshold <= 100) {
      threshold = body.threshold;
    } else if (typeof body.text === "string") {
      const cmd = parseCommand(body.text);
      if (cmd.kind === "reject_below") threshold = cmd.threshold;
    }
    if (threshold === null) return jsonRefusal("PIPELINE_BATCH_PAYLOAD_INVALID", 400);

    const actor = await humanActor();
    const counts = reverseCommandWave({ ids, threshold, workspaceId: ws, actor });
    return NextResponse.json(counts);
  } catch (error) {
    return safeJsonError(error, "api:pipeline:command:reverse", "COMMAND_FAILED");
  }
}
