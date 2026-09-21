import { getActiveRegimeId } from "@/app/_lib/decision-config-store";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { consentRetentionMonths } from "@/app/_lib/consent";
import { normalizeRegimeId } from "@/app/_lib/compliance-regimes";
import { jsonOk, safeJsonError } from "@/app/_lib/api-response";


// P1-1 — the workspace's active compliance jurisdiction, plus the EFFECTIVE
// consent-retention window (derived from KP_CONSENT_TTL_DAYS) so the copy states
// the enforced number instead of a hardcoded "12 months" (REC-08/capst-l1-005).
//
// WHO READS THIS NOW. Session-bearing callers only: the recruiter Decisions
// compliance card (decisionsComplianceState.ts) and the interview simulator tab
// inside the authenticated shell. The PUBLIC candidate surfaces no longer call it
// — they receive `regimeId`/`retentionMonths` as props, resolved server-side from
// the token's own workspace by app/_lib/compliance-disclosure.ts. That is not a
// stylistic preference; see the tenancy note in the handler.
//
// SO THIS ROUTE STAYS GATED (it is deliberately absent from
// app/_lib/auth/public-routes.ts). Adding it to the allow-list would fix nothing:
// an anonymous request carries no workspace, so the answer would still be the
// default team's, and the only way to make it tenant-aware for a public caller
// would be a caller-supplied workspace id — which would let anyone enumerate any
// team's legal posture. A wrong answer that is also enumerable is worse than the
// gated one. The prop path is the real answer.
export async function GET() {
  // TENANCY — read the regime for the CALLER's workspace. Bare, getActiveRegimeId()
  // always answered for the default workspace: a team that had set its jurisdiction
  // to `us` still saw "EU equal-treatment directives / processed under GDPR" on its
  // Decisions compliance card, and shipped that same wrong law to its candidates.
  //
  // This closes the SESSION-BEARING half, which since the prop path landed is the
  // ONLY half this route serves. The candidate half — where the information duty
  // actually bites (GDPR Art. 13) — is resolved before the HTML is sent, from the
  // workspace behind the schedule / interview / devcase / offer / status token or
  // the job id, because a client fetch cannot prove which tenant's job the
  // candidate is looking at. AiDisclosure.tsx's header carries the full account.
  //
  // consentRetentionMonths() stays global on purpose: it derives from the
  // KP_CONSENT_TTL_DAYS env knob, which is a deployment-level setting with no
  // per-workspace tier to read.
  //
  // SHAPED ENVELOPE. This handler had no try/catch and a bare NextResponse.json, and
  // it is not infallible: getActiveRegimeId opens the decision-config store’s own
  // SQLite connection, so a locked / corrupt / unreachable database threw straight out
  // and Next answered its framework 500 — a body neither consumer can read, on the
  // route that feeds the CANDIDATE-facing AI disclosure. safeJsonError logs the thrown
  // detail server-side (SQLITE_* text, the absolute db path) and puts a code on the
  // wire, which the client resolves through errors.<CODE> in the reader’s language.
  try {
    return jsonOk({
      // Normalized at this read boundary as well as in the store: this value is rendered
      // as a legal framework, so a stale or hand-edited row must land on the EU default
      // rather than paint an empty jurisdiction (compliance-regimes.test.ts).
      jurisdiction: normalizeRegimeId(getActiveRegimeId(await currentWorkspace())),
      consentRetentionMonths: consentRetentionMonths(),
    });
  } catch (error) {
    return safeJsonError(error, "api:compliance", "COMPLIANCE_LOOKUP_FAILED");
  }
}
