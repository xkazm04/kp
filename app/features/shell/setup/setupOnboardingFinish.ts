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
import type { SetupState } from "./setupSteps";

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

  await Promise.allSettled(
    state.invites.map((inv) =>
      fetch("/api/org/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inv.email, role: inv.role }),
      })
    )
  );

  await persistPipelineAxis(state, t);
  toast.success(t("toast.saved"));
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
