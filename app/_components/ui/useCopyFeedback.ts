"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The two-second "Copied ✓" confirmation, once.
 *
 * Four surfaces had each pasted the same three lines — `setCopied(ok)` then a
 * bare `window.setTimeout(() => setCopied(false), 2000)` — and none of them
 * cleared the timer. A copy followed by a close (the report's list cards and
 * the soft-signals panel live inside tabs; the interview-prep copy lives inside
 * a modal) left a pending callback that fired setState on an unmounted tree, and
 * a second copy inside the window stacked a second timer that reset the label
 * early. Both are invisible in a screenshot and neither had a test.
 *
 * `mark(ok)` takes the OUTCOME of the copy, not a command: `copyText` returns
 * false when the clipboard is unavailable (insecure origin, denied permission),
 * and a false confirmation is the one thing this affordance must never show —
 * the same truthful-claim rule the delivery states follow. A failed copy leaves
 * the control in its idle state rather than lying green; a surface that wants to
 * SAY the copy failed wants `useCopyState` (app/features/hiring/channels),
 * which carries a third `failed` state and owns the clipboard call itself.
 */
export const COPY_FEEDBACK_MS = 2000;

/**
 * The pure half: what a copy outcome means for the confirmation state. Split out
 * so the rule ("only a successful copy confirms, and only a confirmation arms a
 * timer") is testable without a renderer.
 */
export function copyFeedbackPlan(ok: boolean, ms: number): { copied: boolean; resetAfterMs: number | null } {
  return { copied: ok, resetAfterMs: ok && ms > 0 ? ms : null };
}

export function useCopyFeedback(ms: number = COPY_FEEDBACK_MS): {
  copied: boolean;
  mark: (ok: boolean) => void;
} {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    []
  );
  const mark = useCallback(
    (ok: boolean) => {
      // A repeat copy inside the window restarts the countdown instead of
      // stacking a second one that would clear the label early.
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const plan = copyFeedbackPlan(ok, ms);
      setCopied(plan.copied);
      if (plan.resetAfterMs !== null) {
        timer.current = setTimeout(() => {
          timer.current = null;
          setCopied(false);
        }, plan.resetAfterMs);
      }
    },
    [ms]
  );
  return { copied, mark };
}
