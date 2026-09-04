// A per-intake draft of the brief EDIT form, kept in sessionStorage.
//
// The edit form is the only copy of the requestor's typed corrections — that is
// already why a refused save keeps it mounted (JdsIntakeBriefPanel). A reload
// took the same work with it: the form seeded from props, so a tab refresh, an
// accidental navigation or a crash mid-edit dropped every typed row silently.
//
// Two rules, both here rather than in the component:
//
//  * the draft is keyed by INTAKE ID, so two sessions never see each other's;
//  * it carries the `updatedAt` it was typed against, and is DISCARDED when the
//    row has moved since (a voice sweep, a /message turn, another tab). A stale
//    draft restored over a newer brief is a silent revert, which is worse than
//    losing the draft — the same reasoning as the store's compare-and-swap.
//
// Every storage access is wrapped: sessionStorage throws outright in some
// privacy modes, and is absent during SSR.

import type { RoleBrief } from "@/app/_lib/rolespec";

const BRIEF_DRAFT_PREFIX = "kp.intake.brief-draft:";

export function briefDraftKey(intakeId: string): string {
  return `${BRIEF_DRAFT_PREFIX}${intakeId}`;
}

/** The stored shape: the work, plus the row version it was typed against. */
type DraftEnvelope = { updatedAt: string | null; brief: RoleBrief };

export function encodeBriefDraft(updatedAt: string | null, brief: RoleBrief): string {
  return JSON.stringify({ updatedAt, brief } satisfies DraftEnvelope);
}

/** The merge rule: a draft is only restorable onto the row version it left. */
export function decodeBriefDraft(raw: string | null | undefined, updatedAt: string | null): RoleBrief | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* someone else's key, or a half-written value — there is no draft here */
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const envelope = parsed as Partial<DraftEnvelope>;
  if (!envelope.brief || typeof envelope.brief !== "object") return null;
  // Both sides may legitimately be null (a session read before its first write);
  // what matters is that they AGREE.
  if ((envelope.updatedAt ?? null) !== updatedAt) return null;
  return envelope.brief;
}

/** The slice of Storage this module needs — so a test can hand it a Map. */
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** sessionStorage where it exists and is reachable, else null (SSR, a browser
 *  configured to block site data — both are non-events, not failures). */
export function draftStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    /* site data blocked: the feature degrades to "no draft", nothing else */
    return null;
  }
}

export function loadBriefDraft(
  storage: DraftStorage | null,
  intakeId: string,
  updatedAt: string | null
): RoleBrief | null {
  if (!storage) return null;
  try {
    return decodeBriefDraft(storage.getItem(briefDraftKey(intakeId)), updatedAt);
  } catch {
    /* reading storage can itself throw — treat it as "no draft" */
    return null;
  }
}

export function saveBriefDraft(
  storage: DraftStorage | null,
  intakeId: string,
  updatedAt: string | null,
  brief: RoleBrief
): void {
  if (!storage) return;
  try {
    storage.setItem(briefDraftKey(intakeId), encodeBriefDraft(updatedAt, brief));
  } catch {
    /* quota or blocked site data: the draft is a convenience, never the record —
       the typed form on screen is still the live copy */
  }
}

export function clearBriefDraft(storage: DraftStorage | null, intakeId: string): void {
  if (!storage) return;
  try {
    storage.removeItem(briefDraftKey(intakeId));
  } catch {
    /* nothing to do — a draft that cannot be removed is one that could not have
       been written either (same storage, same failure) */
  }
}
