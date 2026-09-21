// The desk's zones — the one persisted preference a studio has, and the rule
// that governs it. Pure, so `studioZones.test.ts` proves it under `node --test`.
//
/* ── The doctrine every studio surface obeys ─────────────────────────────────
 *
 * NO SENTENCE OCCUPIES LAYOUT. A control that needs explaining carries a glyph
 * and a tooltip; the explanation is one hover or one focus away and never
 * takes a line of the desk. Three consequences the kit implements identically
 * for every consumer:
 *
 *  1. A capability that is absent is drawn in its NEGATIVE state (a struck
 *     microphone, a muted speaker) with the reason in its tooltip — not a
 *     paragraph telling the reader to continue in text.
 *  2. An option is a togglable icon with `aria-pressed`, not a checkbox beside
 *     a sentence.
 *  3. An empty region shows the SHAPE of what will fill it, not a sentence
 *     promising that it will.
 *
 * A failure the reader must act on is the exception and stays visible: an error
 * is not chrome. So is a degraded engine, because an artifact built by the
 * fallback script is a different artifact and hiding that would be a lie of
 * omission. (This block travelled here from the intake studio's
 * `coats/studioContract.ts`, where it was written for the first consumer.)
 */

/* ── Which zones are open ───────────────────────────────────────────────────
 *
 * A per-browser layout PREFERENCE, not data, so it lives in localStorage under
 * the CONSUMER'S key and never on the server — two studios on one machine keep
 * two preferences. SSR-safe: read lazily, swallow storage errors. The zone
 * vocabulary is the consumer's too (`K`), so the reader takes the consumer's
 * guard rather than knowing any zone by name. */

export function readStoredZones<K extends string>(storageKey: string, fallback: K[], isKey: (v: unknown) => v is K): K[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return fallback;
    const valid = parsed.filter(isKey);
    return valid.length > 0 ? valid : fallback;
  } catch {
    /* best-effort: a browser that refuses storage still gets the default zones */
    return fallback;
  }
}

export function storeZones<K extends string>(storageKey: string, open: readonly K[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(open));
  } catch {
    /* storage unavailable — the preference just doesn't persist */
  }
}

/** Toggle under two guards. The min-one-open guard: the last open zone cannot be
 *  hidden (an all-spine desk would strand the reader with no content at all).
 *  The pin: a zone the consumer declared `pinned` never folds — the transcript,
 *  where a studio keeps the conversation the whole surface is about. */
export function toggleZone<K extends string>(open: K[], key: K, pinned: readonly K[] = []): K[] {
  if (open.includes(key)) {
    // The SAME array back when nothing changed, so a React setter skips the
    // re-render and the store write — the shape the first consumer relied on.
    if (pinned.includes(key)) return open;
    if (open.length === 1) return open;
    return open.filter((k) => k !== key);
  }
  return [...open, key];
}

/** A `K` guard from the consumer's closed list — the literal-array + derived-union
 *  idiom (`tabs.ts`), so a consumer declares its zones once. */
export function zoneKeyGuard<K extends string>(keys: readonly K[]): (v: unknown) => v is K {
  return (v: unknown): v is K => typeof v === "string" && (keys as readonly string[]).includes(v);
}
