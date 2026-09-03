"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearSetupDraft, draftFromState, readSetupDraft, writeSetupDraft, type SetupDraft } from "./setupDraft";
import type { SetupState } from "./setupSteps";

// Keeps the wizard's answers across a reload, and nothing else. The rules live in
// setupDraft.ts (pure); this is only the wiring: probe who we are, restore once,
// then mirror every change into the per-user sessionStorage slot.
//
// LIVE MODE ONLY. The Settings walkthrough persists nothing anywhere — writing a
// draft there would be the same "Preview wrote for real" ambiguity the mode split
// exists to kill, and would also hand a real first run a draft the walkthrough
// typed.

export function useSetupDraft(opts: {
  enabled: boolean;
  state: SetupState;
  stepIndex: number;
  maxVisited: number;
  restore: (draft: SetupDraft) => void;
}): { clear: () => void } {
  const { enabled, state, stepIndex, maxVisited } = opts;
  // The principal the draft belongs to. `undefined` = the probe has not answered
  // yet (so nothing is written or restored); `null` = an identity-less session,
  // which gets its own key rather than sharing anyone's.
  const [scope, setScope] = useState<string | null | undefined>(undefined);
  // The restore callback is read once, by the one-shot effect below, and must not
  // re-trigger it when the parent re-creates it — hence a ref, kept current in its
  // own effect rather than during render.
  const restoreRef = useRef(opts.restore);
  useEffect(() => {
    restoreRef.current = opts.restore;
  });
  const restored = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/me/onboarding")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { scope?: unknown } | null) => {
        if (alive) setScope(typeof d?.scope === "string" ? d.scope : null);
      })
      .catch(() => {
        /* no identity is still a usable scope — the draft just lands under "anonymous" */
        if (alive) setScope(null);
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  // Restore exactly once, as soon as we know whose slot to read. mergeSetupDraft
  // lets anything already typed in this mount win, so a fast typist never loses a
  // keystroke to the probe's latency.
  useEffect(() => {
    if (!enabled || scope === undefined || restored.current) return;
    restored.current = true;
    const draft = readSetupDraft(scope, state);
    if (draft) restoreRef.current(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot restore; `state` is read, not tracked
  }, [enabled, scope]);

  // Mirror every answer. Cheap (one JSON.stringify of a small object) and it must
  // run on every change, because the reload we are insuring against is unannounced.
  useEffect(() => {
    if (!enabled || scope === undefined || !restored.current) return;
    writeSetupDraft(scope, draftFromState(state, stepIndex, maxVisited));
  }, [enabled, scope, state, stepIndex, maxVisited]);

  const clear = useCallback(() => {
    if (scope !== undefined) clearSetupDraft(scope);
  }, [scope]);

  return { clear };
}
