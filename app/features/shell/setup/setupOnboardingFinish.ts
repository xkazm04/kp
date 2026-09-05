// The "persist everything the wizard collected" body of OnboardingExperience's
// finish(), split out so the component stays under the 200-line file cap.
//
// Best-effort PER STEP (a refused invite must not sink the org name) but never
// SILENT: every write reports a SetupPartResult and the caller folds them into ONE
// truthful closing claim (setupFinishOutcome.ts). This module raises no toast of
// its own — it has no business deciding what the operator is told, and two writes
// each toasting their own verdict is how the wizard used to end with a green
// "Your workspace is set up" over a red pipeline error.
import { setOrgLanguage, setOrgName } from "@/app/_lib/org-actions";
import { axisEqualsStored, draftToStored } from "@/app/features/shared/pipelineAxisDraft";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import {
  foldSetupOutcome,
  inviteBatchResult,
  type SetupFinishOutcome,
  type SetupInviteResult,
  type SetupPartResult,
} from "./setupFinishOutcome";
import type { SetupInvite, SetupState } from "./setupSteps";

export async function persistOnboardingSetup(state: SetupState): Promise<SetupFinishOutcome> {
  const results: SetupPartResult[] = [];

  // Both org settings are REFUSABLE, not merely failable: since the org:manage
  // gate landed on them (org-actions.ts), a recruiter finishing the wizard gets
  // `{ ok: false, code: "ORG_SETTINGS_FORBIDDEN" }` and nothing is written. The
  // old finish() discarded both return values, so the workspace kept the seed
  // default as its identity on every generated JD, offer and candidate mail while
  // the wizard closed green.
  const name = state.orgName.trim();
  if (!name) results.push({ part: "orgName", status: "skipped" });
  else {
    const res = await setOrgName(name);
    results.push(res.ok ? { part: "orgName", status: "landed" } : { part: "orgName", status: "refused", code: res.code });
  }
  const lang = await setOrgLanguage(state.language);
  results.push(lang.ok ? { part: "language", status: "landed" } : { part: "language", status: "refused", code: lang.code });

  results.push(await persistSetupBrand(state));

  results.push(inviteBatchResult(await sendSetupInvites(state.invites)));
  results.push(await persistPipelineAxis(state));
  results.push(await persistCompanionConsent(state));
  return foldSetupOutcome(results);
}

/**
 * The optional first brand touch (accent + logo), merged over the current config —
 * PUT replaces the whole record, so onboarding must not clobber a displayName set
 * elsewhere.
 *
 * REPORTED, not fire-and-forget. This used to `await fetch(...)` and discard the
 * response inside a catch that said "brand is a nice-to-have", which was true of a
 * FAILURE and false of a REFUSAL: `PUT /api/brand` now answers 400 with a code when
 * the accent cannot be painted legibly in both themes
 * (`BRAND_ACCENT_ILLEGIBLE_LIGHT` / `BRAND_ACCENT_ILLEGIBLE_DARK`) or the logo URL
 * is not storable (`BRAND_LOGO_INVALID`) — and `fetch` RESOLVES on all of those.
 * The wizard closed green over a brand the server had never stored, and the
 * operator's next clue was the app still wearing the default color.
 *
 * A landed brand still says nothing (see setupFinishOutcome.ts): only the refusal
 * reaches the closing sentence, where the component resolves the code through
 * `useErrorMessage` like every other surface.
 */
export async function persistSetupBrand(state: SetupState): Promise<SetupPartResult> {
  const logo = state.logoUrl.trim();
  if (!state.accentColor && !logo) return { part: "brand", status: "skipped" };
  try {
    const current = (await fetch("/api/brand").then((r) => (r.ok ? r.json() : null)).catch(() => null)) as {
      displayName?: string | null;
      accentColor?: string | null;
      logoUrl?: string | null;
    } | null;
    const res = await fetch("/api/brand", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: current?.displayName ?? null,
        accentColor: state.accentColor ?? current?.accentColor ?? null,
        logoUrl: logo || current?.logoUrl || null,
      }),
    });
    if (res.ok) return { part: "brand", status: "landed" };
    // The code is the information; the server's English `error` never reaches the
    // reader. A refusal with no parseable body still refuses — with a null code the
    // toast renders as its generic reason, rather than as a success.
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    return { part: "brand", status: "refused", code: body?.code ?? null };
  } catch {
    // A network fault is not "nice-to-have" either: nothing was stored, so the
    // wizard must not imply the brand was applied.
    return { part: "brand", status: "refused", code: null };
  }
}

/**
 * Fire every staged invite; report EACH one's outcome.
 *
 * Best-effort PER INVITE (one refusal must not sink the rest — hence allSettled),
 * but never SILENT. `POST /api/org/invites` refuses a malformed address (400), a
 * role above the caller's own (403) and an already-active member (409), and
 * `fetch` RESOLVES on every one of those — so "did it land" is `res.ok`, not "it
 * didn't throw". Firing these and discarding the results closed the wizard on a
 * green "Your workspace is set up" when nobody had been invited, one step after
 * the hand-off summary said "1 teammate invited". The Organization console
 * already reports the same three refusals (settings/workspace/WorkspaceTab.tsx).
 *
 * The route answers each refusal with a machine CODE (jsonRefusal), so the address
 * AND the reason travel back rather than collapsing to one boolean — the partial
 * toast can then say which invitee was refused and why, in the reader's language.
 *
 * Nobody invited is not a failure: an empty list lands vacuously, because
 * skipping the Team step is the documented default answer.
 */
export async function sendSetupInvites(invites: readonly SetupInvite[]): Promise<SetupInviteResult[]> {
  const settled = await Promise.allSettled(
    invites.map((inv) =>
      fetch("/api/org/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inv.email, role: inv.role }),
      })
    )
  );
  return Promise.all(
    settled.map(async (r, i): Promise<SetupInviteResult> => {
      const email = invites[i].email;
      // A network rejection has no response and therefore no code: the toast falls
      // back to the generic "couldn't be saved" line rather than inventing one.
      if (r.status !== "fulfilled") return { email, ok: false, code: null };
      if (r.value.ok) return { email, ok: true, code: null };
      const body = (await r.value.json().catch(() => null)) as { code?: unknown } | null;
      return { email, ok: false, code: typeof body?.code === "string" ? body.code : null };
    })
  );
}

/**
 * Candi's memory — written only when the operator actually asked for it.
 *
 * A null choice is "skip for now" and it POSTS NOTHING. That is the whole design
 * of the consent step: skipping must leave the machine exactly as it was, so
 * there is no "declined" state to record and no request to make. Recording a
 * refusal would also be a claim we cannot honour, since a null column and an
 * explicit no behave identically (the dock runs memoryless either way).
 *
 * Deferred to finish() rather than fired on click for the same reason every
 * other answer in this wizard is: preview mode's finish() persists nothing, so
 * routing consent through here is what makes the Settings walkthrough incapable
 * of birthing a brain. `birth` is idempotent server-side, so a double finish
 * cannot make two.
 *
 * REPORTED, not silent. This used to `await fetch(...)` inside a catch and discard
 * the response, on the argument that the question is re-askable — but nothing
 * re-asks it: the wizard runs once and there is no consent control in Settings, so
 * the operator's only clue that their "yes" never landed was the dock still saying
 * "memory off", weeks later, with nothing to connect it to. And `fetch` RESOLVES on
 * a 403 (a seat without the capability) and on a 500, so the old shape did not even
 * catch the cases it was written for. A choice the operator MADE is now folded like
 * every other write: skipping still posts nothing and reports `skipped`, and only a
 * requested write that did not land reaches the closing sentence, where the code is
 * resolved through `useErrorMessage` in the reader's language.
 */
export async function persistCompanionConsent(state: SetupState): Promise<SetupPartResult> {
  if (!state.companionChoice) return { part: "companion", status: "skipped" };
  try {
    const res = await fetch("/api/companion/brain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: state.companionChoice }),
    });
    if (res.ok) return { part: "companion", status: "landed" };
    // The code is the information; the server's English `error` never reaches the
    // reader. An unparseable refusal still refuses, with a null code.
    const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
    return { part: "companion", status: "refused", code: typeof body?.code === "string" ? body.code : null };
  } catch {
    // A network fault stored nothing either: the wizard must not imply memory is on.
    return { part: "companion", status: "refused", code: null };
  }
}

/**
 * The board's columns — written only when the operator actually changed them.
 *
 * An untouched axis writes NOTHING: accepting the default is a legitimate answer,
 * and a needless POST would promote the shipped axis to a team-scoped override
 * (see /api/pipeline/stage-migration → setDecisionConfig scope "team"), silently
 * detaching this workspace from a later org baseline change.
 *
 * It goes through the stage-migration route, not /api/decisions/config, because
 * that route is the one that owns "remove a column AND move whoever stood on it"
 * as a single operation. `migrate` is empty here by construction: the step refuses
 * to remove an occupied column at all (setupPipelineEdit.ts), since a wizard has
 * nowhere to ask where those candidates should go. If the server disagrees — the
 * occupancy read was stale, someone applied elsewhere mid-setup — it answers 409
 * and the operator is told to finish the change in Settings rather than being
 * shown a green lie.
 */
async function persistPipelineAxis(state: SetupState): Promise<SetupPartResult> {
  const pipeline = state.pipeline;
  if (state.pipelineLoad !== "ready" || !pipeline) return { part: "pipeline", status: "skipped" };
  const savedStages: StageDef[] = pipeline.stored.stages.map((s) => ({ ...(s as StageDef) }));
  if (axisEqualsStored(pipeline.draft, pipeline.stored, savedStages)) return { part: "pipeline", status: "skipped" };
  try {
    const res = await fetch("/api/pipeline/stage-migration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: draftToStored(pipeline.draft, savedStages), migrate: {} }),
    });
    if (res.ok) return { part: "pipeline", status: "landed" };
    const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
    return { part: "pipeline", status: "refused", code: typeof body?.code === "string" ? body.code : null };
  } catch {
    return { part: "pipeline", status: "refused", code: null };
  }
}
