"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Gig, GigAttempt, GigKpi } from "@/app/_lib/gigs/types";
import type { CatalogEntry, GigsListAnswer, SourceRow, SpecialistRow } from "./gigsLogic";

// Every read the Gigs tab makes, in one hook. Four doors, each reloadable on its own, so
// a write re-reads exactly what it moved: an outcome re-reads the gigs AND the KPI (the
// rate re-derives from the server's own fold, never from a local guess), a source toggle
// re-reads the sources. A reload keeps what is on screen until the answer lands (loading
// choreography law 2), so a re-read never blanks the desk or resets its scroll.
//
// Failures are kept as a machine code, never the server's prose - the tab resolves them
// through useErrorMessage in the reader's language.

/** How many rows one page of GET /api/gigs carries (the route's own maximum). */
const PAGE = 200;
/** Pages read before the tab says it is showing a window rather than everything. */
const MAX_PAGES = 5;

export type LoadFailure = { code: string | null };

export type SendResult = { ok: boolean; status: number; body: Record<string, unknown> | null };

/** One write to a gigs route. Never throws: a transport failure answers status 0. */
export async function sendJson(url: string, method: "POST" | "PATCH", body: unknown): Promise<SendResult> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const parsed = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: res.ok, status: res.status, body: parsed };
  } catch {
    // A transport failure carries no response and no code: the caller shows its own
    // localized fallback, which is all there is to say.
    return { ok: false, status: 0, body: null };
  }
}

async function readJson<T>(url: string): Promise<{ data: T } | { failure: LoadFailure }> {
  try {
    const res = await fetch(url);
    const body = (await res.json().catch(() => null)) as (T & { code?: unknown }) | null;
    if (!res.ok || !body) return { failure: { code: body && typeof body.code === "string" ? body.code : null } };
    return { data: body };
  } catch {
    // Unreachable server: no code to resolve, the tab shows its generic load message.
    return { failure: { code: null } };
  }
}

export type GigsData = {
  gigs: Gig[] | null;
  attemptsByGig: Record<string, GigAttempt>;
  /** True when MAX_PAGES full pages were read and older rows may exist. */
  truncated: boolean;
  kpi: GigKpi | null;
  specialists: SpecialistRow[] | null;
  sources: SourceRow[] | null;
  catalog: CatalogEntry[] | null;
  failure: LoadFailure | null;
  reloadGigs: () => Promise<void>;
  /** Answers the KPI it read (null when the read failed), so a write can compare. */
  reloadKpi: () => Promise<GigKpi | null>;
  reloadSpecialists: () => Promise<void>;
  reloadSources: () => Promise<void>;
  /** Gigs + KPI: what every review and outcome write moves. Answers the new KPI. */
  reloadWork: () => Promise<GigKpi | null>;
  reloadAll: () => Promise<void>;
};

export function useGigsData(): GigsData {
  const [gigs, setGigs] = useState<Gig[] | null>(null);
  const [attemptsByGig, setAttempts] = useState<Record<string, GigAttempt>>({});
  const [truncated, setTruncated] = useState(false);
  const [kpi, setKpi] = useState<GigKpi | null>(null);
  const [specialists, setSpecialists] = useState<SpecialistRow[] | null>(null);
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reloadGigs = useCallback(async () => {
    const rows: Gig[] = [];
    const attempts: Record<string, GigAttempt> = {};
    let before: string | null = null;
    let pages = 0;
    let full = false;
    for (;;) {
      const qs = new URLSearchParams({ limit: String(PAGE) });
      if (before) qs.set("before", before);
      const r = await readJson<GigsListAnswer>(`/api/gigs?${qs.toString()}`);
      if ("failure" in r) {
        if (alive.current) setFailure(r.failure);
        return;
      }
      rows.push(...r.data.gigs);
      Object.assign(attempts, r.data.attemptsByGig);
      pages += 1;
      full = r.data.gigs.length === PAGE;
      if (!full || pages >= MAX_PAGES) break;
      before = r.data.gigs[r.data.gigs.length - 1].updatedAt;
    }
    if (!alive.current) return;
    setGigs(rows);
    setAttempts(attempts);
    setTruncated(full && pages >= MAX_PAGES);
    setFailure(null);
  }, []);

  const reloadKpi = useCallback(async (): Promise<GigKpi | null> => {
    const r = await readJson<GigKpi>("/api/gigs/kpi");
    if (!alive.current) return null;
    if ("failure" in r) {
      setFailure(r.failure);
      return null;
    }
    setKpi(r.data);
    return r.data;
  }, []);

  const reloadSpecialists = useCallback(async () => {
    const r = await readJson<{ specialists: SpecialistRow[] }>("/api/gigs/specialists");
    if (!alive.current) return;
    if ("failure" in r) setFailure(r.failure);
    else setSpecialists(r.data.specialists);
  }, []);

  const reloadSources = useCallback(async () => {
    const r = await readJson<{ sources: SourceRow[]; catalog: CatalogEntry[] }>("/api/gigs/sources");
    if (!alive.current) return;
    if ("failure" in r) setFailure(r.failure);
    else {
      setSources(r.data.sources);
      setCatalog(r.data.catalog);
    }
  }, []);

  const reloadWork = useCallback(async (): Promise<GigKpi | null> => {
    const [, next] = await Promise.all([reloadGigs(), reloadKpi()]);
    return next;
  }, [reloadGigs, reloadKpi]);

  const reloadAll = useCallback(async () => {
    await Promise.all([reloadGigs(), reloadKpi(), reloadSpecialists(), reloadSources()]);
  }, [reloadGigs, reloadKpi, reloadSpecialists, reloadSources]);

  useEffect(() => {
    // The first read of the tab, started as a callback (the useHiringComposer shape):
    // every setState happens after an await inside the loaders, never in this body.
    void Promise.resolve().then(reloadAll);
  }, [reloadAll]);

  return { gigs, attemptsByGig, truncated, kpi, specialists, sources, catalog, failure, reloadGigs, reloadKpi, reloadSpecialists, reloadSources, reloadWork, reloadAll };
}
