// State + fetch logic for the screening auto-reject wave modal: the override
// sliders, the debounced dry-run preview, and the (approval-token-gated)
// commit. Split out of DecisionsScreenWaveModal so that component's JSX stays
// under the 200-line cap.
import { useEffect, useState } from "react";
import { SCREENING_DEFAULT } from "@/app/_lib/decision-config-schema";
import type { WaveResult } from "./decisionsScreenWaveTypes";

export function useDecisionsScreenWave(
  jobId: string,
  onCommitted: (summary?: { commsFailures: number; failedLabels: string[] }) => void,
  previewFailedFallback: string,
  setChangedRepreviewFallback: string,
  waveFailedFallback: string
) {
  const [enabled, setEnabled] = useState(true);
  const [bottomPercent, setBottomPercent] = useState(SCREENING_DEFAULT.rejectBottomPercent);
  const [maxMatch, setMaxMatch] = useState(SCREENING_DEFAULT.maxMatchToReject);
  const [preview, setPreview] = useState<WaveResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<WaveResult | null>(null);
  // Two-step confirm before the irreversible commit (finding SD-5): the preview
  // doubles as the review, so a single click on the primary button would fire the
  // emailed, sealed, irreversible batch. This gates it behind an explicit confirm.
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Bumped to force a fresh preview (and a fresh approval token) after a 409 — the
  // cohort changed since the displayed preview, so the recruiter must review the
  // current set before approving it.
  const [refreshNonce, setRefreshNonce] = useState(0);

  const override = () => ({ autoRejectEnabled: enabled, rejectBottomPercent: bottomPercent, maxMatchToReject: maxMatch });

  // Debounced dry-run preview on open + whenever the override changes. Skipped once
  // committed (the modal then shows the committed result).
  useEffect(() => {
    if (committed) return;
    let alive = true;
    // Loading state is part of THIS data-fetching effect's lifecycle (true on start, false on
    // settle below) — the legitimate fetch-in-effect pattern, not a cascading-render concern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const h = window.setTimeout(() => {
      fetch("/api/decisions/screen-wave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, override: override(), dryRun: true }),
      })
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || `Preview failed (${r.status}).`);
          return d as WaveResult;
        })
        .then((d) => {
          if (alive) {
            setPreview(d);
            setError(null);
          }
        })
        .catch((e) => {
          if (alive) setError(e instanceof Error ? e.message : previewFailedFallback);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(h);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, bottomPercent, maxMatch, jobId, committed, refreshNonce]);

  const commit = async () => {
    setCommitting(true);
    setError(null);
    try {
      const r = await fetch("/api/decisions/screen-wave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Echo the approval token from the previewed set the recruiter is looking at —
        // the server commits only if it still matches the live set (the Art. 22 gate).
        body: JSON.stringify({ jobId, override: override(), dryRun: false, approvalToken: preview?.approvalToken }),
      });
      const d = await r.json();
      // 409 = the set changed since the preview. Re-preview the current set so the
      // recruiter reviews and approves THIS set, rather than rubber-stamping a stale one.
      if (r.status === 409) {
        setError(d.error || setChangedRepreviewFallback);
        setRefreshNonce((nonce) => nonce + 1);
        return;
      }
      if (!r.ok) throw new Error(d.error || `Wave failed (${r.status}).`);
      const result = d as WaveResult;
      setCommitted(result);
      // Live-refresh the queue so rejected rows drop out, AND hand up the comms
      // failures so the tab can surface them past this modal (Direction 2b).
      onCommitted({
        commsFailures: result.commsFailures,
        failedLabels: result.decisions.filter((x) => x.commsFailed).map((x) => x.label),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : waveFailedFallback);
    } finally {
      setCommitting(false);
      setConfirmOpen(false); // close the confirm step; result/error shows in the main modal
    }
  };

  return {
    enabled, setEnabled,
    bottomPercent, setBottomPercent,
    maxMatch, setMaxMatch,
    preview, loading, error, committing, committed,
    confirmOpen, setConfirmOpen,
    commit,
  };
}
