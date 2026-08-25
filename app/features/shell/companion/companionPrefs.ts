// Companion presentation preferences — PURE. No React, no window at module
// scope, so this half runs under `node --test` via the alias loader.
//
// Round V2 gives the companion a second SHAPE (the top/bottom voice pair) and a
// setting that speaks a reply the moment it lands. Both are per-BROWSER UX
// preferences, not workspace data: they describe how this screen is being used
// right now, they carry nothing another operator needs to see, and putting them
// on the server would mean a schema, a route and a round trip to answer "which
// window am I in". So localStorage, the same call the pipeline's saved views and
// the intake layout already made (usePipelineSavedViews, intakeLayoutShared).
//
// ONE key holds all three fields rather than three keys. A preference set is
// read at exactly one moment (mount) and written as a whole on every change, so
// splitting it buys nothing and costs a migration the first time a fourth field
// arrives. `coerce` is total: any shape at all — a null, a string, last
// version's object, a field someone hand-edited to garbage — yields a complete, valid
// preference set rather than a partial one, because every consumer of
// this type renders a control that must have a current value.

/** Which shape the companion wears. `dock` is the conversation column that has
 *  always been here; `voice` is V2's top/bottom pair. PRESENTATION ONLY — the
 *  thread, the provider's open/close and every route are identical in both. */
export type CompanionUiMode = "dock" | "voice";

/** Prototype round V2's three directions for the voice pair. Scaffold state: it
 *  lives here (rather than in a component's useState) only so switching
 *  direction survives the reload the operator does to compare them. */
export type CompanionVoiceVariant = "ticker" | "stage" | "hud";

export type CompanionPrefs = {
  mode: CompanionUiMode;
  /** Speak a reply as it lands. Default OFF: an utterance nobody asked for is
   *  the one failure mode a voice feature cannot take back, and the browser will
   *  refuse the first one anyway until the operator has gestured at the page. */
  autoSpeak: boolean;
  variant: CompanionVoiceVariant;
};

export const COMPANION_PREFS_KEY = "kp-companion-prefs";

export const DEFAULT_COMPANION_PREFS: CompanionPrefs = {
  mode: "dock",
  autoSpeak: false,
  variant: "ticker",
};

const MODES: readonly CompanionUiMode[] = ["dock", "voice"];
const VARIANTS: readonly CompanionVoiceVariant[] = ["ticker", "stage", "hud"];

export function isCompanionUiMode(value: unknown): value is CompanionUiMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

export function isCompanionVoiceVariant(value: unknown): value is CompanionVoiceVariant {
  return typeof value === "string" && (VARIANTS as readonly string[]).includes(value);
}

/**
 * Any stored shape -> a complete preference set. Field by field, so a store that
 * carries a good `mode` and a garbage `autoSpeak` keeps the mode: dropping the
 * whole object on one bad field would silently move an operator back to the
 * window they had left, which is the more surprising of the two outcomes.
 */
export function coerceCompanionPrefs(raw: unknown): CompanionPrefs {
  if (raw === null || typeof raw !== "object") return DEFAULT_COMPANION_PREFS;
  const rec = raw as Record<string, unknown>;
  return {
    mode: isCompanionUiMode(rec.mode) ? rec.mode : DEFAULT_COMPANION_PREFS.mode,
    autoSpeak: typeof rec.autoSpeak === "boolean" ? rec.autoSpeak : DEFAULT_COMPANION_PREFS.autoSpeak,
    variant: isCompanionVoiceVariant(rec.variant) ? rec.variant : DEFAULT_COMPANION_PREFS.variant,
  };
}

/** Parse the raw localStorage string. A corrupt value is not an error worth
 *  telling anyone about — it is a preference that reverts to its default. */
export function parseStoredPrefs(raw: string | null): CompanionPrefs {
  if (!raw) return DEFAULT_COMPANION_PREFS;
  try {
    return coerceCompanionPrefs(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_COMPANION_PREFS;
  }
}

/* ── The window half. Guarded rather than absent so a caller does not have to
 *    branch on rendering environment to read a preference. ── */

export function readStoredPrefs(): CompanionPrefs {
  if (typeof window === "undefined") return DEFAULT_COMPANION_PREFS;
  try {
    return parseStoredPrefs(window.localStorage.getItem(COMPANION_PREFS_KEY));
  } catch {
    return DEFAULT_COMPANION_PREFS;
  }
}

export function storePrefs(prefs: CompanionPrefs): void {
  try {
    window.localStorage.setItem(COMPANION_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable (private mode, quota) — the choice still holds for
       this page, it just does not survive the reload. */
  }
}
