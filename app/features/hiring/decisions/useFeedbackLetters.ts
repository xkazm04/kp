// The feedback-requests queue read for the Decisions tab (spark interview-feedback-letter,
// WP-beta): GET /api/decisions/feedback-letters on mount, on the live-refresh bus, and
// after every decision the editor lands. Its own hook rather than a slice of
// useDecisionsQueue: the section is self-contained, and the tab shell mounts it with one
// line.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveRefresh } from "@/app/features/shell/live-refresh";
import type { FeedbackLetterQueueItem } from "@/app/_lib/interview-letter-review";
import { createTicketGate } from "./decisionsLatestWins";

export type FeedbackLettersLoadFailure = { code: string | null; status: number | null };

export function useFeedbackLetters() {
  // null until the first read settles: the section stays unmounted rather than flashing
  // an empty state that might be false.
  const [items, setItems] = useState<FeedbackLetterQueueItem[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [failure, setFailure] = useState<FeedbackLettersLoadFailure | null>(null);
  // Latest wins (decisionsLatestWins.ts): the read fires from mount, the live-refresh bus
  // and after every decision, so a slow earlier response must not re-list a letter the
  // recruiter just approved away.
  const gate = useRef(createTicketGate());

  const reload = useCallback(() => {
    const ticket = gate.current.take();
    fetch("/api/decisions/feedback-letters")
      .then(async (r) => ({ ok: r.ok, status: r.status, body: (await r.json().catch(() => null)) as Record<string, unknown> | null }))
      .then(({ ok, status, body }) => {
        if (!gate.current.isLatest(ticket)) return;
        if (ok && Array.isArray(body?.items)) {
          setItems(body.items as FeedbackLetterQueueItem[]);
          setTruncated(body.truncated === true);
          setFailure(null);
          return;
        }
        // A refused or broken read keeps the last good list and says why, by CODE.
        setFailure({ code: typeof body?.code === "string" ? body.code : null, status });
      })
      .catch(() => {
        if (gate.current.isLatest(ticket)) setFailure({ code: null, status: null });
      });
  }, []);

  useEffect(() => {
    // The gate object is created once and never replaced; capturing it keeps the ref out
    // of the cleanup body.
    const g = gate.current;
    reload();
    return () => g.invalidate(); // an unmounted tab writes nothing
  }, [reload]);
  useLiveRefresh(reload);

  return { items, truncated, failure, reload };
}
