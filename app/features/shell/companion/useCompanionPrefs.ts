"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_COMPANION_PREFS,
  readStoredPrefs,
  storePrefs,
  type CompanionPrefs,
  type CompanionUiMode,
  type CompanionVoiceVariant,
} from "./companionPrefs";

/*
 * The React half of the companion's presentation preferences.
 *
 * HYDRATION, not initial state. The first render must match the server's — which
 * cannot know what this browser stored — so the hook seeds the defaults and
 * corrects itself in a mount effect. That is the same call `usePipelineSla` and
 * `usePipelineSavedViews` made, down to the eslint suppression: a one-time read
 * of client-only storage is not the cascading-render this rule is written
 * against, and the alternatives (a lazy useState initializer, reading during
 * render) are exactly the hydration mismatch the seed exists to avoid.
 *
 * The visible cost is one frame of `dock` before a `voice` operator's choice
 * lands. That is deliberate: the companion is CLOSED on that frame — the dock
 * renders its rest pill, which is identical in both modes — so nothing the
 * operator can see flips. A mode read during render would trade an invisible
 * frame for a real hydration warning.
 *
 * Setters go through the functional updater (so two changes in the same tick
 * cannot overwrite each other's neighbour fields) and PERSISTENCE is an effect
 * on the settled value, not a write inside the updater: an updater React may
 * replay must stay pure, and the effect writes the state that actually rendered.
 */
export type CompanionPrefsState = CompanionPrefs & {
  setMode: (mode: CompanionUiMode) => void;
  setAutoSpeak: (autoSpeak: boolean) => void;
  setVariant: (variant: CompanionVoiceVariant) => void;
  /** False until the mount read has landed. Consumers that would FLASH on the
   *  wrong answer (a header that paints a mode label) can wait for it; the dock
   *  itself does not, because both modes render the same closed pill. */
  hydrated: boolean;
};

export function useCompanionPrefs(): CompanionPrefsState {
  const [prefs, setPrefs] = useState<CompanionPrefs>(DEFAULT_COMPANION_PREFS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = readStoredPrefs();
    // Client-only localStorage read, once, on mount — the SSR-safe shape (see
    // usePipelineSla). Not a render cascade: nothing re-runs this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs(stored);
    setHydrated(true);
  }, []);

  // Write-back. Gated on `hydrated` so the very first render can never persist
  // the DEFAULTS over a real stored choice — without the gate, an operator in
  // voice mode would be written back to `dock` before the mount read landed.
  useEffect(() => {
    if (!hydrated) return;
    storePrefs(prefs);
  }, [prefs, hydrated]);

  const update = useCallback((patch: Partial<CompanionPrefs>) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
  }, []);

  const setMode = useCallback((mode: CompanionUiMode) => update({ mode }), [update]);
  const setAutoSpeak = useCallback((autoSpeak: boolean) => update({ autoSpeak }), [update]);
  const setVariant = useCallback((variant: CompanionVoiceVariant) => update({ variant }), [update]);

  return { ...prefs, setMode, setAutoSpeak, setVariant, hydrated };
}
