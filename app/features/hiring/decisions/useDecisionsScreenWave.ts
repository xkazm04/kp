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
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { SCREENING_DEFAULT } from "@/app/_lib/decision-config-schema";
import { readWaveRefusal, readWaveResult } from "@/app/_lib/screen-wave-contract";
import { INITIAL_WAVE_STATE, REFUSAL_EFFECT, waveReduce } from "./decisionsScreenWaveMachine";
import type { WaveCommitSummary } from "./decisionsScreenWaveTypes";

export function useDecisionsScreenWave(
  jobId: string,
  onCommitted: (summary?: WaveCommitSummary) => void,
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
  const { preview, committed, loading, committing, error, confirmOpen, refreshNonce, commitBlocked, blockedMessage } = machine;

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
          // Typed only as far as errMsg needs; the contract readers below take it as unknown.
          const d = (await r.json()) as ApiErrorPayload | null;
          if (!r.ok) throw new Error(errMsg(d, previewFailedFallback));
          // Read through the contract's guard, never cast: a 200 whose shape is off
          // is a failed preview, not a clean zero-row set.
          const read = readWaveResult(d);
          if (!read.ok) throw new Error(previewFailedFallback);
          return read.result;
        })
        .then((result) => {
          if (alive) dispatch({ type: "previewSucceeded", result });
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
      // Typed only as far as errMsg needs; the contract readers below take it as unknown.
          const d = (await r.json()) as ApiErrorPayload | null;
      // 409 = an approval refusal, and its `reason` says which one. The reducer's
      // REFUSAL_EFFECT decides: re-preview a changed / aged / missing approval, block
      // the commit when no approver can be named, reload the queue when the wave
      // had in fact already landed.
      const refusal = readWaveRefusal(r.status, d);
      if (refusal) {
        dispatch({ type: "commitRefused", reason: refusal, message: errMsg(d, setChangedRepreviewFallback) });
        // A `spent` refusal means an earlier attempt of this commit DID land (a lost
        // response, then a retry): reload the queue behind the modal, so people
        // already rejected stop showing live buttons.
        if (REFUSAL_EFFECT[refusal].landedElsewhere) onCommitted();
        return;
      }
      if (!r.ok) throw new Error(errMsg(d, waveFailedFallback));
      const read = readWaveResult(d);
      // The wave may have committed while its body is unreadable: reload the queue
      // anyway, and say the result could not be shown rather than paint a clean one.
      if (!read.ok) {
        onCommitted();
        throw new Error(waveFailedFallback);
      }
      const result = read.result;
      dispatch({ type: "commitSucceeded", result });
      // Live-refresh the queue so rejected rows drop out, AND hand up comms
      // AND seal failures so the tab can surface them past this modal.
      onCommitted({
        commsFailures: result.commsFailures,
        failedLabels: result.decisions.filter((x) => x.commsFailed).map((x) => x.label),
        sealFailures: result.sealFailures,
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
    commitBlocked, blockedMessage,
    confirmOpen,
    setConfirmOpen: (open: boolean) => dispatch({ type: open ? "confirmOpened" : "confirmClosed" }),
    commit,
  };
}
