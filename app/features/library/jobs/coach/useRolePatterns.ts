"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { PriorityLevel, RolePriorityMap } from "@/app/_lib/role-priorities";
import { derivePatterns, type RolePattern, type Winnability } from "./rolePatterns";

// The ONE data hook behind all three ledger variants. They differ in layout and
// emphasis, never in what they are looking at — a variant that fetched for itself
// would let the Stack and the Dial disagree about the same role.
//
// Two reads, deliberately separate: the GRADE (winnability) spawns the scorer and can
// take seconds, while the TAGS are a point read of one row. Folding the tags into the
// grade's payload would make every tag change wait on a CLI, and would lose them
// entirely on the empty-pool short-circuit.

export type RolePatternsState = {
  patterns: RolePattern[];
  win: Winnability | null;
  priorities: RolePriorityMap;
  /** null while the grade is still being computed. */
  loading: boolean;
  /** The localized read failure, or null. Never the server's prose. */
  error: string | null;
  /** The localized SAVE failure, or null — separate from `error` because a failed
   *  tag write must not blank out a ledger that is on screen and still correct. */
  saveError: string | null;
  reload: () => void;
  setPriority: (patternId: string, level: PriorityLevel | null) => void;
};

const EMPTY: RolePriorityMap = {};

export function useRolePatterns(jobId: string): RolePatternsState {
  const t = useTranslations("jobs.coach");
  const resolveMessage = useErrorMessage();
  const encoded = encodeURIComponent(jobId);
  const grade = useJsonFetch<Winnability>(`/api/jobs/${encoded}/winnability`, t("loadFailed"));
  const saved = useJsonFetch<{ priorities: RolePriorityMap }>(`/api/jobs/${encoded}/priorities`, t("loadFailed"));

  // The optimistic overlay, DERIVED against the server read rather than synced into
  // state by an effect: a tag must land under the cursor immediately, but copying the
  // fetched map into state on arrival is the cascading-render shape the React lint
  // rejects — and it would also let the two drift. null = "nothing local yet, the
  // server's answer stands".
  const [local, setLocal] = useState<RolePriorityMap | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const priorities = local ?? saved.data?.priorities ?? EMPTY;

  const setPriority = useCallback(
    (patternId: string, level: PriorityLevel | null) => {
      setSaveError(null);
      // What the ledger reverts TO if the write fails, captured before the optimistic
      // change — the last state the server is known to hold.
      const before = priorities;
      const next = { ...before };
      // Clearing a tag REMOVES the key: "untagged" is a real state (nobody has judged
      // this pattern), not a fourth level, and the projection reads it so.
      if (level === null) delete next[patternId];
      else next[patternId] = level;
      setLocal(next);
      // The request is fired HERE and not inside a state updater: an updater runs
      // twice under React's strict double-invoke, which would send the same PUT twice.
      void save(`/api/jobs/${encoded}/priorities`, next).then((outcome) => {
        if (outcome.ok) {
          // The route echoes what it STORED, so this is a correction, not a re-paint:
          // an entry the sanitizer dropped disappears here instead of lingering on
          // screen as a tag the server never kept.
          setLocal(outcome.priorities);
          return;
        }
        // Put the ledger back and say so. Leaving the optimistic tag on screen would
        // be the green lie this repo forbids: the recruiter would believe a weight is
        // persisted that is not.
        setLocal(before);
        setSaveError(resolveMessage(outcome.body, t("saveFailed")));
      });
    },
    [encoded, priorities, resolveMessage, t],
  );

  const patterns = useMemo(() => derivePatterns(grade.data), [grade.data]);

  return {
    patterns,
    win: grade.data,
    priorities,
    loading: grade.data === null && grade.error === null,
    error: grade.error,
    // A failed TAG read degrades to an empty ledger of weights, which looks exactly
    // like "nobody has tagged anything" — so it is reported in the same line a failed
    // save is, rather than passing for a fact about this role.
    saveError: saveError ?? saved.error,
    reload: grade.reload,
    setPriority,
  };
}

type SaveOutcome =
  | { ok: true; priorities: RolePriorityMap }
  | { ok: false; body: { error?: string; code?: string } | null };

/** The write half, kept out of the component tree so the hook body stays pure. */
async function save(url: string, priorities: RolePriorityMap): Promise<SaveOutcome> {
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priorities }),
    });
    const body: unknown = await res.json().catch(() => null);
    const rec = body && typeof body === "object" ? (body as { priorities?: RolePriorityMap; code?: string; error?: string }) : null;
    if (!res.ok || !rec) return { ok: false, body: rec };
    return { ok: true, priorities: rec.priorities ?? {} };
  } catch {
    // A network failure is a failed save like any other: the caller reverts and the
    // recruiter is told, rather than the tag sitting on screen as if it had landed.
    return { ok: false, body: null };
  }
}
