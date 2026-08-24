// The "persist everything the wizard collected" body of OnboardingExperience's
// finish(), split out so the component stays under the 200-line file cap.
// Same best-effort-per-step contract (a failing invite must not sink the rest);
// throws are left for the caller's try/catch to turn into the generic "partial"
// toast.
import type { useTranslations } from "next-intl";
import { setOrgLanguage, setOrgName } from "@/app/_lib/org-actions";
import { toast } from "@/app/_components/toast-store";
import { axisEqualsStored, draftToStored } from "@/app/features/shared/pipelineAxisDraft";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import type { SetupInvite, SetupState } from "./setupSteps";

export async function persistOnboardingSetup(state: SetupState, t: ReturnType<typeof useTranslations>): Promise<void> {
  const name = state.orgName.trim();
  if (name) await setOrgName(name);
  await setOrgLanguage(state.language);

  // Brand (optional): merge over the current config — PUT replaces the whole
  // record, and onboarding must not clobber a displayName set elsewhere.
  const logo = state.logoUrl.trim();
  if (state.accentColor || logo) {
    try {
      const current = (await fetch("/api/brand").then((r) => (r.ok ? r.json() : null)).catch(() => null)) as {
        displayName?: string | null;
        accentColor?: string | null;
        logoUrl?: string | null;
      } | null;
      await fetch("/api/brand", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: current?.displayName ?? null,
          accentColor: state.accentColor ?? current?.accentColor ?? null,
          logoUrl: logo || current?.logoUrl || null,
        }),
      });
    } catch {
      /* brand is a nice-to-have — the rest of the setup still lands */
    }
  }

  const invitesLanded = await sendSetupInvites(state.invites);

  await persistPipelineAxis(state, t);
  await persistCompanionConsent(state);
  // The closing claim is the one the operator carries into the app, so it reports
  // what actually landed rather than what was attempted.
  if (invitesLanded) toast.success(t("toast.saved"));
  else toast.error(t("toast.partial"));
}

/**
 * Fire every staged invite; report whether they ALL landed.
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
 * Nobody invited is not a failure: an empty list lands vacuously, because
 * skipping the Team step is the documented default answer.
 */
export async function sendSetupInvites(invites: readonly SetupInvite[]): Promise<boolean> {
  const results = await Promise.allSettled(
    invites.map((inv) =>
      fetch("/api/org/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inv.email, role: inv.role }),
      })
    )
  );
  return results.every((r) => r.status === "fulfilled" && r.value.ok);
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
 * Silent on failure by design — the consent question is re-askable and nothing
 * downstream is broken by a missed stamp (the dock simply stays memoryless), so
 * a red toast about the companion at the end of a successful setup would be
 * noise. The pipeline write, which CHANGES the board, is the one that speaks up.
 */
async function persistCompanionConsent(state: SetupState): Promise<void> {
  if (!state.companionChoice) return;
  try {
    await fetch("/api/companion/brain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: state.companionChoice }),
    });
  } catch {
    /* re-askable; a missed stamp only means memory stays off */
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
async function persistPipelineAxis(state: SetupState, t: ReturnType<typeof useTranslations>): Promise<void> {
  const pipeline = state.pipeline;
  if (state.pipelineLoad !== "ready" || !pipeline) return;
  const savedStages: StageDef[] = pipeline.stored.stages.map((s) => ({ ...(s as StageDef) }));
  if (axisEqualsStored(pipeline.draft, pipeline.stored, savedStages)) return;
  try {
    const res = await fetch("/api/pipeline/stage-migration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: draftToStored(pipeline.draft, savedStages), migrate: {} }),
    });
    if (res.ok) toast.success(t("toast.pipelineSaved"));
    else toast.error(t("toast.pipelineFailed"));
  } catch {
    toast.error(t("toast.pipelineFailed"));
  }
}
