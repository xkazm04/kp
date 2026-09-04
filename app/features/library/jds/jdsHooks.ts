"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import { heldAsRevision } from "./jdsLedgerArtifacts";
import type { JdDetail, JdRow } from "./jdsLibrary";

// Shared JD-list fetch for the two-level surface: same abort-on-unmount +
// deferred-kickoff contract the original LibraryTab used, extracted so all three
// styling variants read one list and one reload path.
export function useJdLibrary() {
  const [rows, setRows] = useState<JdRow[] | null>(null);
  // The library's real size and whether the route cut the page it answered. `rows`
  // is one PAGE (GET /api/jds clamps at JDS_PAGE_MAX_LIMIT), so `rows.length` was
  // never a library total — the footer said so anyway until these two arrived.
  // Null total = an answer that did not carry the field; the footer then states no M.
  const [total, setTotal] = useState<number | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The banner this `error` paints (JdsSavedLedgerPanel) sits in a fully localized
  // console, so the copy must be too. It used to be two hand-written ENGLISH
  // strings ("Couldn't load your library (status 500).") shown verbatim to cs/de/fr
  // recruiters. GET /api/jds already answers with a machine code (safeJsonError →
  // JD_LIST_FAILED), and that code is in the shared `errors` catalog in all four
  // locales — so the honest line was there all along, just never read.
  //
  // Read straight from the catalog rather than through `useErrorMessage`: that
  // resolver is a fresh closure on every render, and putting it in `load`'s deps
  // would re-create `load` → re-fire the mount effect → refetch in a loop. This
  // route has exactly ONE failure code, so the resolver could only ever return
  // this same string anyway.
  const loadFailed = useTranslations("errors")("JD_LIST_FAILED");

  // `silent` fetches WITHOUT blanking rows to the skeleton — for the analyzing-JD
  // poll, which must update rows in place rather than flicker the whole table every
  // few seconds. The initial load and user-triggered reloads blank as before.
  const load = useCallback(
    async (signal?: AbortSignal, opts?: { silent?: boolean }) => {
      setError(null);
      if (!opts?.silent) setRows(null);
      try {
        const res = await fetch("/api/jds", { signal });
        // Both failure shapes (a non-2xx, and the throw below) resolve to the SAME
        // localized line, so there is nothing to carry through an Error message.
        if (!res.ok) {
          setError(loadFailed);
          return;
        }
        const payload = await res.json();
        if (signal?.aborted) return;
        setRows((payload.jds as JdRow[]) ?? []);
        setTotal(typeof payload.total === "number" ? payload.total : null);
        setTruncated(payload.truncated === true);
      } catch (caught) {
        if (signal?.aborted || (caught instanceof DOMException && caught.name === "AbortError")) return;
        // A dropped connection / unparseable 200 body throws the BROWSER's own
        // English message ("Failed to fetch"), so `caught.message` is never
        // surfaced — the localized load-failure line is honest for both paths.
        setError(loadFailed);
      }
    },
    [loadFailed]
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  // In-place refresh (no skeleton flash) — used by the analyzing-JD poll.
  const refresh = useCallback(() => {
    void load(undefined, { silent: true });
  }, [load]);

  return { rows, total, truncated, error, reload, refresh };
}

// Detail fetch behind the modal: keyed on the open slug. The modal only mounts
// with a real slug, so status initializes to "loading" (never a flash of the
// error/empty branch). The reset + fetch run inside a deferred 0 ms callback —
// the same kickoff the list loader uses — so no setState fires synchronously in
// the effect body (react-hooks/set-state-in-effect).
export function useJdDetail(slug: string | null) {
  const [jd, setJd] = useState<JdDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Shared fetch. `silent` refreshes in place (no skeleton flash) — the analyzing
  // detail polls this until the build finishes.
  const fetchDetail = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!slug) return;
      if (!opts?.silent) {
        setStatus("loading");
        setJd(null);
      }
      // ?intent=1 — the detail modal states the template / output language /
      // seniority this JD was BUILT with (build_input_json), which the plain
      // payload deliberately strips as internal authoring material. This surface
      // is the recruiter's own gated Ledger, the same caller the Duplicate flow
      // already reads it as, so requesting it here exposes nothing new.
      fetch(`/api/jds/${encodeURIComponent(slug)}?intent=1`)
        .then((r) => {
          if (!r.ok) throw new Error();
          return r.json();
        })
        .then((data) => {
          setJd(data as JdDetail);
          setStatus("ready");
        })
        .catch(() => setStatus("error"));
    },
    [slug]
  );

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    // Deferred kickoff (no synchronous setState in the effect body).
    const timer = window.setTimeout(() => {
      if (!cancelled) fetchDetail();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [slug, fetchDetail]);

  const refresh = useCallback(() => fetchDetail({ silent: true }), [fetchDetail]);

  return { jd, status, refresh };
}

export type ActionState = "idle" | "busy" | "error";

// Turn a pasted JD into a matchable role via the hardened ingest bridge. Reports
// the (possibly pre-existing) job id up so the success band can deep-link to it.
export function useIngestJob(slug: string, onDone: (jobId: string | null) => void) {
  const [state, setState] = useState<ActionState>("idle");
  // The machine `code` from the failed response — the ONLY thing a caller may turn
  // into a message (app/_lib/use-error-message.ts). Before this the response body
  // was thrown away entirely and both callers painted a coral icon with one generic
  // tooltip, so a rate-limit refusal (429 TOO_MANY_REQUESTS) and an operator gate
  // (401) were indistinguishable from a parse failure — and nothing was announced.
  // null when the failure carried no code (a dropped connection, an unparseable body).
  const [code, setCode] = useState<string | null>(null);
  const run = useCallback(async () => {
    setState((s) => (s === "busy" ? s : "busy"));
    setCode(null);
    try {
      const r = await fetch(`/api/jds/${encodeURIComponent(slug)}/ingest-job`, { method: "POST" });
      const payload = (await r.json().catch(() => null)) as { jobId?: string; code?: string } | null;
      if (!r.ok) {
        setCode(typeof payload?.code === "string" ? payload.code : null);
        setState("error");
        return;
      }
      setState("idle");
      onDone(typeof payload?.jobId === "string" ? payload.jobId : null);
    } catch {
      // A dropped connection carries no code; the caller's own localized fallback
      // is the honest line there.
      setState("error");
    }
  }, [slug, onDone]);
  return { state, code, run };
}

/**
 * Which JDs got their generated body HELD AS A REVISION rather than published.
 *
 * `bodyHeldAsRevision` is produced by runJdBuild and persisted NOWHERE on the JD
 * row — the row flips to `ready` exactly as an ordinary build does, and the only
 * record is the jd_build task's result. So the ledger joins each row to its
 * `analysis_task_id` and reads that result.
 *
 * Cost control matters here: GET /api/tasks/[id] is one request per task and a
 * library can hold hundreds of rows. Two bounds keep it cheap. (1) Only rows whose
 * task is in the POLLED recent-task window are candidates — that window is small
 * and bounded by the server, and a build old enough to have aged out is old enough
 * that the recruiter has seen the outcome. (2) Every task id is fetched at most
 * once per mount (`seen`), success or failure, so a 404 for a pruned task cannot
 * re-fetch on every poll tick.
 *
 * Returns the set of SLUGS whose build was held. Empty until the fetches land —
 * the chip simply appears a beat later, which is the honest shape for a fact that
 * lives behind a second request.
 */
export function useHeldBuilds(rows: JdRow[] | null): Set<string> {
  const { tasks, fetchTask } = useTasks();
  const [heldTasks, setHeldTasks] = useState<Set<string>>(() => new Set());
  const seen = useRef<Set<string>>(new Set());

  // The rows whose build FINISHED and whose task is still in the polled window.
  // Deliberately NOT filtered by `seen` here: a ref must not be read during render
  // (react-hooks/refs — a render that depends on a ref does not re-run when it
  // changes), so the once-only guard lives inside the effect below.
  const candidates = (rows ?? [])
    .filter((r) => r.analysis_status !== "analyzing" && Boolean(r.analysis_task_id))
    .map((r) => r.analysis_task_id as string)
    .filter((id) => tasks.some((t) => t.id === id && t.status === "succeeded"));
  // A stable key so the effect re-runs when the candidate SET changes, not on
  // every poll tick that re-creates the same array.
  const candidateKey = candidates.join(",");

  useEffect(() => {
    if (!candidateKey) return;
    const ids = candidateKey.split(",").filter((id) => !seen.current.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => seen.current.add(id));
    let cancelled = false;
    void Promise.all(ids.map((id) => fetchTask(id).then((task) => [id, heldAsRevision(task?.result)] as const))).then(
      (pairs) => {
        if (cancelled) return;
        const held = pairs.filter(([, isHeld]) => isHeld).map(([id]) => id);
        if (held.length === 0) return;
        setHeldTasks((prev) => {
          const next = new Set(prev);
          held.forEach((id) => next.add(id));
          return next;
        });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [candidateKey, fetchTask]);

  const slugs = new Set<string>();
  for (const row of rows ?? []) {
    if (row.analysis_task_id && heldTasks.has(row.analysis_task_id)) slugs.add(row.slug);
  }
  return slugs;
}
