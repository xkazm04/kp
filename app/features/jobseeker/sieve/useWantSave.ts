"use client";

import { useCallback, useRef, useState } from "react";
import type { JobseekerPreferences, JobseekerProfile } from "@/app/_lib/jobseeker/types";
import { classifyApiFailure, TRANSPORT_FAILURE, type ClassifiedFailure } from "../apiFailure";

// Step 4's save path. A card commits a patch on Done; the patch shows at once (optimistic)
// and is sent as `PUT /api/jobseeker/profile { preferences, preferencesReplace: true }`.
//
// Saves go ONE AT A TIME, in commit order (a promise chain), so the server applies them
// in the order the seeker made them and no older response can land after a newer one.
// While any save is queued or in flight the step shows its own values; once none is, it
// takes the stored profile - the last response (every field the seeker committed, as
// stored) or a change from outside this step (a re-import, the EURES door, a CV
// conversation closing). A failed save keeps the shown value, says so, and Retry re-sends
// exactly what did not land.

export type WantSaveState = "idle" | "saving" | "saved" | "error";

export function useWantSave(profile: JobseekerProfile | null, onSaved: (profile: JobseekerProfile) => void) {
  const [prefs, setPrefs] = useState<JobseekerPreferences | null>(profile?.preferences ?? null);
  const [state, setState] = useState<WantSaveState>("idle");
  const [failure, setFailure] = useState<ClassifiedFailure | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const [changed, setChanged] = useState(false);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const issued = useRef(0);
  const unsent = useRef<Partial<JobseekerPreferences>>({});

  const version = profile ? `${profile.id}:${profile.updatedAt}` : null;
  const [seenVersion, setSeenVersion] = useState(version);
  if (version !== seenVersion && inFlight === 0) {
    setSeenVersion(version);
    setPrefs(profile?.preferences ?? null);
  }

  const commit = useCallback(
    (patch: Partial<JobseekerPreferences>) => {
      if (Object.keys(patch).length > 0) {
        setPrefs((cur) => (cur ? { ...cur, ...patch } : cur));
        setChanged(true);
      }
      const id = ++issued.current;
      setInFlight((n) => n + 1);
      setState("saving");
      chain.current = chain.current.then(async () => {
        // What an earlier failure left unsent rides with this save, older fields first.
        const body = { ...unsent.current, ...patch };
        unsent.current = {};
        try {
          if (Object.keys(body).length === 0) {
            if (id === issued.current) setState("idle");
            return;
          }
          const res = await fetch("/api/jobseeker/profile", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ preferences: body, preferencesReplace: true }),
          });
          const saved = (await res.json().catch(() => null)) as (JobseekerProfile & { code?: string }) | null;
          if (!res.ok || !saved || typeof saved.id !== "string") {
            unsent.current = { ...body, ...unsent.current };
            setFailure(classifyApiFailure(res, saved));
            setState("error");
            return;
          }
          setFailure(null);
          if (id === issued.current) setState("saved");
          onSaved(saved);
        } catch {
          unsent.current = { ...body, ...unsent.current };
          setFailure(TRANSPORT_FAILURE);
          setState("error");
        } finally {
          setInFlight((n) => n - 1);
        }
      });
    },
    [onSaved]
  );

  /** Re-send what did not land. */
  const retry = useCallback(() => commit({}), [commit]);

  return { prefs, state, failure, changed, saving: inFlight > 0, commit, retry };
}
