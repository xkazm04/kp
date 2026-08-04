"use client";

import { useState } from "react";

export type ApplyFollowupState = "open" | "sending" | "sent" | "dismissed";

/**
 * The post-accept profile-gap follow-up's state and its POST.
 *
 * Answers to the gap questions are keyed by check id. Purely additive: the
 * application is ALREADY FILED before this block ever renders, so every state
 * here is a courtesy — never a blocker.
 *
 * `saveFailedMessage` arrives already localized: this is a plain module with no
 * component around it, so it cannot call `useTranslations` itself.
 */
export function useApplyFollowup({
  jobId,
  saveFailedMessage,
}: {
  jobId: string;
  saveFailedMessage: string;
}) {
  const [gapAnswers, setGapAnswers] = useState<Record<string, string>>({});
  const [gapState, setGapState] = useState<ApplyFollowupState>("open");
  const [gapError, setGapError] = useState<string | null>(null);

  const setGapAnswer = (check: string, value: string) => setGapAnswers((a) => ({ ...a, [check]: value }));

  const dismissGaps = () => setGapState("dismissed");

  // Wipe the block back to its opening state — part of a start-over, which
  // rewinds the whole conversation including any outcome it had reached.
  const resetGaps = () => {
    setGapAnswers({});
    setGapState("open");
    setGapError(null);
  };

  // Post the answered gap questions. Runs AFTER the application is filed, so every
  // failure mode is cosmetic: a network blip leaves an inline note and the answers
  // in the boxes, and closing the tab costs the candidate nothing they had.
  const submitGapAnswers = async (followupToken: string | null | undefined) => {
    if (gapState === "sending" || !followupToken) return;
    const filled = Object.fromEntries(
      Object.entries(gapAnswers).filter(([, v]) => v.trim() !== "")
    );
    if (Object.keys(filled).length === 0) {
      setGapState("dismissed");
      return;
    }
    setGapState("sending");
    setGapError(null);
    try {
      const res = await fetch(`/api/apply/${jobId}/followup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The capability token, not the entry id — the server re-resolves it and
        // requires the entry to belong to this job.
        body: JSON.stringify({ lead: followupToken, answers: filled }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setGapState("sent");
    } catch {
      setGapState("open");
      setGapError(saveFailedMessage);
    }
  };

  return { gapAnswers, gapState, gapError, setGapAnswer, dismissGaps, resetGaps, submitGapAnswers };
}
