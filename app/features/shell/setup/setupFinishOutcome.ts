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

/** The writes finish() performs, in the order the toast should name them. */
export const SETUP_FINISH_PARTS = ["orgName", "language", "invites", "pipeline"] as const;
export type SetupFinishPart = (typeof SETUP_FINISH_PARTS)[number];

/**
 * One write's outcome.
 *
 * `skipped` is a first-class success, not a silent one: an empty invite list, an
 * untouched board axis and a blank org name are all legitimate answers (each step
 * ships a working default), and folding them as failures would make the honest
 * path the loud one.
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
 *  the server refused rather than collapsing the batch to one boolean. */
export type SetupInviteResult = { email: string; ok: boolean; code: string | null };

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
