"use client";

// The board's data: one GET, aborted on unmount, with the failure resolved from
// the machine `code` rather than from the server's English `error` string
// (app/_lib/use-error-message.ts — the inverted fallback chain that shipped
// English to every locale on 84 call sites).
//
// FILTERING IS CLIENT-SIDE, deliberately. `GET /api/journeys` echoes its query
// back as `board.query` and could narrow server-side, but the rail's cohort
// figures ("38 of 45") are computed over the WHOLE role. Narrowing the payload
// would silently re-base them against the reader's current filter, which turns
// an honest cohort statement into a tautology. So the server pages by column and
// the client hides; `journeyFilters.filterBoard` leaves `totalColumns` alone for
// exactly the same reason.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { JourneyBoard } from "@/app/_lib/journey/types";

/** How many columns to ask for. The projection is a read over five append-only
 *  logs, so a page is cheap, but a board is a reading surface and not a dump. */
export const JOURNEY_PAGE_SIZE = 120;

export type JourneyBoardState = {
  board: JourneyBoard | null;
  loading: boolean;
  /** Already localized — render it, do not re-resolve it. */
  error: string | null;
  reload: () => void;
};

type ApiErrorBody = { error?: string; code?: string };

export function useJourneyBoard(): JourneyBoardState {
  const t = useTranslations("journey");
  const errMsg = useErrorMessage();
  const [board, setBoard] = useState<JourneyBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    // The cleanup below aborts the previous request, so a reload while one is in
    // flight never leaves two responses racing for the same state.
    const controller = new AbortController();
    let live = true;
    // NOT set synchronously here: calling setState in the effect body triggers a
    // cascading render (eslint react-hooks). The request is already in flight by
    // the time the microtask below runs, and `loading` starts true, so the only
    // case that needs the reset is a RELOAD - which the queueMicrotask covers
    // without a second synchronous render pass.
    queueMicrotask(() => {
      if (!live) return;
      setLoading(true);
      setError(null);
    });

    (async () => {
      try {
        const res = await fetch(`/api/journeys?limit=${JOURNEY_PAGE_SIZE}&offset=0`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        const body: unknown = await res.json().catch(() => null);
        if (!live) return;
        if (!res.ok) {
          setError(errMsg(body as ApiErrorBody, t("loadError")));
          setBoard(null);
          return;
        }
        setBoard(body as JourneyBoard);
      } catch (err) {
        // An abort is this hook doing its job, not a failure to report.
        if (!live || (err instanceof DOMException && err.name === "AbortError")) return;
        setError(t("loadError"));
        setBoard(null);
      } finally {
        if (live) setLoading(false);
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [nonce, t, errMsg]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { board, loading, error, reload };
}
