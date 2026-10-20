"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { Gig, GigProposal, GigReport } from "@/app/_lib/gigs/types";
import { sendJson } from "../../data/useGigsData";
import type { AfterWrite } from "../../logic/wire";

/** How often the row re-reads the gig while its file is being written. */
const POLL_MS = 5000;
/** How long a write request waits for the rewrite to show before it stops asking. */
const EXPECT_MS = 3 * 60_000;

/** The two files kp writes for a gig and keeps on its record: the internal report and, on
 *  the proposal track, the client proposal. Both live at `gig.<kind>` and are written by
 *  POST /api/gigs/[id]/<kind> (202). */
export type GigFileKind = "report" | "proposal";
type FileOf<K extends GigFileKind> = K extends "report" ? GigReport : GigProposal;

export type GigFileState<R> = {
  file: R | null;
  /** Writing now: the stored status says so, or a write was just accepted. */
  writing: boolean;
  busy: boolean;
  error: string | null;
  /** Ask for the file to be written again; true when the server accepted it. */
  write: () => Promise<boolean>;
};

/** One of the gig's files as the Summary (and the sign-off) shows it. The list carries
 *  `gig.<kind>`; while it is `writing` (or right after a write request, which answers 202) the
 *  hook re-reads GET /api/gigs/[id] every 5 s and shows what that answers, then re-reads the
 *  list once the rewrite lands, so the rest of the tab catches up. `gig` may be null (a proof
 *  whose gig is gone): nothing is read. */
export function useGigFile<K extends GigFileKind>(gig: Gig | null, kind: K, onChanged: AfterWrite, failedText: string): GigFileState<FileOf<K>> {
  const resolveError = useErrorMessage();
  const [fresh, setFresh] = useState<{ gigId: string; file: FileOf<K> | null } | null>(null);
  const [expecting, setExpecting] = useState<{ since: string | null; until: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const id = gig?.id ?? "";
  const stored = (gig ? gig[kind] : null) as FileOf<K> | null;
  const file = fresh && fresh.gigId === id ? fresh.file : stored;
  const writing = file?.status === "writing" || expecting !== null;
  // What the last render knew, for the poll to tell a rewrite that LANDED from one not begun.
  const status = file?.status ?? null;
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
    let next: FileOf<K> | null;
    try {
      const res = await fetch(`/api/gigs/${encodeURIComponent(id)}`);
      if (!res.ok) return;
      const body = (await res.json().catch(() => null)) as { gig?: Gig } | null;
      if (!body?.gig) return;
      next = (body.gig[kind] ?? null) as FileOf<K> | null;
    } catch {
      // Unreachable server: keep the row as it is and ask again on the next tick.
      return;
    }
    if (!alive.current) return;
    const before = known.current;
    const landed = next !== null && next.status !== "writing" && (before.status === "writing" || (before.expecting !== null && next.generatedAt !== before.expecting.since));
    setFresh({ gigId: id, file: next });
    setExpecting((e) => (!e ? e : next?.status === "writing" || (next && next.generatedAt !== e.since) || Date.now() > e.until ? null : e));
    if (landed) {
      // The rewrite landed: re-read the list, which now carries it, and stop overriding it.
      await onChanged(null);
      if (alive.current) setFresh(null);
    }
  }, [id, kind, onChanged]);

  useEffect(() => {
    if (!writing || !id) return;
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [writing, id, poll]);

  const write = useCallback(async () => {
    if (!id) return false;
    setBusy(true);
    setError(null);
    const res = await sendJson(`/api/gigs/${encodeURIComponent(id)}/${kind}`, "POST", {});
    if (!alive.current) return false;
    setBusy(false);
    if (!res.ok) {
      setError(resolveError(res.body as ApiErrorPayload | null, failedText));
      return false;
    }
    setExpecting({ since: file?.generatedAt ?? null, until: Date.now() + EXPECT_MS });
    return true;
  }, [id, kind, file?.generatedAt, resolveError, failedText]);

  return { file, writing, busy, error, write };
}

/** A stored fallback code in the reader's words (the brief's vocabulary), else the code as
 *  written, else "no reason given". Shared by the report and proposal rows. */
export function useFallbackWhy() {
  const t = useTranslations("gigs.report.file");
  const tb = useTranslations("gigs.brief");
  return (code: string | null) => {
    const key = code?.startsWith("llm_error") ? "llm_error" : code;
    return key && tb.has(`fallback.${key}` as Parameters<typeof tb>[0]) ? tb(`fallback.${key}` as Parameters<typeof tb>[0]) : (code ?? "").replace(/_/g, " ") || t("noReason");
  };
}
