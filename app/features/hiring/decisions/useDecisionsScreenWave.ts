// State + fetch logic for the screening auto-reject wave modal: the override
// sliders, the debounced dry-run preview, and the (approval-token-gated)
// commit. Split out of DecisionsScreenWaveModal so that component's JSX stays
// under the 200-line cap.
//
// The lifecycle itself (preview -> confirm -> commit -> 409 -> re-preview, and
// the notice that must survive exactly one refresh) lives in the pure reducer
// `decisionsScreenWaveMachine.ts`, tested without a DOM. This hook is now only
// the network and the debounce: every state change goes through `dispatch`.
import { useEffect, useReducer, useState } from "react";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { SCREENING_DEFAULT } from "@/app/_lib/decision-config-schema";
import { INITIAL_WAVE_STATE, waveReduce } from "./decisionsScreenWaveMachine";
import type { WaveResult } from "./decisionsScreenWaveTypes";

export function useDecisionsScreenWave(
  jobId: string,
  onCommitted: (summary?: { commsFailures: number; failedLabels: string[] }) => void,
  previewFailedFallback: string,
  setChangedRepreviewFallback: string,
  waveFailedFallback: string
) {
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const [enabled, setEnabled] = useState(true);
  const [bottomPercent, setBottomPercent] = useState(SCREENING_DEFAULT.rejectBottomPercent);
  const [maxMatch, setMaxMatch] = useState(SCREENING_DEFAULT.maxMatchToReject);
  const [machine, dispatch] = useReducer(waveReduce, INITIAL_WAVE_STATE);
  const { preview, committed, loading, committing, error, confirmOpen, refreshNonce } = machine;

  const override = () => ({ autoRejectEnabled: enabled, rejectBottomPercent: bottomPercent, maxMatchToReject: maxMatch });

  // Debounced dry-run preview on open + whenever the override changes. Skipped once
  // committed (the modal then shows the committed result).
  useEffect(() => {
    if (committed) return;
    let alive = true;
    // Loading state is part of THIS data-fetching effect's lifecycle (started here,
    // settled below) — the legitimate fetch-in-effect pattern.
    dispatch({ type: "previewStarted" });
    const h = window.setTimeout(() => {
      fetch("/api/decisions/screen-wave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, override: override(), dryRun: true }),
      })
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(errMsg(d, previewFailedFallback));
          return d as WaveResult;
        })
        .then((d) => {
          if (alive) dispatch({ type: "previewSucceeded", result: d });
        })
        .catch((e) => {
          if (alive) dispatch({ type: "previewFailed", message: e instanceof Error ? e.message : previewFailedFallback });
        })
        .finally(() => {
          if (alive) dispatch({ type: "previewSettled" });
        });
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(h);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, bottomPercent, maxMatch, jobId, committed, refreshNonce]);

  const commit = async () => {
    dispatch({ type: "commitStarted" });
    try {
      const r = await fetch("/api/decisions/screen-wave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Echo the approval token from the previewed set the recruiter is looking at —
        // the server commits only if it still matches the live set (the Art. 22 gate).
        body: JSON.stringify({ jobId, override: override(), dryRun: false, approvalToken: preview?.approvalToken }),
      });
      const d = await r.json();
      // 409 = the set changed since the preview. The reducer arms the notice and bumps
      // the nonce, so the recruiter reviews and approves THIS set rather than a stale one.
      if (r.status === 409) {
        dispatch({ type: "commitConflict", message: errMsg(d, setChangedRepreviewFallback) });
        return;
      }
      if (!r.ok) throw new Error(errMsg(d, waveFailedFallback));
      const result = d as WaveResult;
      dispatch({ type: "commitSucceeded", result });
      // Live-refresh the queue so rejected rows drop out, AND hand up the comms
      // failures so the tab can surface them past this modal (Direction 2b).
      onCommitted({
        commsFailures: result.commsFailures,
        failedLabels: result.decisions.filter((x) => x.commsFailed).map((x) => x.label),
      });
    } catch (e) {
      dispatch({ type: "commitFailed", message: e instanceof Error ? e.message : waveFailedFallback });
    } finally {
      dispatch({ type: "commitSettled" });
    }
  };

  return {
    enabled, setEnabled,
    bottomPercent, setBottomPercent,
    maxMatch, setMaxMatch,
    preview, loading, error, committing, committed,
    confirmOpen,
    setConfirmOpen: (open: boolean) => dispatch({ type: open ? "confirmOpened" : "confirmClosed" }),
    commit,
  };
}
