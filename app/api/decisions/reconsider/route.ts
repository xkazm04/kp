import { NextResponse } from "next/server";
import { listReconsiderQueue } from "@/app/_lib/db";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { withCanonicalScores } from "@/app/_lib/match-score-resolve";
import { listDecisionRecordsForRefs } from "@/app/_lib/decision-record-store";


// Recruiter-facing "Reconsider" queue (idea-e43fa801): the auto-rejected cohort a
// recruiter can put back for a fresh look. Projects the rejection time + the
// canonical match number with its provenance, PLUS the sealed auto-reject reason
// (reconsider-earns-keep) so an audit isn't a bare list — the recruiter sees WHY
// each candidate fell out (bottom-% / threshold / rank), read back from the very
// decision record the screening wave sealed, and WHERE the score came from.
// Operator-gated (backlog #30 / SD-L1-010): rejected candidates' names/roles are
// adverse-action data, so the handler re-verifies the session (and rejects the
// anonymous demo session) like the rest of /api/decisions/*. Tenant (P1): scoped to
// the caller's team so one team never reviews another's auto-rejected candidates.
export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  const ws = await currentWorkspace();
  const items = listReconsiderQueue(50, ws);
  // Stamp the canonical score + provenance for the whole (bounded) batch through
  // the same read path the board/drawer/queue use, so the reconsider row shows THE
  // match number with an honest "from CV analysis · <date>" / "snapshot at add"
  // label — never a bare snapshot that silently disagrees with the rest of the app.
  const scored = withCanonicalScores(
    items.map((i) => i.entry),
    ws
  );
  // decision-io-diet: read every candidate's sealed records in ONE chunked query up
  // front, instead of a per-row SELECT inside the map below (up to 50 queries per load,
  // on every live-refresh). Per-ref semantics are byte-identical to the old per-row read.
  const recordsByRef = listDecisionRecordsForRefs(
    items.map(({ entry }) => entry.id),
    { workspaceId: ws, limit: 20 }
  );
  const projected = items.map(({ entry, rejectedAt }, idx) => {
    const canonical = scored[idx];
    // Read back the sealed auto-reject reason from the decision record store the
    // wave wrote (reasonCode + the decisive inputs = reasonParams), NOT a new store.
    // The latest auto_rejected seal for this entry carries the structured rationale;
    // the client renders it through the same decisions.wave.reasons.* catalog the
    // screen-wave modal uses, so a Czech recruiter reads a Czech reason. Best-effort:
    // a candidate whose seal failed / predates the SoR simply shows no reason line.
    const record = (recordsByRef.get(entry.id) ?? []).find(
      (r) => r.kind === "auto_rejected"
    );
    let reason: { reasonCode: string; reasonParams: Record<string, string | number> } | null = null;
    if (record) {
      let params: Record<string, string | number> = {};
      try {
        const inputs = (JSON.parse(record.payloadJson) as { inputs?: unknown }).inputs;
        if (inputs && typeof inputs === "object") params = inputs as Record<string, string | number>;
      } catch {
        /* unreadable payload — fall back to the code with no interpolation */
      }
      reason = { reasonCode: record.reasonCode, reasonParams: params };
    }
    return {
      id: entry.id,
      candidateLabel: entry.candidateLabel,
      jobTitle: entry.jobTitle,
      archetype: entry.archetype,
      matchScore: canonical.canonicalScore,
      scoreProvenance: canonical.scoreProvenance,
      rejectedAt,
      reason,
    };
  });
  return NextResponse.json({ items: projected });
}
