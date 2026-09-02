import { NextRequest, NextResponse } from "next/server";
import { countPipelineByStage, migratePipelineStages, type StageMigration } from "@/app/_lib/db/pipeline";
import { setDecisionConfig } from "@/app/_lib/decision-config-store";
import { validateDecisionConfig, type PipelineStagesRule } from "@/app/_lib/decision-config-schema";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { getPipelineAxis } from "@/app/_lib/pipeline-axis-server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

// Apply a board-shape change AND the candidate moves it forces, as one operation.
//
// Its own route rather than a flag on /api/decisions/config, because the two
// halves are one decision: "remove this column, and send the people on it to
// that one". Splitting them across two calls would let a client perform half —
// which is exactly the stranding this whole phase exists to prevent.
//
// ORDER: candidates move FIRST, the axis is written SECOND. The two live behind
// separate SQLite connections (the decision-config store opens its own), so a
// single transaction cannot span them, and the order decides what a failure
// between them looks like:
//   • moves-then-axis (this): a failed axis write leaves candidates already moved
//     to a column that still exists. Odd-looking, fully recoverable, nobody lost.
//   • axis-then-moves: a failed move leaves candidates on a column the board no
//     longer draws. That is the failure mode we are here to eliminate.
// The moves themselves ARE atomic with their audit events (migratePipelineStages
// runs one IMMEDIATE transaction), so the partial state above is the only one
// reachable, and it is benign.
//
// THE FAILURE MESSAGE SAYS SO. STAGE_MIGRATION_FAILED used to read "Nothing was
// saved" — the opposite of what this order guarantees: a throw from
// setDecisionConfig lands with the candidates ALREADY moved. It now tells the
// operator that people may have moved and to re-open the step editor, which is the
// only honest reading of the ordering above. Making the route atomic instead is not
// available: the two stores are separate SQLite connections, so no transaction can
// span them, and reversing the order trades a benign partial state for the exact
// stranding this phase exists to prevent.

type Body = { config?: unknown; migrate?: unknown };

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => null)) as Body | null;
    const validated = validateDecisionConfig("pipelineStages", body?.config);
    // The validator's own detail rides as DATA beside the code: it names a field,
    // which the operator editing the axis needs, but it is English prose and must
    // never be the thing the UI paints.
    if (!validated.ok) return jsonRefusal("PIPELINE_AXIS_INVALID", 400, { detail: validated.error });
    const next = validated.config as PipelineStagesRule;

    const ws = await currentWorkspace();
    const current = getPipelineAxis(ws);
    const nextIds = new Set(next.stages.map((s) => s.id));
    const removed = current.stages.filter((s) => !nextIds.has(s.id)).map((s) => s.id);

    // The mapping the operator supplied: removedStageId -> destination.
    const raw = (body?.migrate ?? {}) as Record<string, unknown>;
    const migrations: StageMigration[] = [];
    for (const [fromStage, toStage] of Object.entries(raw)) {
      if (typeof toStage !== "string") {
        return jsonRefusal("PIPELINE_MIGRATION_MAPPING_INVALID", 400, { fromStage });
      }
      // A SOURCE must be a column the new axis no longer draws — one this edit
      // removes, or one already retired and still holding stranded candidates.
      // Migrating off a step the new axis KEEPS is not a move any shape change
      // forces: it would silently empty a live column (and answer `removed: []`
      // while doing it). The composer never asks for that, which is precisely why
      // the server must not accept it — the same "the client's Save button is a
      // courtesy, this is the guarantee" posture as the occupancy recount below.
      if (nextIds.has(fromStage)) {
        return jsonRefusal("PIPELINE_MIGRATION_MAPPING_INVALID", 400, { fromStage, reason: "source_kept" });
      }
      // A destination must exist on the NEW axis. Mapping onto another column
      // this same edit removes would move candidates from one hole into another.
      if (!nextIds.has(toStage)) {
        return jsonRefusal("PIPELINE_MIGRATION_MAPPING_INVALID", 400, { fromStage, toStage, reason: "target_missing" });
      }
      migrations.push({ fromStage, toStage });
    }

    // The server does not take the client's word for who is stranded: it
    // recomputes occupancy here. A removal with occupants and no mapping is
    // refused — the client's Save button is a courtesy, this is the guarantee.
    const counts = countPipelineByStage(ws);
    const mapped = new Set(migrations.map((m) => m.fromStage));
    const unmapped = removed.filter((id) => (counts[id] ?? 0) > 0 && !mapped.has(id));
    if (unmapped.length > 0) {
      return jsonRefusal("PIPELINE_MIGRATION_REQUIRED", 409, {
        unmapped: unmapped.map((id) => ({ stage: id, count: counts[id] ?? 0 })),
      });
    }

    const moved = migratePipelineStages(migrations, ws);
    // Team-tier override: this workspace's own board, not the org baseline.
    setDecisionConfig("pipelineStages", next as unknown as Record<string, unknown>, ws, "team");
    return NextResponse.json({ ok: true, moved, removed });
  } catch (error) {
    return safeJsonError(error, "api:pipeline/stage-migration", "STAGE_MIGRATION_FAILED");
  }
}
