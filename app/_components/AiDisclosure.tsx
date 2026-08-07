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
// P1-1 — the note is JURISDICTION-AWARE. It self-resolves the workspace's active
// compliance regime from GET /api/compliance (this is a client component on
// public pages, so it can't read the DB directly) and names that regime's
// anti-discrimination framework + data law. The same fetch carries the EFFECTIVE
// retention window (derived server-side from KP_CONSENT_TTL_DAYS), so the consent
// sentence states the enforced duration instead of a hardcoded "12 months"
// (REC-08/capst-l1-005); the pre-fetch default 12 mirrors the server default of
// 365 days.
//
// KNOWN GAP — read before trusting the regime line (scan-sweep 2026-08-05).
// It defaults to "eu" until the fetch lands. An earlier revision of this comment
// claimed that means "there's never a flash of WRONG content"; that is only true
// for an EU workspace. For a us/uk/sg/in/ae workspace the first paint asserts
// "Assessed under EU equal-treatment directives; …processed under GDPR", which is
// simply the wrong law, and it is the FINAL state whenever the fetch cannot
// resolve. Two reasons it may not, both outside this file:
//   1. /api/compliance is NOT on the public allow-list (app/_lib/auth/
//      public-routes.ts), so on any deployment with KP_OPERATOR_PASSWORD set the
//      proxy 401s it and no candidate ever gets the real regime.
//   2. app/api/compliance/route.ts calls getActiveRegimeId() with no workspaceId,
//      so it answers for DEFAULT_WORKSPACE_ID regardless of which workspace's job
//      the candidate is actually looking at.
// The durable fix for both is to resolve the regime SERVER-side from the token's
// workspace and pass it in as a prop; the client fetch cannot know the tenant.
// Keeping the EU default meanwhile is a deliberate call (it is the shipped
// behavior and the majority tenant), not an oversight.
type CompliancePayload = { jurisdiction?: unknown; consentRetentionMonths?: unknown };

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
}: {
  className?: string;
  showDataConsent?: boolean;
}) {
  const t = useTranslations("aiDisclosure");
  const [regimeId, setRegimeId] = useState<RegimeId>(DEFAULT_REGIME_ID);
  const [retentionMonths, setRetentionMonths] = useState(12);

  useEffect(() => {
    let alive = true;
    loadCompliance()
      .then((d) => {
        if (!alive) return;
        if (typeof d?.jurisdiction === "string") setRegimeId(d.jurisdiction as RegimeId);
        if (typeof d?.consentRetentionMonths === "number" && d.consentRetentionMonths >= 1) {
          setRetentionMonths(d.consentRetentionMonths);
        }
      })
      .catch(() => {
        /* keep the defaults — the universal body still stands */
      });
    return () => {
      alive = false;
    };
  }, []);

  const regime = getRegime(regimeId);

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
        <p className="mt-2 text-meta text-steel">{t("dataConsent", { months: retentionMonths })}</p>
      ) : null}
    </div>
  );
}
