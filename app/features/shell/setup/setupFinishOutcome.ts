// What the wizard's finish() actually managed to write — folded into ONE claim.
//
// The trap this closes: every write the wizard fires can be REFUSED rather than
// fail. `setOrgName`/`setOrgLanguage` return `{ ok: false, code:
// "ORG_SETTINGS_FORBIDDEN" }` when the caller lacks `org:manage` (org-actions.ts),
// `POST /api/org/invites` answers 400/403/409, and the stage-migration route
// answers 409 on a stale occupancy read. None of those throws, so a finish that
// only watches for exceptions closes on a green "Your workspace is set up" while
// the org name and the app language never landed — structurally the same bug the
// invite batch already had once (setupOnboardingFinish.ts).
//
// Pure on purpose: no fetch, no React, no i18n. The component supplies the two
// translators, so the whole "did it land, and what do we tell the operator" rule
// is unit-testable under `node --test`.
import { copyInviteUrl } from "@/app/features/settings/workspace/workspaceAdminHelpers";

/** The writes finish() performs, in the order the toast should name them. */
export const SETUP_FINISH_PARTS = ["orgName", "language", "currency", "invites", "brand", "pipeline", "companion"] as const;
export type SetupFinishPart = (typeof SETUP_FINISH_PARTS)[number];

/**
 * One write's outcome.
 *
 * `skipped` is a first-class success, not a silent one: an empty invite list, an
 * untouched board axis and a blank org name are all legitimate answers (each step
 * ships a working default), and folding them as failures would make the honest
 * path the loud one.
 *
 * `brand` is here for the REFUSAL only, and that is the whole reason it was added.
 * A brand that lands still says nothing in the closing sentence — the accent and
 * the logo are decoration the operator can redo in Settings in one click, and
 * naming them would crowd out the writes that decide who can do what. But
 * PUT /api/brand now refuses an accent it cannot paint legibly in both themes
 * (BRAND_ACCENT_ILLEGIBLE_LIGHT / _DARK, BRAND_LOGO_INVALID), and the wizard used
 * to fire that write and discard the response — closing green over a brand the
 * server never stored. A wizard must not claim what it did not save.
 *
 * `companion` is here on the same terms, and it was the last write in this wizard
 * still fire-and-forget. Consent to Candi's memory is a CHOICE the operator made
 * on a step, and `POST /api/companion/brain` answers a 403 (no capability) or a
 * 500 without throwing, so the old `try { await fetch(...) } catch {}` treated a
 * refusal as a success. Skipping the step still posts nothing and reports
 * `skipped`; only a write that was asked for and did not land speaks. There is no
 * Settings control for consent, so a silent miss surfaced weeks later as the
 * dock's "memory off" line with no way to connect it to setup.
 */
export type SetupPartResult =
  | { part: SetupFinishPart; status: "landed" | "skipped" }
  | { part: SetupFinishPart; status: "refused"; code?: string | null; addresses?: readonly string[] };

export type SetupFinishFailure = { part: SetupFinishPart; code: string | null; addresses: string[] };

export type SetupFinishOutcome = { ok: true } | { ok: false; failures: SetupFinishFailure[] };

/**
 * Fold the per-write results into the single claim the closing toast makes.
 *
 * Ordered by SETUP_FINISH_PARTS rather than by arrival, so the sentence reads the
 * same whatever order the awaits resolved in. Several results for one part (the
 * invite batch reports per address) merge into one failure carrying every refused
 * address; the FIRST code wins, because a mixed batch still has one headline
 * reason and inventing a second sentence per address would bury it.
 */
export function foldSetupOutcome(results: readonly SetupPartResult[]): SetupFinishOutcome {
  const failures: SetupFinishFailure[] = [];
  for (const part of SETUP_FINISH_PARTS) {
    const refused = results.filter((r) => r.part === part && r.status === "refused");
    if (refused.length === 0) continue;
    const addresses = refused.flatMap((r) => ("addresses" in r ? [...(r.addresses ?? [])] : []));
    const code = refused.map((r) => ("code" in r ? (r.code ?? null) : null)).find((c) => c !== null) ?? null;
    failures.push({ part, code, addresses });
  }
  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}

/** Per-invite outcome, carried out of the batch so the toast can name the address
 *  the server refused rather than collapsing the batch to one boolean.
 *
 *  `token` is the accept link's capability token the route minted on a landed
 *  invite (null when it did not come back). kp sends no invite mail, so that link
 *  IS the invitation: it is shown to the inviting operator on the receipt and goes
 *  nowhere else - never logged, never into a URL query, never to telemetry.
 *  `httpStatus` is the route's answer (null on a network fault): the invite route's
 *  no-workspace 409 and cross-org 404 carry no code, and only the status can tell
 *  those permanent refusals from a retryable 429/5xx (isRetryable). */
export type SetupInviteResult = {
  email: string;
  ok: boolean;
  code: string | null;
  token?: string | null;
  httpStatus?: number | null;
};

/** Did every staged invite land? Nobody invited lands vacuously — skipping the
 *  Team step is the documented default answer. */
export function everyInviteLanded(results: readonly SetupInviteResult[]): boolean {
  return results.every((r) => r.ok);
}

/** The invite batch as ONE part result: refused carries every rejected address. */
export function inviteBatchResult(results: readonly SetupInviteResult[]): SetupPartResult {
  const refused = results.filter((r) => !r.ok);
  if (refused.length === 0) return { part: "invites", status: results.length === 0 ? "skipped" : "landed" };
  return {
    part: "invites",
    status: "refused",
    code: refused.map((r) => r.code).find((c) => c !== null) ?? null,
    addresses: refused.map((r) => r.email),
  };
}

/**
 * One sentence per failed write, in the reader's language.
 *
 * `label` names the part ("Organization name"); `reason` resolves the machine CODE
 * through the `errors` catalog — the same rule every other surface follows, so the
 * operator is told *why* by the server's vocabulary and never by its English prose
 * (use-error-message.ts). `line`/`lineWithAddresses` are the catalog's own
 * templates, so a locale can reorder the pieces.
 */
export function describeSetupFailures(
  failures: readonly SetupFinishFailure[],
  label: (part: SetupFinishPart) => string,
  reason: (code: string | null) => string,
  line: (parts: { part: string; reason: string }) => string,
  lineWithAddresses: (parts: { part: string; reason: string; addresses: string }) => string
): string[] {
  return failures.map((f) =>
    f.addresses.length > 0
      ? lineWithAddresses({ part: label(f.part), reason: reason(f.code), addresses: f.addresses.join(", ") })
      : line({ part: label(f.part), reason: reason(f.code) })
  );
}

/* ── the receipt ─────────────────────────────────────────────────────────── */
//
// Finish ends on a receipt when it leaves the operator something to act on, and
// closes exactly as before when it does not (finishNext). Two things earn one:
//   - an invite that LANDED: the route minted a capability link and sent nothing
//     (org/invites/route.ts - no mail relay), so the link in the operator's hand
//     is the only way the teammate ever hears of it;
//   - a part that did NOT land: the draft and the resume door are kept until the
//     operator has seen it, and Retry re-runs only what a retry can fix.

/** Everything one persist pass produced - the fold, the per-part results it was
 *  folded from, and the per-invite results (tokens, statuses) the fold drops. */
export type SetupFinishRun = {
  outcome: SetupFinishOutcome;
  parts: SetupPartResult[];
  invites: SetupInviteResult[];
};

export type SetupInviteLink = { email: string; url: string };
export type SetupReceiptFailure = SetupFinishFailure & { retryable: boolean };
export type SetupFinishReceipt = {
  /** One accept link per landed invite, in the order the operator staged them. */
  links: SetupInviteLink[];
  /** Landed invites whose token did not come back: the invite exists (Settings ->
   *  Workspaces lists it with its own Copy), but this pane cannot show its link. */
  unshareable: number;
  failures: SetupReceiptFailure[];
  /** Whether Retry is offered at all - only when some failure can be fixed by one. */
  canRetry: boolean;
};

/**
 * Can re-running this write land where the first run did not?
 *
 * Yes for a fault (no code: the network dropped, or a body we could not read), a
 * rate limit, and a store accident (every STORE_ERRORS code ends in `_FAILED`, the
 * one the stage-migration route answers is STAGE_MIGRATION_FAILED). No for every
 * other code: a coded refusal is a DECISION (forbidden, already a member, a role
 * above the caller's, an illegible accent, an axis that now strands candidates),
 * and offering Retry on one teaches the operator that the button does nothing.
 *
 * The invite route answers two refusals WITHOUT a code - no team to seat anyone on
 * (409) and a cross-org team (404) - so for invites a code-less answer that came
 * with a status is permanent unless that status is 429 or 5xx.
 */
export function isRetryable(failure: { part: SetupFinishPart; code: string | null; httpStatus?: number | null }): boolean {
  const { code } = failure;
  if (code === "TOO_MANY_REQUESTS" || (code !== null && code.endsWith("_FAILED"))) return true;
  if (code !== null) return false;
  const status = failure.httpStatus ?? null;
  if (failure.part === "invites" && status !== null) return status === 429 || status >= 500;
  return true;
}

/**
 * The receipt this run owes the operator, or null when it owes none (every write
 * landed or was skipped, and no invite was minted) - null is what keeps the
 * invite-less first run closing exactly as it always has.
 *
 * `origin` is the runtime origin (window.location.origin); the link goes through
 * copyInviteUrl, the rule the Workspaces console copies with, so a configured
 * public base URL wins over a localhost one.
 *
 * Refused invites are grouped by (retryable, code) in staged order, so a retryable
 * network drop and a permanent "already a member" never share one reason.
 */
export function finishReceipt(run: SetupFinishRun, origin: string): SetupFinishReceipt | null {
  const links: SetupInviteLink[] = [];
  let unshareable = 0;
  for (const inv of run.invites) {
    if (!inv.ok) continue;
    if (inv.token) links.push({ email: inv.email, url: copyInviteUrl(origin, inv.token) });
    else unshareable += 1;
  }
  const failures: SetupReceiptFailure[] = [];
  for (const f of run.outcome.ok ? [] : run.outcome.failures) {
    if (f.part !== "invites") {
      failures.push({ ...f, retryable: isRetryable(f) });
      continue;
    }
    // The invite part's failure is rebuilt from the per-invite results, which
    // carry the status the fold dropped. A fold with no per-invite detail (never
    // produced by persistOnboardingSetup) keeps the folded failure as it is.
    const refused = run.invites.filter((i) => !i.ok);
    if (refused.length === 0) {
      failures.push({ ...f, retryable: isRetryable(f) });
      continue;
    }
    const groups: SetupReceiptFailure[] = [];
    for (const inv of refused) {
      const retryable = isRetryable({ part: "invites", code: inv.code, httpStatus: inv.httpStatus });
      const group = groups.find((g) => g.retryable === retryable && g.code === inv.code);
      if (group) group.addresses.push(inv.email);
      else groups.push({ part: "invites", code: inv.code, addresses: [inv.email], retryable });
    }
    failures.push(...groups);
  }
  if (links.length === 0 && unshareable === 0 && failures.length === 0) return null;
  return { links, unshareable, failures, canRetry: failures.some((f) => f.retryable) };
}

/** What finish() does next: close as it always has, or stay open on the receipt.
 *  The completed stamp and the draft clear run on whichever path CLOSES - straight
 *  away for "close", at the receipt's Done otherwise. */
export function finishNext(outcome: SetupFinishOutcome, receipt: SetupFinishReceipt | null): "close" | "receipt" {
  // finishReceipt never answers null for a failed outcome; reading the outcome
  // here too keeps a hand-built pair from closing green over a failure.
  return receipt === null && outcome.ok ? "close" : "receipt";
}

/**
 * Fold a retry pass into the run it retried.
 *
 * `retried` are the parts the retry was allowed to write; every other part keeps
 * its FIRST answer (a retry reports those as skipped, and "skipped" must not
 * overwrite "landed"). Invites merge per address: a retried address takes the
 * retry's result (and its new token), everyone else - jana's landed invite and
 * her live link included - keeps theirs. The invite part is then re-folded from
 * the merged list, so a permanent refusal that was not retried stays named.
 */
export function mergeFinishRuns(
  first: SetupFinishRun,
  retry: SetupFinishRun,
  retried: readonly SetupFinishPart[]
): SetupFinishRun {
  const again = new Set(retried);
  const byEmail = new Map(retry.invites.map((i) => [i.email, i]));
  const invites = again.has("invites") ? first.invites.map((i) => byEmail.get(i.email) ?? i) : first.invites;
  const parts = first.parts.map((p) => {
    if (!again.has(p.part)) return p;
    if (p.part === "invites") return inviteBatchResult(invites);
    return retry.parts.find((r) => r.part === p.part) ?? p;
  });
  return { outcome: foldSetupOutcome(parts), parts, invites };
}
