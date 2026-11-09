import { NextRequest } from "next/server";
import { getPipelineEntry } from "@/app/_lib/db/pipeline";
import { route } from "@/app/_lib/auth/workspace-context";
import { withRateLimit } from "@/app/_lib/auth/route-guards";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonOk, jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom } from "@/app/_lib/rate-limit";
import { isRelayConfigured } from "@/app/_lib/comms-relay";
import { deliveryClaim } from "@/app/_lib/comms-truth";
import { entryContactability } from "@/app/_lib/comms-contactability";
import { sendWorkSample } from "@/app/_lib/stage-hooks-homework";

// POST → the candidate drawer's "Send work sample" (CX S43). Sends the role's approved
// assignment to ONE named candidate through the SAME function the homework column's
// arrival hook uses (`sendWorkSample` → `inviteToCase`, app/_lib/stage-hooks-homework.ts),
// so a board with no homework column can still hand a candidate their work sample.
//
// The person's click IS the human gate; every other rule of the arrival holds: the send
// gate before anything is published, one letter per (entry, posting), a stopped intake
// never reopened, and no case designed from a click (`no_case` names the next step).
//
// AUTH: operator + `pipeline:write` (it MAILS a candidate on the team's behalf, the
// schedule-invite door's posture) + a per-client throttle so a loop cannot flood the
// relay. The answer is a STATE for every non-fault outcome — the drawer renders each one
// in the reader's language — and `delivery` is the truthful claim (sent / queued / failed).
export const POST = route(
  withRateLimit({ key: ({ ws, request }) => `work-sample:${ws}:${clientIpFrom(request.headers)}`, limit: 30, windowMs: 60_000 })
)(async (ws: string, request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  // The session gate, then the seat's authority — in the handler, the shape every
  // /api/pipeline/** door shares (pipeline/batch/authz-parity.test.ts): a viewer seat is
  // refused with a code before anything is read.
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  try {
    const { id } = await context.params;
    const entry = getPipelineEntry(id, ws);
    if (!entry) return jsonRefusal("PIPELINE_ENTRY_NOT_FOUND", 404);
    // Read off the SERVER row, never the drawer's snapshot: a candidate closed out in
    // another tab is not sent an assignment for a step they will never take.
    if (entry.status !== "active") return jsonRefusal("WORK_SAMPLE_ENTRY_INACTIVE", 409);
    // A coded suppression (consent lapsed, erased, halted) answers with ITS code, the
    // reason the channel itself would give. sendWorkSample re-checks before publishing.
    const contactable = entryContactability(entry, "case_invite");
    if (!contactable.ok && contactable.code) return jsonRefusal(contactable.code, 409);

    const res = await sendWorkSample(entry, ws, { origin: new URL(request.url).origin });
    switch (res.outcome) {
      case "invited":
        return jsonOk({ state: "invited", url: res.url, delivery: deliveryClaim(isRelayConfigured(), res.delivery) });
      case "already_invited":
        return jsonOk({ state: "already_invited", url: res.url });
      case "no_case":
        return jsonOk({ state: "no_case", jobId: entry.jobId ?? null });
      case "skipped":
        return jsonOk({ state: "agent" });
      case "failed":
        return jsonOk({ state: "refused", reason: res.reason, jobId: entry.jobId ?? null });
    }
  } catch (error) {
    return safeJsonError(error, "api:pipeline:work-sample", "WORK_SAMPLE_SEND_FAILED");
  }
});
