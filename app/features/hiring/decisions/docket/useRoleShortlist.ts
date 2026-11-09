"use client";

// T14 (ADR 0030) - the role's PERSISTED shortlist: GET/POST /api/decisions/shortlist.
// A person's mark is "shortlisted" or "chosen"; both are set by a human clicking here and
// nowhere else. A change is applied at once and rolled back if the server refuses it.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ShortlistRow, ShortlistState } from "@/app/_lib/db/role-shortlist";

export type { ShortlistRow, ShortlistState };

export type RoleShortlist = {
  /** entry id -> mark. Empty until the first read lands (and for a title-only role). */
  marks: ReadonlyMap<string, ShortlistRow>;
  /** True after a write the server refused (the marks were rolled back). */
  failed: boolean;
  /** Set (or with null clear) several people at once; resolves when the server answered. */
  apply: (entryIds: readonly string[], state: ShortlistState | null) => Promise<void>;
};

const NONE: ReadonlyMap<string, ShortlistRow> = new Map();

export function useRoleShortlist(jobId: string | null): RoleShortlist {
  const [slot, setSlot] = useState<{ job: string | null; marks: ReadonlyMap<string, ShortlistRow> }>({ job: null, marks: NONE });
  const [failed, setFailed] = useState(false);
  const jobRef = useRef(jobId);
  useEffect(() => {
    jobRef.current = jobId;
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    fetch(`/api/decisions/shortlist?job=${encodeURIComponent(jobId)}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`shortlist ${res.status}`);
        const body = (await res.json()) as { rows?: ShortlistRow[] };
        const rows = Array.isArray(body.rows) ? body.rows : [];
        if (!controller.signal.aborted) setSlot({ job: jobId, marks: new Map(rows.map((r) => [r.entryId, r] as const)) });
      })
      .catch(() => {
        /* best-effort: an unreadable shortlist shows as empty, the table itself still works */
      });
    return () => controller.abort();
  }, [jobId]);

  const apply = useCallback(async (entryIds: readonly string[], state: ShortlistState | null) => {
    const job = jobRef.current;
    if (!job || entryIds.length === 0) return;
    setFailed(false);
    const now = new Date().toISOString();
    const patch = (marks: ReadonlyMap<string, ShortlistRow>, rows: ReadonlyMap<string, ShortlistRow | null>) => {
      const next = new Map(marks);
      for (const [id, row] of rows) {
        if (row) next.set(id, row);
        else next.delete(id);
      }
      return next;
    };
    let before: ReadonlyMap<string, ShortlistRow> = NONE;
    setSlot((cur) => {
      before = cur.marks;
      const optimistic = new Map(entryIds.map((id) => [id, state ? { entryId: id, state, setBy: cur.marks.get(id)?.setBy ?? "", setAt: now } : null] as const));
      return { job, marks: patch(cur.marks, optimistic) };
    });
    const results = await Promise.all(
      entryIds.map(async (entryId) => {
        try {
          const res = await fetch("/api/decisions/shortlist", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ job, entryId, state }),
          });
          if (!res.ok) return [entryId, undefined] as const;
          const body = (await res.json()) as { row?: ShortlistRow | null };
          return [entryId, body.row ?? null] as const;
        } catch {
          return [entryId, undefined] as const;
        }
      }),
    );
    if (jobRef.current !== job) return;
    setSlot((cur) => {
      const settled = new Map<string, ShortlistRow | null>();
      for (const [id, row] of results) settled.set(id, row === undefined ? before.get(id) ?? null : row);
      return { job, marks: patch(cur.marks, settled) };
    });
    if (results.some(([, row]) => row === undefined)) setFailed(true);
  }, []);

  return { marks: slot.job === jobId ? slot.marks : NONE, failed, apply };
}
