"use client";

// The SECOND detail layer, fetched only when the reader asks for it.
//
// Layer one — actor, both clocks, phase, what changed, topic — is already in the
// row the board drew, so opening the fact card costs nothing. Layer two is the
// evidence behind the sentence: a transcript excerpt, a sealed decision record,
// an analysis. The board never renders a raw transcript inline; "Open the
// source" (`journey.detail.openSource`) is a deliberate second step, and this
// hook is what it spends.
//
// ─────────────────────────────────────────────────────────────────────────────
// ASSUMPTION, flagged because the route does not exist in this tree yet.
// P3's brief names `GET /api/journeys/[entryId]`, and the payload it returns is
// `JourneyEventDetail`, which is keyed by ONE `eventId`. An entry has many
// events, so the event has to be named somewhere: this hook passes it as
// `?event=<id>` and accepts either shape back — a single `JourneyEventDetail`,
// or a list of them to pick from. If P1 lands a different spelling, this is the
// one function to change.
//
// Its corollary is a real gap and not a shortcut: a SHARED job-definition row
// belongs to the role, not to any entry, so there is no `entryId` to address it
// by. Those rows get the fact card and `journey.detail.noSource`; see the note
// in JourneyFactCard.tsx.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { JourneyEventDetail } from "@/app/_lib/journey/types";

export type JourneyDetailState = {
  detail: JourneyEventDetail | null;
  loading: boolean;
  error: string | null;
};

function pickDetail(body: unknown, eventId: string): JourneyEventDetail | null {
  if (body === null || typeof body !== "object") return null;
  if (Array.isArray(body)) {
    const hit = body.find((d) => (d as JourneyEventDetail)?.eventId === eventId);
    return (hit as JourneyEventDetail | undefined) ?? null;
  }
  const record = body as { events?: unknown; eventId?: unknown };
  if (Array.isArray(record.events)) return pickDetail(record.events, eventId);
  return typeof record.eventId === "string" ? (body as JourneyEventDetail) : null;
}

export function useJourneyDetail(): JourneyDetailState & {
  load: (entryId: string, eventId: string) => void;
  reset: () => void;
} {
  const t = useTranslations("journey");
  const errMsg = useErrorMessage();
  const [state, setState] = useState<JourneyDetailState>({ detail: null, loading: false, error: null });
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ detail: null, loading: false, error: null });
  }, []);

  const load = useCallback(
    (entryId: string, eventId: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ detail: null, loading: true, error: null });
      (async () => {
        try {
          const url = `/api/journeys/${encodeURIComponent(entryId)}?event=${encodeURIComponent(eventId)}`;
          const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
          const body: unknown = await res.json().catch(() => null);
          if (controller.signal.aborted) return;
          if (!res.ok) {
            setState({ detail: null, loading: false, error: errMsg(body as { code?: string }, t("loadError")) });
            return;
          }
          setState({ detail: pickDetail(body, eventId), loading: false, error: null });
        } catch (err) {
          if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
          setState({ detail: null, loading: false, error: t("loadError") });
        }
      })();
    },
    [t, errMsg]
  );

  return { ...state, load, reset };
}
