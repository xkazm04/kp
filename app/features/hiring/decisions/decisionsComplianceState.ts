// Jurisdiction picker state for DecisionsComplianceSection: loads the saved
// compliance config + the effective consent-retention window, and persists a
// jurisdiction change (with rollback on a failed save — finding SD-3). Split
// out of the section component so its JSX stays under the 200-line cap.
import { useEffect, useState } from "react";
import { DEFAULT_REGIME_ID, getRegime, type RegimeId } from "@/app/_lib/compliance-regimes";
import { foldJurisdiction, foldRecordingOffered, foldRetentionMonths, type RegimeConfidence } from "./decisionsComplianceFold";

export function useComplianceJurisdiction(standardFallback: string) {
  const [jurisdiction, setJurisdiction] = useState<RegimeId>(DEFAULT_REGIME_ID);
  // the-compliance-posture-never-guesses — how much of what is on screen the
  // server stands behind. Until the config read lands, the default regime is a
  // PLACEHOLDER; "loading" is its own state so the block never renders the
  // default as a confirmed choice for the duration of a slow read either.
  const [regimeConfidence, setRegimeConfidence] = useState<RegimeConfidence | "loading">("loading");
  // The last value the SERVER confirmed. The optimistic `jurisdiction` is reverted to
  // this on a failed save (finding SD-3) so the recruiter's posture block can't assert
  // a framing the candidate-facing /api/compliance disclosure never received. Plain
  // state, not a ref: the confidence label is derived from it, so a change to it has
  // to re-render. (No lost update: the picker is disabled while `saving`.)
  const [savedJurisdiction, setSavedJurisdiction] = useState<RegimeId>(DEFAULT_REGIME_ID);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<null | "saved" | "failed">(null);
  // The EFFECTIVE retention window (derived server-side from KP_CONSENT_TTL_DAYS)
  // so the posture line states the enforced number, not a hardcoded "12 months"
  // (REC-08). NULL until the server answers, and null FOREVER if it never does —
  // the line then says the window is not confirmed rather than naming a figure
  // nobody stands behind. The old default of 12 mirrored the server default and
  // was therefore right most of the time, which is precisely what made a wrong
  // one undetectable.
  const [retentionMonths, setRetentionMonths] = useState<number | null>(null);
  // WP3 — whether candidates are OFFERED an audio recording of their AI interview.
  // Three states on purpose (see foldRecordingOffered): `null` is "not read", and the
  // control stays DISABLED there, because the compliance row is written wholesale and a
  // click from an unread state would post the placeholder jurisdiction over the saved
  // one. Default OFF: no deployment starts holding candidate audio by accident.
  const [recordingOffered, setRecordingOffered] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/decisions/config")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((p) => {
        if (!alive) return;
        const read = foldJurisdiction(true, p);
        setRegimeConfidence(read.regime);
        setSavedJurisdiction(read.jurisdiction);
        setJurisdiction(read.jurisdiction);
        setRecordingOffered(foldRecordingOffered(true, p));
      })
      .catch(() => {
        // NOT swallowed: the failure IS the posture. Recording it is what lets the
        // section say the jurisdiction on screen is a placeholder, instead of
        // presenting the default as the workspace's saved choice.
        if (alive) setRegimeConfidence("failed");
      });
    fetch("/api/compliance")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => alive && setRetentionMonths(foldRetentionMonths(true, d)))
      .catch(() => {
        // Same rule: leaving `retentionMonths` null makes the posture line say the
        // window is unconfirmed. A number here would be a compliance claim invented
        // by a client-side default.
        if (alive) setRetentionMonths(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const pick = async (j: RegimeId) => {
    const prev = savedJurisdiction; // the last value the server confirmed
    setJurisdiction(j); // optimistic
    setSaving(true);
    setSaveState(null);
    try {
      const r = await fetch("/api/decisions/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "compliance", config: { jurisdiction: j } }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSavedJurisdiction(j); // committed — the disclosure now serves this regime
      setRegimeConfidence("saved"); // …and a successful write confirms the posture too
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

  /** Turn the candidate audio-recording offer on or off (WP3).
   *
   *  The compliance row is written WHOLESALE, so the jurisdiction rides along — which is
   *  exactly why this is refused until the config read has landed (`recordingOffered !==
   *  null`): posting the placeholder regime over a saved one to flip an unrelated flag
   *  would change the candidate-facing disclosure as a side effect. Optimistic with the
   *  same rollback as `pick`: a failed save must never leave the panel claiming an offer
   *  the interview portal is not making. */
  const toggleRecording = async (next: boolean) => {
    if (recordingOffered === null || saving) return;
    const prev = recordingOffered;
    setRecordingOffered(next);
    setSaving(true);
    setSaveState(null);
    try {
      const r = await fetch("/api/decisions/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "compliance", config: { jurisdiction: savedJurisdiction, interviewRecordingOffered: next } }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSaveState("saved");
    } catch {
      // Never a silent revert: the toggle goes back to the last value the SERVER
      // confirmed, and the shared saveState line says the write failed — a panel
      // showing "recording offered" that the portal never offers is the one state
      // this control must not be able to reach.
      setRecordingOffered(prev);
      setSaveState("failed");
    } finally {
      setSaving(false);
    }
  };

  const regime = getRegime(jurisdiction);
  const standard = regime.adverseImpactStandard ?? standardFallback;

  return { jurisdiction, regimeConfidence, saving, saveState, retentionMonths, pick, regime, standard, recordingOffered, toggleRecording };
}
