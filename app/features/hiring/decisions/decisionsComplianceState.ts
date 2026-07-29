// Jurisdiction picker state for DecisionsComplianceSection: loads the saved
// compliance config + the effective consent-retention window, and persists a
// jurisdiction change (with rollback on a failed save — finding SD-3). Split
// out of the section component so its JSX stays under the 200-line cap.
import { useEffect, useRef, useState } from "react";
import { DEFAULT_REGIME_ID, getRegime, REGIME_IDS, type RegimeId } from "@/app/_lib/compliance-regimes";

export function useComplianceJurisdiction(standardFallback: string) {
  const [jurisdiction, setJurisdiction] = useState<RegimeId>(DEFAULT_REGIME_ID);
  // The last value the SERVER confirmed. The optimistic `jurisdiction` is reverted to
  // this on a failed save (finding SD-3) so the recruiter's posture block can't assert
  // a framing the candidate-facing /api/compliance disclosure never received.
  const savedJurisdiction = useRef<RegimeId>(DEFAULT_REGIME_ID);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<null | "saved" | "failed">(null);
  // The EFFECTIVE retention window (derived server-side from KP_CONSENT_TTL_DAYS)
  // so the posture line states the enforced number, not a hardcoded "12 months"
  // (REC-08). Default 12 mirrors the server default of 365 days.
  const [retentionMonths, setRetentionMonths] = useState(12);

  useEffect(() => {
    fetch("/api/decisions/config")
      .then((r) => r.json())
      .then((p: { configs?: { compliance?: { jurisdiction?: unknown } } }) => {
        const j = p?.configs?.compliance?.jurisdiction;
        if (typeof j === "string" && (REGIME_IDS as readonly string[]).includes(j)) {
          savedJurisdiction.current = j as RegimeId;
          setJurisdiction(j as RegimeId);
        }
      })
      .catch(() => {});
    fetch("/api/compliance")
      .then((r) => r.json())
      .then((d: { consentRetentionMonths?: unknown }) => {
        if (typeof d?.consentRetentionMonths === "number" && d.consentRetentionMonths >= 1) {
          setRetentionMonths(d.consentRetentionMonths);
        }
      })
      .catch(() => {});
  }, []);

  const pick = async (j: RegimeId) => {
    const prev = savedJurisdiction.current; // the last value the server confirmed
    setJurisdiction(j); // optimistic
    setSaving(true);
    setSaveState(null);
    try {
      const r = await fetch("/api/decisions/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "compliance", config: { jurisdiction: j } }),
      });
      if (!r.ok) throw new Error();
      savedJurisdiction.current = j; // committed — the disclosure now serves this regime
      setSaveState("saved");
    } catch {
      // The POST never landed: revert the optimistic switch to the last PERSISTED
      // value so the recruiter view can't diverge from the candidate disclosure
      // (finding SD-3). The picker is disabled while `saving`, so no newer
      // selection can be clobbered by this rollback.
      setJurisdiction(prev);
      setSaveState("failed");
    } finally {
      setSaving(false);
    }
  };

  const regime = getRegime(jurisdiction);
  const standard = regime.adverseImpactStandard ?? standardFallback;

  return { jurisdiction, saving, saveState, retentionMonths, pick, regime, standard };
}
