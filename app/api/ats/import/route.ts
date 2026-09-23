import { NextRequest, NextResponse } from "next/server";
import { isAtsProvider } from "@/app/_lib/ats/connections-store";
import { ingestAtsApplications } from "@/app/_lib/ats/ingest";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { answerFailure, jsonRefusal, requireCapabilityCoded } from "@/app/_lib/api-response";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";

// W1.1 — POST /api/ats/import: file mapped ATS applications onto the board.
//
// Body: { provider, jobId, records: [<vendor application JSON>, …] }. The connection's
// stored field map reads each record; the vendor id is the sync identity, so a re-import
// is idempotent per team. The whole contract lives in app/_lib/ats/ingest.ts; this door
// only authorizes, bounds and answers.
//
// AUTHORIZATION — OPERATOR, like every other ATS door, then `pipeline:write` in the
// caller's team: this writes candidate rows onto that team's board from an EXTERNAL,
// untrusted payload. Nothing here spends money or spawns a process (the filing is a
// profile-less stub, no acknowledgement is sent), so no rate-limit bucket is owed.
//
// BOUNDS — the bytes read (a vendor record may carry a CV's text, so 2 MB) and the record
// count per call (a connector pages; one request is never a whole account).
const MAX_IMPORT_BODY_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_RECORDS = 100;

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  const body = await readJsonWithLimit<{ provider?: unknown; jobId?: unknown; records?: unknown }>(
    request,
    MAX_IMPORT_BODY_BYTES,
    {}
  );
  if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_IMPORT_BODY_BYTES });
  if (!isAtsProvider(body.provider)) return jsonRefusal("ATS_CONNECTION_PROVIDER_UNKNOWN", 400);
  if (typeof body.jobId !== "string" || !body.jobId.trim()) return jsonRefusal("ATS_IMPORT_JOB_NOT_FOUND", 404);
  if (!Array.isArray(body.records) || body.records.length === 0 || body.records.length > MAX_IMPORT_RECORDS) {
    return jsonRefusal("ATS_IMPORT_RECORDS_INVALID", 400, { maxRecords: MAX_IMPORT_RECORDS });
  }
  try {
    const report = await ingestAtsApplications({
      provider: body.provider,
      jobId: body.jobId.trim(),
      workspaceId: await currentWorkspace(),
      records: body.records,
    });
    return NextResponse.json(report);
  } catch (error) {
    // Refusals (connection missing/parked, job outside the team) answer their own code;
    // anything else is a store accident whose message stays in the server log.
    return answerFailure(error, "api:ats/import", "ATS_IMPORT_FAILED");
  }
}
