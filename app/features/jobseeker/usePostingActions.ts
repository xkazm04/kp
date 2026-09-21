"use client";

import { useCallback, useState } from "react";
import type { DismissReason, JobseekerPostingSummary, PostingStatus } from "@/app/_lib/jobseeker/types";

// The seeker's status moves on a posting, shared by the feed card and the detail page:
// PATCH /api/jobseeker/postings/[id] { status, dismissReason?, note? } → the refreshed
// summary row, which the caller swaps in place. "Applied" ALSO opens the posting in a
// new tab (the seeker applies on the source's site; we only remember that they did),
// opened BEFORE the write so a popup blocker's refusal never leaves a status that says
// applied over a page nobody visited... and if the tab opens and the write fails, the
// error says so and the status stays where it was.

export type PostingActionError = { code: string | null };

export function usePostingActions(onUpdated: (row: JobseekerPostingSummary) => void) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<PostingActionError | null>(null);

  const setStatus = useCallback(
    async (id: string, status: Exclude<PostingStatus, "gone">, dismiss?: { reason: DismissReason; note: string }): Promise<boolean> => {
      if (busyId) return false;
      setBusyId(id);
      setError(null);
      try {
        const res = await fetch(`/api/jobseeker/postings/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, ...(dismiss ? { dismissReason: dismiss.reason, note: dismiss.note || undefined } : {}) }),
        });
        const body = (await res.json().catch(() => null)) as { posting?: JobseekerPostingSummary; code?: string } | null;
        if (!res.ok || !body?.posting) {
          setError({ code: body?.code ?? null });
          return false;
        }
        onUpdated(body.posting);
        return true;
      } catch {
        setError({ code: null });
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [busyId, onUpdated]
  );

  const markApplied = useCallback(
    (row: Pick<JobseekerPostingSummary, "id" | "url">) => {
      // noopener: the source page must not get a handle on the seeker's install.
      window.open(row.url, "_blank", "noopener,noreferrer");
      return setStatus(row.id, "applied");
    },
    [setStatus]
  );

  return { busyId, error, setStatus, markApplied, clearError: () => setError(null) };
}
