"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedNewSince, JobseekerDialog, JobseekerPostingSummary, JobseekerProfile, JobseekerSource } from "@/app/_lib/jobseeker/types";
import { classifyApiFailure, TRANSPORT_FAILURE, type ClassifiedFailure } from "../apiFailure";
import { callJson, type CatalogEntryView, type SourcesPayload } from "../sourcesApi";

// The flow's reads, in one place. The sieve draws EVERY posting (decided and gone rows
// included), so the rows are the postings route's `status=all` view paged through to the
// end with its keyset cursor — a few hundred summary rows, no bodies. The server page
// hands the first frame (profile, sources, catalog); this hook owns everything after:
// the rows, a background re-read of the sources, and the seeker's latest CV
// conversation (its artifact carries what the CV could not place and the edit
// suggestions the "You" step shows).

const PAGE = 100;
const MAX_PAGES = 30;

type Page = { rows?: JobseekerPostingSummary[]; nextCursor?: string | null; newSince?: FeedNewSince; code?: string };

export type SieveData = {
  profile: JobseekerProfile | null;
  setProfile(next: JobseekerProfile | null): void;
  rows: JobseekerPostingSummary[] | null;
  rowsError: ClassifiedFailure | null;
  newSince: FeedNewSince;
  reloadRows(): Promise<void>;
  replaceRow(row: JobseekerPostingSummary): void;
  sources: JobseekerSource[];
  catalog: CatalogEntryView[];
  setSources(next: JobseekerSource[] | ((prev: JobseekerSource[]) => JobseekerSource[])): void;
  reloadSources(): Promise<void>;
  cvDialog: JobseekerDialog | null;
  reloadDialogs(): Promise<void>;
};

type RowsResult = { ok: true; rows: JobseekerPostingSummary[]; newSince: FeedNewSince } | { ok: false; fail: ClassifiedFailure };

/** Page `status=all` to the end with the keyset cursor (capped at MAX_PAGES x PAGE). */
async function fetchAllRows(): Promise<RowsResult> {
  const all: JobseekerPostingSummary[] = [];
  let cursor: string | null = null;
  let newSince: FeedNewSince = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({ status: "all", limit: String(PAGE) });
    if (cursor) qs.set("cursor", cursor);
    let res: Response;
    let body: Page | null;
    try {
      res = await fetch(`/api/jobseeker/postings?${qs.toString()}`);
      body = (await res.json().catch(() => null)) as Page | null;
    } catch {
      return { ok: false, fail: TRANSPORT_FAILURE };
    }
    if (!res.ok || !body?.rows) return { ok: false, fail: classifyApiFailure(res, body) };
    if (page === 0) newSince = body.newSince ?? null;
    all.push(...body.rows);
    cursor = body.nextCursor ?? null;
    if (!cursor) break;
  }
  return { ok: true, rows: all, newSince };
}

export function useSieveData(initial: { profile: JobseekerProfile | null; sources: JobseekerSource[]; catalog: CatalogEntryView[] }): SieveData {
  const [profile, setProfile] = useState<JobseekerProfile | null>(initial.profile);
  const [rows, setRows] = useState<JobseekerPostingSummary[] | null>(null);
  const [rowsError, setRowsError] = useState<ClassifiedFailure | null>(null);
  const [newSince, setNewSince] = useState<FeedNewSince>(null);
  const [sources, setSources] = useState<JobseekerSource[]>(initial.sources);
  const [catalog, setCatalog] = useState<CatalogEntryView[]>(initial.catalog);
  const [cvDialog, setCvDialog] = useState<JobseekerDialog | null>(null);
  const generation = useRef(0);

  // Every setState sits in a promise callback (react-hooks/set-state-in-effect): the
  // paging itself is a plain async function that touches no state.
  const reloadRows = useCallback(() => {
    const mine = ++generation.current;
    return fetchAllRows().then((result) => {
      if (mine !== generation.current) return;
      if (!result.ok) {
        setRowsError(result.fail);
        return;
      }
      setRowsError(null);
      setNewSince(result.newSince);
      setRows(result.rows);
    });
  }, []);

  const reloadSources = useCallback(
    () =>
      callJson<SourcesPayload>("/api/jobseeker/sources").then((r) => {
        if (!r.ok) return;
        setSources(r.body.sources);
        setCatalog(r.body.catalog);
      }),
    []
  );

  // Keyed on the profile's ID: a preference save replaces the profile object, and that
  // is not a reason to re-read the conversations.
  const profileId = profile?.id ?? null;
  const reloadDialogs = useCallback(() => {
    // No profile, no conversation: the caller reads `cvDialog` only beside a profile.
    if (!profileId) return Promise.resolve();
    return callJson<{ dialogs?: JobseekerDialog[] }>(`/api/jobseeker/dialogs?profileId=${encodeURIComponent(profileId)}`).then((r) => {
      if (!r.ok) return;
      // The newest CV conversation, open or closed: its artifact is the latest reading.
      setCvDialog((r.body.dialogs ?? []).filter((d) => d.kind === "cv_polish").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null);
    });
  }, [profileId]);

  useEffect(() => {
    void reloadRows();
  }, [reloadRows]);
  useEffect(() => {
    void reloadDialogs();
  }, [reloadDialogs]);

  const replaceRow = useCallback((row: JobseekerPostingSummary) => {
    setRows((prev) => (prev ? prev.map((r) => (r.id === row.id ? row : r)) : prev));
  }, []);

  return { profile, setProfile, rows, rowsError, newSince, reloadRows, replaceRow, sources, catalog, setSources, reloadSources, cvDialog, reloadDialogs };
}
