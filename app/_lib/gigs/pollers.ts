import { listGigs } from "../db/gigs";
import { listGigAttemptsForGig } from "../db/gigs-attempts";
import { listGigOutcomes } from "../db/gigs-outcomes";
import { politeFetch, type PoliteFetch } from "../jobseeker/fetch/politeFetch";
import { githubRead, type GithubReadOutcome } from "../repo-snapshot";
import { basicAuth } from "./adapters/shared";
import { hasPollerOutcome, latestSentAttempt, recordGigOutcome } from "./outcome";
import type { Gig, GigAttempt, GigOutcomeSource, GigOutcomeVerdict } from "./types";

// Outcome pollers - read the external judge's verdict where an official API states it,
// so sent work resolves without the operator typing it in. Called from the `gig_sync`
// runner (late-bound-boot.ts) and the `gig_sync` clock job (instrumentation-node.ts),
// after the Personas run sync, per workspace.
//
// Two pollers, each over the workspace's gigs still `sent`, each reading only the gig's
// LATEST sent attempt:
//
//   GitHub (oss_bounty)   the attempt's deliverable artifacts of kind `pr` whose ref is a
//                         GitHub pull request (a URL, or owner/repo#n). One read each
//                         through repo-snapshot.ts `githubRead` - the one GitHub
//                         transport, GITHUB_TOKEN/GH_TOKEN optional (60 reads an hour
//                         without one), KP_OFFLINE honoured. Any PR merged -> accepted;
//                         every PR closed unmerged -> rejected; otherwise still pending.
//                         A merge proves the work was taken, not that the bounty paid:
//                         `amount` stays null - money is the operator's to record.
//
//   Kaggle (competition)  only with KAGGLE_USERNAME + KAGGLE_KEY (no key -> no-op,
//                         never an outcome), and only once the gig's deadline passed (a
//                         leaderboard is not final before it). One read of the account's
//                         submissions for the competition, through the same polite door
//                         the Kaggle adapter uses: a completed submission with a PRIVATE
//                         score -> accepted (the entry stands on the final leaderboard -
//                         the verdict is about a valid scored entry, never about placing
//                         or winning); every submission errored -> rejected; none yet, or
//                         no private score yet -> still pending.
//
// IDEMPOTENT: a poller never appends a second verdict for the same attempt (outcome.ts
// hasPollerOutcome), and a recorded verdict moves the gig out of `sent` besides. An
// unreadable answer (throttled, offline, a shape kp does not know) is counted and
// retried on the next tick - it is never read as a verdict.

export const GIG_POLLER_MAX_GIGS = 200;
/** PR artifacts read per attempt - a draft that lists more is a draft to look at by hand. */
export const GIG_POLLER_MAX_PRS = 5;

const GH = "https://api.github.com";
const KAGGLE_HOST = "www.kaggle.com";

export type GigPollerDeps = {
  githubRead: <T>(url: string) => Promise<GithubReadOutcome<T>>;
  fetch: PoliteFetch;
  env: (name: string) => string | undefined;
  now: () => Date;
};

export function defaultGigPollerDeps(): GigPollerDeps {
  return {
    githubRead,
    fetch: politeFetch,
    env: (name) => process.env[name],
    now: () => new Date(),
  };
}

export type GigPollSummary = {
  /** Gigs whose latest sent attempt was asked about. */
  checked: number;
  accepted: number;
  rejected: number;
  /** Asked, and the judge has not decided yet. */
  pending: number;
  /** Not asked: no PR ref (GitHub), no key or deadline not passed (Kaggle), no sent
   *  attempt, or a poller verdict already recorded for the attempt. */
  skipped: number;
  /** Asked, and the answer could not be read (throttled, offline, unknown shape). */
  unreadable: number;
};

function emptySummary(): GigPollSummary {
  return { checked: 0, accepted: 0, rejected: 0, pending: 0, skipped: 0, unreadable: 0 };
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

export type PullRef = { owner: string; repo: string; number: number };

const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;

/** A GitHub pull request named by a URL (https://github.com/o/r/pull/12, any suffix) or
 *  the short form o/r#12. Null for anything else - a link to another forge is not
 *  polled, and a ref with a strange owner/repo never reaches a URL. */
export function parsePullRef(ref: string): PullRef | null {
  const s = ref.trim();
  const url = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d{1,9})(?:[/?#].*)?$/i.exec(s);
  const short = url ? null : /^([^/\s#]+)\/([^/\s#]+)#(\d{1,9})$/.exec(s);
  const m = url ?? short;
  if (!m) return null;
  const [, owner, repo, n] = m;
  if (!NAME.test(owner) || !NAME.test(repo)) return null;
  const number = Number(n);
  return Number.isSafeInteger(number) && number > 0 ? { owner, repo, number } : null;
}

export function pullRefsOf(attempt: Pick<GigAttempt, "deliverable">): PullRef[] {
  const out: PullRef[] = [];
  const seen = new Set<string>();
  for (const a of attempt.deliverable?.artifacts ?? []) {
    if (a.kind !== "pr" || typeof a.ref !== "string") continue;
    const ref = parsePullRef(a.ref);
    if (!ref) continue;
    const key = `${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
    if (out.length >= GIG_POLLER_MAX_PRS) break;
  }
  return out;
}

type PullState = "merged" | "closed" | "open" | "unreadable";

/** The PR's state from GitHub's pulls payload. Pure; exported for the table test. */
export function pullStateOf(data: unknown): PullState {
  if (!data || typeof data !== "object") return "unreadable";
  const d = data as { state?: unknown; merged?: unknown; merged_at?: unknown };
  if (d.merged === true || (typeof d.merged_at === "string" && d.merged_at)) return "merged";
  if (d.state === "closed") return "closed";
  if (d.state === "open") return "open";
  return "unreadable";
}

/** Merged anywhere -> accepted; every PR closed unmerged -> rejected; else pending.
 *  Null verdict + `unreadable` when any read failed and nothing was merged. */
export function verdictFromPulls(states: readonly PullState[]): { verdict: GigOutcomeVerdict | null; unreadable: boolean } {
  if (states.includes("merged")) return { verdict: "accepted", unreadable: false };
  if (states.includes("unreadable")) return { verdict: null, unreadable: true };
  if (states.length > 0 && states.every((s) => s === "closed")) return { verdict: "rejected", unreadable: false };
  return { verdict: null, unreadable: false };
}

async function pollGithub(workspaceId: string, gig: Gig, attempt: GigAttempt, deps: GigPollerDeps, s: GigPollSummary): Promise<void> {
  const refs = pullRefsOf(attempt);
  if (refs.length === 0) {
    s.skipped += 1;
    return;
  }
  s.checked += 1;
  const states: PullState[] = [];
  for (const r of refs) {
    let res: GithubReadOutcome<unknown>;
    try {
      res = await deps.githubRead<unknown>(
        `${GH}/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}/pulls/${r.number}`
      );
    } catch {
      // githubRead never throws; an injected one might - same as unreadable.
      res = { ok: false, kind: "unreachable" };
    }
    states.push(res.ok ? pullStateOf(res.data) : "unreadable");
    if (states[states.length - 1] === "merged") break;
  }
  land(workspaceId, gig, attempt, verdictFromPulls(states), "poller:github", s);
}

// ---------------------------------------------------------------------------
// Kaggle
// ---------------------------------------------------------------------------

/** The competition slug of a Kaggle gig (the adapter's URL shape, or its external key). */
export function kaggleSlugOf(gig: Pick<Gig, "url" | "externalKey">): string | null {
  const m = /^https?:\/\/(?:www\.)?kaggle\.com\/(?:c|competitions)\/([a-z0-9][a-z0-9-]{0,120})(?:[/?#].*)?$/i.exec(gig.url.trim());
  if (m) return m[1];
  const k = /^kaggle:([a-z0-9][a-z0-9-]{0,120})$/i.exec(gig.externalKey);
  return k ? k[1] : null;
}

type KaggleSubmission = { status?: unknown; privateScore?: unknown; private_score?: unknown };

function submissionsOf(parsed: unknown): KaggleSubmission[] | null {
  if (Array.isArray(parsed)) return parsed as KaggleSubmission[];
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { submissions?: unknown }).submissions)) {
    return (parsed as { submissions: KaggleSubmission[] }).submissions;
  }
  return null;
}

function hasScore(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  return typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v));
}

/** The verdict a submissions list states. Pure; exported for the table test. The CLI-era
 *  status words ("complete", "error", "pending") and the SDK-era enum names
 *  ("COMPLETE", "SubmissionStatus.ERROR") are both read. */
export function verdictFromKaggleSubmissions(parsed: unknown): { verdict: GigOutcomeVerdict | null; unreadable: boolean } {
  const subs = submissionsOf(parsed);
  if (!subs) return { verdict: null, unreadable: true };
  if (subs.length === 0) return { verdict: null, unreadable: false };
  const status = (x: KaggleSubmission) => (typeof x.status === "string" ? x.status.toLowerCase() : "");
  if (subs.some((x) => status(x).includes("complete") && hasScore(x.privateScore ?? x.private_score))) {
    return { verdict: "accepted", unreadable: false };
  }
  if (subs.every((x) => status(x).includes("error"))) return { verdict: "rejected", unreadable: false };
  return { verdict: null, unreadable: false };
}

async function pollKaggle(workspaceId: string, gig: Gig, attempt: GigAttempt, deps: GigPollerDeps, s: GigPollSummary): Promise<void> {
  const user = deps.env("KAGGLE_USERNAME")?.trim();
  const key = deps.env("KAGGLE_KEY")?.trim();
  const slug = kaggleSlugOf(gig);
  const deadline = gig.deadlineAt ? Date.parse(gig.deadlineAt) : NaN;
  // No key, no slug, no deadline, or a deadline not yet passed: nothing final to read.
  if (!user || !key || !slug || !Number.isFinite(deadline) || deadline > deps.now().getTime()) {
    s.skipped += 1;
    return;
  }
  s.checked += 1;
  let parsed: unknown = null;
  let readable = false;
  try {
    const res = await deps.fetch(`https://${KAGGLE_HOST}/api/v1/competitions/submissions/list/${encodeURIComponent(slug)}?page=1`, {
      sourceId: gig.sourceId ?? "gig-poller-kaggle",
      host: KAGGLE_HOST,
      accept: "application/json",
      authorization: basicAuth(user, key),
    });
    if (res.kind === "ok") {
      parsed = JSON.parse(res.body) as unknown;
      readable = true;
    }
  } catch {
    // A body that is not JSON, or an injected fetch that threw: unreadable this tick.
    readable = false;
  }
  land(workspaceId, gig, attempt, readable ? verdictFromKaggleSubmissions(parsed) : { verdict: null, unreadable: true }, "poller:kaggle", s);
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

function land(
  workspaceId: string,
  gig: Gig,
  attempt: GigAttempt,
  read: { verdict: GigOutcomeVerdict | null; unreadable: boolean },
  source: GigOutcomeSource,
  s: GigPollSummary
): void {
  if (read.unreadable) {
    s.unreadable += 1;
    return;
  }
  if (!read.verdict) {
    s.pending += 1;
    return;
  }
  const res = recordGigOutcome(workspaceId, {
    gigId: gig.id,
    attemptId: attempt.id,
    verdict: read.verdict,
    amount: null,
    currency: null,
    feedbackText: null,
    source,
  });
  if (!res.ok) {
    // The gig or attempt moved while the read was on the wire; the next tick re-reads.
    s.pending += 1;
    return;
  }
  if (read.verdict === "accepted") s.accepted += 1;
  else s.rejected += 1;
}

/** One poller pass over the workspace's `sent` gigs, sequential (a handful of rows, and
 *  each read is a third-party request under a courtesy budget). */
export async function pollGigOutcomes(workspaceId: string, deps: GigPollerDeps = defaultGigPollerDeps()): Promise<GigPollSummary> {
  const s = emptySummary();
  for (const arena of ["oss_bounty", "competition"] as const) {
    for (const gig of listGigs(workspaceId, { arena, statuses: ["sent"], limit: GIG_POLLER_MAX_GIGS })) {
      const attempt = latestSentAttempt(listGigAttemptsForGig(workspaceId, gig.id));
      if (!attempt || hasPollerOutcome(listGigOutcomes(workspaceId, { gigId: gig.id }), attempt.id)) {
        s.skipped += 1;
        continue;
      }
      if (arena === "oss_bounty") await pollGithub(workspaceId, gig, attempt, deps, s);
      else await pollKaggle(workspaceId, gig, attempt, deps, s);
    }
  }
  return s;
}

/** Whether a workspace has anything a poller would ask about - the clock job's filter,
 *  so a tick with nothing sent costs one indexed read per workspace. */
export function hasPollableGigs(workspaceId: string): boolean {
  return (
    listGigs(workspaceId, { arena: "oss_bounty", statuses: ["sent"], limit: 1 }).length > 0 ||
    listGigs(workspaceId, { arena: "competition", statuses: ["sent"], limit: 1 }).length > 0
  );
}
