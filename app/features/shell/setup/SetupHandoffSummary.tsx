"use client";

// Hand-off — the last onboarding step, split out of SetupOnboardingWizard.tsx so
// the wizard stays under the 200-line file cap. Reflects everything captured
// (org, language, invites, the first role's pending build) and points at the
// Getting-started checklist that takes over inside the app. Deliberately the
// QUIETEST step: plain panels, plain voice — the marketing register ended at
// Welcome.
import { ArrowRight, Check, ListChecks, Play, Rocket, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSimulation } from "@/app/features/shell/simulation/SimulationProvider";
import { languageNative } from "@/app/features/shared/memberUi";
import { EYEBROW } from "@/app/_components/ui/recipes";
import { SetupEngineStatusNote } from "./SetupEngineStatusNote";
import { roleStepComplete, type OnboardingCtrl } from "./setupSteps";

export function SetupHandoffSummary({ ctrl }: { ctrl: OnboardingCtrl }) {
  const t = useTranslations("setup.handoff");
  const sim = useSimulation();
  const { orgName, language, invites, role } = ctrl.state;
  const lang = languageNative(language);
  const imported = role.mode === "import";
  const hasRole = roleStepComplete(role);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3 rounded-lg border border-moss/30 bg-moss/5 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-moss/15 text-moss">
          <Check size={20} aria-hidden />
        </span>
        <div className="text-sm">
          <p className="font-semibold text-ink">{t("readyTitle", { org: orgName.trim() || t("orgFallback") })}</p>
          <p className="text-steel">
            {t("readyMeta", { language: lang, invites: invites.length })}
          </p>
        </div>
      </div>

      {hasRole ? (
        <div className="space-y-2 rounded-lg border border-stone-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-coral/10 text-coral">
              <Sparkles size={18} aria-hidden />
            </span>
            <div className="text-sm">
              <p className="font-semibold text-ink">{t("roleTitle", { role: role.title.trim() })}</p>
              <p className="text-steel">{imported ? t("roleImportedBody") : t("roleBody")}</p>
            </div>
          </div>
          {/* Engine preflight (DATA4): finishing HERE is what actually starts the
              write-path build — repeat the honest degraded-engine note beside the
              claim so "AI build" is never promised on a server that will serve
              the deterministic fallback. Import mode renders nothing. */}
          <SetupEngineStatusNote mode={role.mode} />
        </div>
      ) : null}

      <div className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-steel/10 text-steel">
          <ListChecks size={18} aria-hidden />
        </span>
        <div className="text-sm">
          <p className="font-semibold text-ink">{t("checklistTitle")}</p>
          <p className="text-steel">{t("checklistBody")}</p>
        </div>
      </div>

      {/* The step's TWO exit paths, as equal explicit choices (the footer is
          suppressed here so nothing competes with them):
            — guided demo: finish (persist + stamp) and start the tour in one
              motion; sticker treatment marks it as the playful path.
            — explore solo: plain finish, with the pointer to WHERE the tour
              lives (the Candi button in the bottom bar) so it stays findable. */}
      <p className={`${EYEBROW} pt-2`}>{t("chooseLabel")}</p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => {
            ctrl.finish();
            sim.start();
          }}
          className="focus-ring group flex items-center gap-3 rounded-lg border-2 border-ink bg-paper p-4 text-left shadow-sticker-sm transition-all hover:-translate-y-0.5 hover:shadow-pop motion-reduce:transition-none motion-reduce:hover:translate-y-0 dark:-rotate-1 dark:hover:rotate-0"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-coral text-white shadow-sticker-xs">
            <Play size={18} aria-hidden className="translate-x-px" />
          </span>
          <span className="min-w-0 flex-1 text-sm">
            <span className="block font-semibold text-ink">{t("tourTitle")}</span>
            <span className="text-steel">{t("tourBody")}</span>
          </span>
          <ArrowRight size={16} aria-hidden className="shrink-0 text-coral transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </button>
        <button
          type="button"
          onClick={ctrl.finish}
          className="focus-ring group flex items-center gap-3 rounded-lg border-2 border-stone-300 bg-white p-4 text-left transition-all hover:border-ink hover:shadow-sticker-sm motion-reduce:transition-none"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-steel/10 text-steel transition-colors group-hover:bg-coral/10 group-hover:text-coral">
            <Rocket size={18} aria-hidden />
          </span>
          <span className="min-w-0 flex-1 text-sm">
            <span className="block font-semibold text-ink">{t("soloTitle")}</span>
            <span className="text-steel">{t("soloBody")}</span>
          </span>
          <ArrowRight size={16} aria-hidden className="shrink-0 text-steel transition-transform group-hover:translate-x-0.5 group-hover:text-coral motion-reduce:transition-none" />
        </button>
      </div>
    </div>
  );
}
