"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { DEFAULT_REGIME_ID, getRegime, type RegimeId } from "@/app/_lib/compliance-regimes";

// Candidate-facing transparency note. Our differentiator vs. opaque AI-hiring
// vendors: AI assists, a human decides, and assessment is on talent/fit.
// `showDataConsent` adds the data-processing + retention statement — passed only
// by the apply surfaces, where submitting IS the consent that's recorded
// (recordEntryConsent) with a KP_CONSENT_TTL_DAYS expiry and a self-service
// erasure link.
//
// P1-1 — the note is JURISDICTION-AWARE: it names the active regime's
// anti-discrimination framework + data law, and states the EFFECTIVE consent
// retention window (derived from KP_CONSENT_TTL_DAYS) instead of a hardcoded
// "12 months" (REC-08/capst-l1-005).
//
// HOW THOSE TWO FACTS ARRIVE — `regimeId` / `retentionMonths` props, resolved
// SERVER-side by `disclosureComplianceFor()` (app/_lib/compliance-disclosure.ts)
// from the workspace the surface has ALREADY established: the invite behind a
// /schedule token, the session behind an /interview token, the posting behind a
// /devcase/apply token, the offer behind an /offer token, the status link behind
// a /status token, the job behind /apply/[id]. When they are supplied this
// component opens no network connection at all.
//
// This replaces (scan-sweep 2026-08-05 → closed) a browser fetch of
// GET /api/compliance, which was wrong twice and both times toward
// UNDER-disclosure: the route is not on the public allow-list, so a deployment
// with KP_OPERATOR_PASSWORD set 401'd it and the EU/12-month pre-fetch default
// became the FINAL state; and it answers for the CALLER's workspace, which for an
// anonymous candidate is the default workspace rather than the one whose job they
// are reading. A client fetch cannot prove which tenant it is asking about, so no
// amount of allow-listing fixes the second half — see the comment in
// app/api/compliance/route.ts for why that route deliberately stays gated.
//
// THE FETCH PATH SURVIVES for the one caller that genuinely cannot be handed the
// values: `app/features/tools/interview/InterviewSimTab.tsx`, the recruiter-facing
// interview simulator inside the authenticated shell. It carries a session, so
// /api/compliance is both reachable AND tenant-correct there. Every PUBLIC surface
// passes the props, and `ai-disclosure-props.test.ts` fails if a new one does not.
//
// The EU default remains the last-resort fallback — it is the shipped behavior and
// the majority tenant — but on a candidate surface it should now be unreachable.
type CompliancePayload = { jurisdiction?: unknown; consentRetentionMonths?: unknown };

/** Mirrors the server default of 365 days (`consentTtlDays()`), for the fetch path
 *  only. A prop-fed surface never reads it. */
const DEFAULT_RETENTION_MONTHS = 12;

// One in-flight request per page load, shared by every mount. The disclosure is
// rendered on ~8 public candidate surfaces and QuickApplyForm alone mounts it in
// two branches, so the per-mount fetch meant an anonymous visitor could open the
// unauthenticated endpoint (and the decision-config store behind it) several
// times for a workspace setting that cannot change mid-visit. The promise is
// memoized, not the value, so concurrent mounts coalesce onto the same request.
let compliancePromise: Promise<CompliancePayload> | null = null;

function loadCompliance(): Promise<CompliancePayload> {
  if (!compliancePromise) {
    compliancePromise = fetch("/api/compliance")
      .then((r) => {
        // Status-blind parsing made a GATED response indistinguishable from a
        // successful one: the auth proxy answers `{"error":"Unauthorized"}` with
        // 401, which parses fine, yields no `jurisdiction`, and silently leaves
        // the EU default standing. Rejecting on !ok routes that through the same
        // failure path as a network error, so the endpoint being unreachable is a
        // real (and retried) failure rather than an invisible fallback.
        if (!r.ok) throw new Error(`compliance ${r.status}`);
        return r.json();
      })
      .catch((err) => {
        // Drop the memo on a hard failure so a later mount can retry — only the
        // SUCCESS is stable for the page's lifetime. (A gated 401 resolves with a
        // JSON error body, so it does not land here; that path is handled below.)
        compliancePromise = null;
        throw err;
      });
  }
  return compliancePromise;
}

export function AiDisclosure({
  className = "",
  showDataConsent = false,
  regimeId,
  retentionMonths,
}: {
  className?: string;
  showDataConsent?: boolean;
  /** The active compliance regime for THIS surface's workspace, resolved
   *  server-side (`disclosureComplianceFor`). Its presence is the discriminator:
   *  supplied, the component never fetches. */
  regimeId?: RegimeId;
  /** The enforced consent-retention window in whole months, resolved server-side
   *  by the same call. */
  retentionMonths?: number;
}) {
  const t = useTranslations("aiDisclosure");
  // Only ever written by the fetch fallback; a prop-fed surface leaves it empty
  // and the effect below never runs.
  const [fetched, setFetched] = useState<{ regimeId?: RegimeId; retentionMonths?: number }>({});
  const serverResolved = regimeId !== undefined;

  useEffect(() => {
    // The props ARE the answer — do not spend a request (which on a public surface
    // would be a 401 anyway) re-deriving a value we were handed authoritatively.
    if (serverResolved) return;
    let alive = true;
    loadCompliance()
      .then((d) => {
        if (!alive) return;
        setFetched({
          regimeId: typeof d?.jurisdiction === "string" ? (d.jurisdiction as RegimeId) : undefined,
          retentionMonths:
            typeof d?.consentRetentionMonths === "number" && d.consentRetentionMonths >= 1
              ? d.consentRetentionMonths
              : undefined,
        });
      })
      .catch(() => {
        /* keep the defaults — the universal body still stands */
      });
    return () => {
      alive = false;
    };
  }, [serverResolved]);

  // Precedence, most to least authoritative: the server-resolved prop, then the
  // session-bearing fetch, then the shipped EU / 12-month default. getRegime()
  // normalizes, so a regime this build does not know still lands on the default
  // rather than painting an empty jurisdiction.
  const regime = getRegime(regimeId ?? fetched.regimeId ?? DEFAULT_REGIME_ID);
  const months = retentionMonths ?? fetched.retentionMonths ?? DEFAULT_RETENTION_MONTHS;

  return (
    <div className={`rounded-md border border-stone-200 bg-paper/60 p-3 text-sm text-steel ${className}`}>
      <p className="flex items-center gap-1.5 font-semibold text-ink">
        <ShieldCheck size={14} className="text-moss" /> {t("title")}
      </p>
      <p className="mt-1">
        {t.rich("body", {
          highlight: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
        })}
      </p>
      <p className="mt-2 text-meta text-steel">
        {t("regimeNote", { framework: regime.antiDiscrimination, dataLaw: regime.dataLaw })}
      </p>
      {showDataConsent ? (
        <p className="mt-2 text-meta text-steel">{t("dataConsent", { months })}</p>
      ) : null}
    </div>
  );
}
