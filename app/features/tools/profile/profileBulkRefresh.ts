// The roster's counted batch refresh (challenge-r05 profile-roster-matrix/B): refresh
// every UNEDITED stale profile in view from its newer CV in one pass.
//
// Pure and injectable — no React, no next-intl, the fetch passed in — so every outcome
// is pinned by profileBulkRefresh.test.ts against fake 200 / 409 / 429 / 404 answers.
//
// Three rules, all from the registry's bulk-rebuild technique
// (candidate-identity-and-staleness / rebuild-overwrites-manual-edits-warning):
//   1. COUNT FIRST. planBulkRefresh splits the stale rows in view into clean and edited
//      before anything runs; the bar states both numbers and asks once.
//   2. NEVER WRITE A HUMAN. A row that is edited — or cannot PROVE it is not (no flag,
//      no version to re-assert) — is never read, never PUT: it is `skippedEdited` and
//      handed back as the review queue, which opens the per-profile merge dialog.
//   3. SAY WHAT HAPPENED. Every row ends in one truthful outcome; a 429 stops the run
//      (the PUT shares one per-IP bucket with the editor) and the rest read
//      `notAttempted` instead of the run reporting success.
//
// The request is the editor's own save, byte for byte: an unedited Rebuild opens the
// editor on formStateFrom(v2) and a Save PUTs buildProfilePayload over it with the
// editor's signal shape, expectedUpdatedAt and sourceAnalysisSlug
// (useProfileEditorSubmit.ts). Riding that PUT keeps its lost-update check (409
// PROFILE_STALE), its rate limit and its lineage re-stamp; no new route exists.

import type { ProfilePayload } from "@/app/features/shared/profileTypes";
import type { StaleEntry, StaleMap } from "./ProfileRosterTypes";
import { formStateFrom } from "./useProfileEditorFields";
import { buildProfilePayload } from "./profileEditorPayload";

/** One stale profile as the batch sees it: its id plus its staleness entry. */
export type RefreshEntry = StaleEntry & { id: string };

export type BulkRefreshPlan = {
  /** Provably unedited, with a version to re-assert: the batch may refresh these. */
  clean: RefreshEntry[];
  /** Carries edits (or cannot prove otherwise): never written, reviewed one by one. */
  edited: RefreshEntry[];
};

/** True only when the entry PROVES the profile is unedited AND names the version the
 *  PUT will re-assert. Anything less is a review, never a write. */
export function isRefreshable(entry: StaleEntry): entry is StaleEntry & { edited: false; updatedAt: string } {
  return entry.edited === false && typeof entry.updatedAt === "string" && entry.updatedAt !== "";
}

/**
 * Count the stale rows IN VIEW (the roster's filtered set, every page) into clean and
 * edited. A current row and a stale row the filters hid are in neither list: the bar
 * acts on what the recruiter is looking at, never on the whole workspace behind it.
 */
export function planBulkRefresh(rowsInView: readonly { id: string }[], stale: StaleMap): BulkRefreshPlan {
  const clean: RefreshEntry[] = [];
  const edited: RefreshEntry[] = [];
  for (const row of rowsInView) {
    if (!Object.hasOwn(stale, row.id)) continue;
    const entry: RefreshEntry = { ...stale[row.id], id: row.id };
    (isRefreshable(entry) ? clean : edited).push(entry);
  }
  return { clean, edited };
}

export type RefreshRequest = {
  id: string;
  profile: Record<string, unknown>;
  signals: {
    selfDeclared: string;
    isEnrolled: boolean;
    expectedGraduation: string | undefined;
    wantsDomainChange: boolean;
    hasSubstantialExperience: boolean;
  };
  expectedUpdatedAt: string | null;
  sourceAnalysisSlug: string;
};

/**
 * The PUT body for one refresh — the editor's save of an unedited rebuild, unchanged.
 * Key order matches useProfileEditorSubmit's `{ id, profile, signals, expectedUpdatedAt,
 * ...lineage }`, so the two are byte-equal on the wire (profileBulkRefresh.test.ts
 * case 3, with a source pin on the editor's construction).
 */
export function refreshRequest(entry: RefreshEntry, v2: ProfilePayload | null): RefreshRequest {
  const f = formStateFrom(v2);
  return {
    id: entry.id,
    profile: buildProfilePayload(f),
    signals: {
      selfDeclared: f.choice,
      isEnrolled: f.isEnrolled,
      expectedGraduation: f.expectedGraduation || undefined,
      wantsDomainChange: f.wantsDomainChange,
      hasSubstantialExperience: f.hasSubstantialExperience,
    },
    expectedUpdatedAt: entry.updatedAt ?? null,
    sourceAnalysisSlug: entry.newerSlug,
  };
}

export type RefreshOutcomeKind =
  | "refreshed" // PUT 200: the profile now reflects the newer CV, lineage re-stamped
  | "changedSince" // PUT 409 PROFILE_STALE: someone saved it after the list was read
  | "throttled" // 429: the shared save budget is spent — the run stops here
  | "failed" // no newer profile to refresh from, or the route refused with a code
  | "notAttempted" // after a 429 or a Stop: never read, never written
  | "skippedEdited"; // carries edits: never written by the batch, see `review`

export type RefreshOutcome = {
  id: string;
  outcome: RefreshOutcomeKind;
  /** `failed` only: "noNewerProfile", or the route's machine code (resolved in the
   *  reader's language by useErrorMessage), or null when there was none. */
  reason?: string | null;
};

export type BulkRefreshResult = {
  /** One per input row, in input order. */
  outcomes: RefreshOutcome[];
  /** The edited rows, untouched — each one is reviewed through the merge dialog. */
  review: RefreshEntry[];
  /** Why the run ended early, if it did. */
  stopped: "throttled" | "aborted" | null;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function codeOf(res: Response): Promise<string | null> {
  const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
  return typeof body?.code === "string" ? body.code : null;
}

/**
 * Walk the rows SEQUENTIALLY (one profile_cli spawn at a time, like a recruiter saving
 * one by one): read the newer analysis, PUT the editor's body, record the outcome.
 *
 * The signal cancels the analysis READ and stops the walk between rows; a PUT already
 * sent is never cancelled half-way, so its outcome is known rather than guessed.
 */
export async function runBulkRefresh(args: {
  rows: readonly RefreshEntry[];
  fetch: FetchLike;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<BulkRefreshResult> {
  const { rows, fetch: doFetch, signal, onProgress } = args;
  const outcomes: RefreshOutcome[] = [];
  const review: RefreshEntry[] = [];
  const toRun = rows.filter(isRefreshable).length;
  let done = 0;
  let stopped: BulkRefreshResult["stopped"] = null;

  for (const row of rows) {
    if (!isRefreshable(row)) {
      outcomes.push({ id: row.id, outcome: "skippedEdited" });
      review.push(row);
      continue;
    }
    if (stopped || signal?.aborted) {
      stopped ??= "aborted";
      outcomes.push({ id: row.id, outcome: "notAttempted" });
      continue;
    }

    let outcome: RefreshOutcome;
    let putSent = false;
    try {
      const read = await doFetch(`/api/analyses/${encodeURIComponent(row.newerSlug)}`, { signal });
      if (read.status === 429) {
        stopped = "throttled";
        outcome = { id: row.id, outcome: "throttled" };
      } else {
        const v2 = read.ok
          ? (((await read.json().catch(() => null)) as { analysis?: { v2Profile?: ProfilePayload | null } } | null)?.analysis
              ?.v2Profile ?? null)
          : null;
        if (!v2) {
          outcome = { id: row.id, outcome: "failed", reason: "noNewerProfile" };
        } else {
          putSent = true;
          const res = await doFetch("/api/profile", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(refreshRequest(row, v2)),
          });
          if (res.ok) outcome = { id: row.id, outcome: "refreshed" };
          else if (res.status === 429) {
            stopped = "throttled";
            outcome = { id: row.id, outcome: "throttled" };
          } else {
            const code = await codeOf(res);
            outcome =
              res.status === 409 && code === "PROFILE_STALE"
                ? { id: row.id, outcome: "changedSince" }
                : { id: row.id, outcome: "failed", reason: code };
          }
        }
      }
    } catch {
      /* Only the READ carries the signal, so a throw under an aborted signal before the
         PUT went out is OUR Stop: nothing was written. Anything else is the
         network — reported as failed with no code; the roster re-reads the population
         after the run, so the row's badge shows what the server actually holds. */
      if (signal?.aborted && !putSent) {
        stopped = "aborted";
        outcome = { id: row.id, outcome: "notAttempted" };
      } else {
        outcome = { id: row.id, outcome: "failed", reason: null };
      }
    }
    outcomes.push(outcome);
    if (outcome.outcome !== "notAttempted") {
      done += 1;
      onProgress?.(done, toRun);
    }
  }
  return { outcomes, review, stopped };
}

/** Per-outcome counts for the result line. */
export function tallyOutcomes(outcomes: readonly RefreshOutcome[]): Record<RefreshOutcomeKind, number> {
  const tally: Record<RefreshOutcomeKind, number> = {
    refreshed: 0,
    changedSince: 0,
    throttled: 0,
    failed: 0,
    notAttempted: 0,
    skippedEdited: 0,
  };
  for (const o of outcomes) tally[o.outcome] += 1;
  return tally;
}
