// The profile editor's crash backup: WHERE it lives (one slot per editing identity) and
// HOW it comes back (a versioned envelope, restored three-way). Pure — no React, no
// storage access; useProfileEditorFields owns the sessionStorage I/O and
// profileEditorBackup.test.ts drives this directly.
//
// WHY. The slot used to be keyed on the row id alone and spread whole over whatever the
// editor had just loaded. The editor seeds its PROFILE_STALE guard from that FRESH load,
// so a backup written against an older version was restored over a colleague's newer
// save and then committed straight past the guard. A build-from-analysis shared the
// blank-create slot (candidate X's abandoned intake restored into candidate Y's build),
// and a rebuild shared the plain-edit slot (an old edit session overwrote the newer CV,
// then saved under the new analysis's lineage).
//
// The rule now, per the draft-editing standard: a stale persisted draft is a CONFLICT,
// surfaced as one — never silently applied over newer committed work, never silently
// deleted.
//   silent  the row is exactly what the backup was written against: restore as before.
//   moved   the row changed since: recruiter-only edits apply, server-only changes stand,
//           a field both sides changed differently is CONTESTED and keeps the server's
//           value until the recruiter says "use mine anyway".
//   offer   a backup with no version (the pre-envelope build wrote a bare form): shown as
//           an offer, never applied, because nothing says what it was written against.
//   none    nothing restorable (absent, unreadable, or nothing was typed).
import { blankFormState, PROFILE_FORM_FIELDS, same, type ProfileFormField, type ProfileFormState } from "./profileDraftMerge";

const BACKUP_PREFIX = "kp.profileEditor.";

export type BackupIdentity = {
  /** The row being edited (edit / rebuild), or null for a create. */
  editingId: string | null;
  /** The CV analysis the editor was opened from (build-from-analysis / rebuild). */
  sourceAnalysisSlug?: string | null;
};

/**
 * The sessionStorage key for one editing identity. A plain edit and a blank create keep
 * the pre-envelope key shapes (`<id>` / `new`), so a backup the previous build left in
 * this tab is still FOUND — and then offered, never applied. Anything opened from an
 * analysis is keyed on that analysis too: a build-from-analysis never shares the blank
 * slot (or another analysis's), and a rebuild never shares the plain-edit slot.
 */
export function backupSlot({ editingId, sourceAnalysisSlug }: BackupIdentity): string {
  const base = `${BACKUP_PREFIX}${editingId ?? "new"}`;
  return sourceAnalysisSlug ? `${base}@${sourceAnalysisSlug}` : base;
}

export type BackupEnvelope = {
  v: 2;
  /** The row's updated_at when this session loaded it (null for a create). */
  baseVersion: string | null;
  /** When the envelope was written (ISO) — the banner says "your edits from …". */
  savedAt: string;
  /** The form as this session LOADED it — the common ancestor of the three-way restore. */
  baseline: ProfileFormState;
  /** The form as the recruiter left it. */
  draft: ProfileFormState;
};

export function makeEnvelope({
  baseVersion,
  baseline,
  draft,
  savedAt,
}: {
  baseVersion: string | null | undefined;
  baseline: ProfileFormState;
  draft: ProfileFormState;
  savedAt: string;
}): BackupEnvelope {
  return { v: 2, baseVersion: baseVersion ?? null, savedAt, baseline, draft };
}

export type RestorePlan =
  | { kind: "none"; /** The slot held something useless — drop it. */ remove: boolean }
  | { kind: "silent"; state: ProfileFormState; savedAt: string }
  | {
      kind: "moved";
      /** What the editor opens on. */
      merged: ProfileFormState;
      /** `merged` with every contested field taken from the recruiter ("use mine anyway"). */
      mine: ProfileFormState;
      contested: ProfileFormField[];
      savedAt: string;
    }
  | { kind: "offer"; /** The legacy backup spread over the load, as the old build did. */ state: ProfileFormState; fields: ProfileFormField[]; savedAt: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function differing(a: ProfileFormState, b: ProfileFormState): ProfileFormField[] {
  return PROFILE_FORM_FIELDS.filter((field) => !same(a[field], b[field]));
}

function assign(target: ProfileFormState, field: ProfileFormField, value: unknown): void {
  // The key and the value come from the SAME field, so the cast is sound by construction.
  (target as Record<ProfileFormField, unknown>)[field] = value;
}

/**
 * Decide what a stored slot may do to the form the editor just loaded. Never mutates
 * `loaded` or anything parsed from `raw`.
 */
export function planRestore(
  raw: string | null | undefined,
  { baseVersion, loaded }: { baseVersion: string | null | undefined; loaded: ProfileFormState }
): RestorePlan {
  if (!raw) return { kind: "none", remove: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* best-effort: a truncated or hand-edited slot is not a restorable intake — the
       recruiter simply starts from what the editor loaded, and the slot is dropped. */
    return { kind: "none", remove: true };
  }
  if (!isRecord(parsed)) return { kind: "none", remove: true };

  if (parsed.v !== 2) {
    // Pre-envelope backup: a bare (possibly partial) form with no version. What it was
    // written against is unknowable, so it is offered — the old whole-form spread is
    // exactly what the recruiter gets if they accept.
    const state: ProfileFormState = { ...loaded, ...(parsed as Partial<ProfileFormState>) };
    const fields = differing(state, loaded);
    return fields.length ? { kind: "offer", state, fields, savedAt: null } : { kind: "none", remove: true };
  }

  if (!isRecord(parsed.baseline) || !isRecord(parsed.draft)) return { kind: "none", remove: true };
  // Fill fields a future/older envelope lacks, so a partial one can never blank a field.
  const envBaseline: ProfileFormState = { ...blankFormState(), ...(parsed.baseline as Partial<ProfileFormState>) };
  const envDraft: ProfileFormState = { ...envBaseline, ...(parsed.draft as Partial<ProfileFormState>) };
  const savedAt = typeof parsed.savedAt === "string" ? parsed.savedAt : "";
  const envVersion = typeof parsed.baseVersion === "string" ? parsed.baseVersion : null;

  const edited = new Set(differing(envDraft, envBaseline));
  if (edited.size === 0) return { kind: "none", remove: true };

  const serverChanged = new Set(differing(loaded, envBaseline));
  if (envVersion === (baseVersion ?? null) && serverChanged.size === 0) {
    return { kind: "silent", state: envDraft, savedAt };
  }

  const merged: ProfileFormState = { ...loaded };
  const mine: ProfileFormState = { ...loaded };
  const contested: ProfileFormField[] = [];
  for (const field of PROFILE_FORM_FIELDS) {
    if (!edited.has(field)) continue; // server's (or unchanged) value stands
    if (!serverChanged.has(field)) {
      assign(merged, field, envDraft[field]);
      assign(mine, field, envDraft[field]);
    } else if (!same(envDraft[field], loaded[field])) {
      contested.push(field);
      assign(mine, field, envDraft[field]);
    }
    // Both sides changed it to the same value: they agree, keep it quietly.
  }
  return { kind: "moved", merged, mine, contested, savedAt };
}
