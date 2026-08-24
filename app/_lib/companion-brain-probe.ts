// The brain probe's SHAPE, with no way to reach a brain.
//
// Split from companion-brain.ts by AUDIENCE, the same way companion-proposal-view.ts
// is split from companion-actions.ts: the server half spawns Python and opens
// better-sqlite3, and the first-run wizard is a client component. A `import type`
// would erase, but the wizard also has to SHAPE the route's JSON at the fetch
// boundary — and a coercer is runtime code. So the contract lives here, imported
// by both sides, and neither of them holds a second copy of it.
//
// Everything here is pure. Nothing in this file may import a store, a runner, or
// `next/server`.

/** Who wrote the constitution the brain on disk is running on.
 *  `kp` carries this repo's marker; `personas` is a constitution WITHOUT it —
 *  Athena's own (the tree is shared on purpose) or one the operator rewrote;
 *  `none` means there is no constitution at all. */
export type BrainConstitutionOrigin = "personas" | "kp" | "none";

/** The ceiling `companion_brain.EPISODE_PROBE_CAP` counts to. A count AT the cap
 *  means "at least this many" and the UI must say so in words rather than print
 *  a number it knows is wrong. Mirrored here rather than shipped in the payload
 *  because it is a constant, and a constant that travels can drift; the Python
 *  side is the definition and `test_probe_counts_episodes_capped` pins it. */
export const EPISODE_PROBE_CAP = 999;

/** What is on disk at `~/.personas/companion-brain`, read without creating any
 *  of it (`companion_cli --probe`). `episodes` is CAPPED — a human reads "a lot"
 *  exactly as well as an exact five-digit count, and the walk stops early. */
export type CompanionBrainProbe = {
  present: boolean;
  episodes: number;
  identitySections: number;
  constitutionOrigin: BrainConstitutionOrigin;
};

/** What the brain route answers with: the disk facts, plus the two workspace
 *  facts the wizard needs to decide WHICH question to ask. `memoryEnabled` is
 *  the settled rule (explicit consent OR episodes kp already wrote), so a
 *  workspace that is already remembering is never asked to consent again. */
export type CompanionBrainStatus = CompanionBrainProbe & {
  consent: "connected" | "birthed" | null;
  memoryEnabled: boolean;
};

/** What the operator may answer at first run. `null` is "skip for now", which
 *  stamps nothing at all — see setCompanionBrainConsent for why there is no
 *  third stored state. */
export type CompanionBrainChoice = "connect" | "birth" | null;

const ORIGINS: readonly BrainConstitutionOrigin[] = ["personas", "kp", "none"];

function origin(raw: unknown): BrainConstitutionOrigin {
  return ORIGINS.includes(raw as BrainConstitutionOrigin) ? (raw as BrainConstitutionOrigin) : "none";
}

/** Non-negative integer, or 0. The count crosses a spawned process's stdout and
 *  then an HTTP boundary; a negative or fractional "memories" reading would be
 *  drawn straight into a plural-form sentence. */
function count(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/** Shape the payload rather than trusting it — the same contract every other
 *  Python artifact in this tree crosses its boundary under. An unrecognisable
 *  payload becomes "no brain", which is the conservative direction: the wizard
 *  then offers to CREATE one, and creation is idempotent and never overwrites. */
export function coerceBrainProbe(raw: unknown): CompanionBrainProbe {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    present: value.present === true,
    episodes: count(value.episodes),
    identitySections: count(value.identitySections),
    constitutionOrigin: origin(value.constitutionOrigin),
  };
}

export function coerceBrainStatus(raw: unknown): CompanionBrainStatus {
  const value = (raw ?? {}) as Record<string, unknown>;
  const consent = value.consent;
  return {
    ...coerceBrainProbe(raw),
    consent: consent === "connected" || consent === "birthed" ? consent : null,
    memoryEnabled: value.memoryEnabled === true,
  };
}
