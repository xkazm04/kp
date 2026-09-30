"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { Gig, GigReport } from "@/app/_lib/gigs/types";
import { sendJson } from "../../data/useGigsData";
import type { AfterWrite } from "../../logic/wire";

/** How often the card re-reads the gig while its report is being written. */
const POLL_MS = 5000;
/** How long a Regenerate waits for the rewrite to show before it stops asking. */
const EXPECT_MS = 3 * 60_000;

export type ReportFileState = {
  report: GigReport | null;
  /** Writing now: the stored status says so, or a Regenerate was just accepted. */
  writing: boolean;
  busy: boolean;
  error: string | null;
  regenerate: () => Promise<void>;
};

/** The gig's HTML report as the Summary's card shows it (ReportFile.tsx). The list carries
 *  `gig.report`; while it is `writing` (or right after Regenerate, POST /api/gigs/[id]/report
 *  -> 202) the card re-reads GET /api/gigs/[id] every 5 s and shows what that answers, then
 *  re-reads the list once the rewrite lands, so the rest of the tab catches up. */
export function useReportFile(gig: Gig, onChanged: AfterWrite): ReportFileState {
  const t = useTranslations("gigs.report.file");
  const resolveError = useErrorMessage();
  const [fresh, setFresh] = useState<{ gigId: string; report: GigReport | null } | null>(null);
  const [expecting, setExpecting] = useState<{ since: string | null; until: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const id = gig.id;
  const report = fresh && fresh.gigId === id ? fresh.report : gig.report;
  const writing = report?.status === "writing" || expecting !== null;
  // What the last render knew, for the poll to tell a rewrite that LANDED from one not begun.
  const status = report?.status ?? null;
  const known = useRef({ status, expecting });
  useEffect(() => {
    known.current = { status, expecting };
  }, [status, expecting]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const poll = useCallback(async () => {
    let next: GigReport | null;
    try {
      const res = await fetch(`/api/gigs/${encodeURIComponent(id)}`);
      if (!res.ok) return;
      const body = (await res.json().catch(() => null)) as { gig?: Gig } | null;
      if (!body?.gig) return;
      next = body.gig.report ?? null;
    } catch {
      // Unreachable server: keep the card as it is and ask again on the next tick.
      return;
    }
    if (!alive.current) return;
    const before = known.current;
    const landed = next !== null && next.status !== "writing" && (before.status === "writing" || (before.expecting !== null && next.generatedAt !== before.expecting.since));
    setFresh({ gigId: id, report: next });
    setExpecting((e) => (!e ? e : next?.status === "writing" || (next && next.generatedAt !== e.since) || Date.now() > e.until ? null : e));
    if (landed) {
      // The rewrite landed: re-read the list, which now carries it, and stop overriding it.
      await onChanged(null);
      if (alive.current) setFresh(null);
    }
  }, [id, onChanged]);

  useEffect(() => {
    if (!writing) return;
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [writing, poll]);

  const regenerate = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await sendJson(`/api/gigs/${encodeURIComponent(id)}/report`, "POST", {});
    if (!alive.current) return;
    setBusy(false);
    if (!res.ok) return setError(resolveError(res.body as ApiErrorPayload | null, t("regenerateFailed")));
    setExpecting({ since: report?.generatedAt ?? null, until: Date.now() + EXPECT_MS });
  }, [id, report?.generatedAt, resolveError, t]);

  return { report, writing, busy, error, regenerate };
}
