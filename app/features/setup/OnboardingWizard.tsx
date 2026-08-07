"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Rocket, X } from "lucide-react";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { APP_LANGUAGES, type AppLanguage } from "@/app/features/sub_organization/mock";
import { BTN_GHOST, BTN_PRIMARY, EYEBROW, FIELD, INTRO } from "@/app/_components/ui/recipes";
import { InviteEditor } from "./InviteEditor";
import { JobDescriptionStep } from "./JobDescriptionStep";
import { SETUP_STEPS, type OnboardingCtrl } from "./steps";

// Spotlight Wizard — the first-run setup as a centered takeover. A branded left
// rail carries the vertical stepper; the right pane devotes the whole space to
// ONE step at a time (Organization → Language → Team → First role → Done), each
// crossfaded. The background mask is per-theme (see below): a dark ink veil in
// Studio Light, a deep paper veil in Spark Dark — because `ink` flips light in
// dark mode, a single mask would wash the screen out instead of dimming it.
export function OnboardingWizard({ ctrl }: { ctrl: OnboardingCtrl }) {
  const reduced = useReducedMotion();
  const step = SETUP_STEPS[ctrl.stepIndex];
  const canSkip = step.id === "team" || step.id === "jobDescription";

  return (
    <div className="absolute inset-0 grid place-items-center bg-ink/55 p-4 backdrop-blur-sm dark:bg-paper/90">
      <div className="relative w-full max-w-3xl overflow-hidden rounded-xl border-2 border-stone-300 bg-white shadow-pop dark:rounded-2xl">
        <button
          type="button"
          onClick={ctrl.onClose}
          className="focus-ring absolute right-2.5 top-2.5 z-10 rounded-full p-1.5 text-steel transition-colors hover:bg-stone-100 hover:text-ink"
          aria-label="Skip setup for now"
          title="Skip setup for now"
        >
          <X size={18} aria-hidden />
        </button>

        <div className="grid md:grid-cols-[13rem_1fr]">
          {/* Left rail — brand + vertical stepper */}
          <div className="hidden flex-col gap-6 border-r border-stone-200 bg-paper p-5 md:flex">
            <div className="flex items-center gap-2">
              <KandidateMark className="h-8 w-8 text-ink [--k-accent:var(--color-coral)] [--k-fg:var(--color-paper)]" />
              <span className="font-serif text-h3 text-ink">KP</span>
            </div>
            <ol className="space-y-1">
              {SETUP_STEPS.map((p, i) => {
                const done = ctrl.stepIndex > i;
                const active = ctrl.stepIndex === i;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => ctrl.goTo(i)}
                      aria-current={active ? "step" : undefined}
                      className="focus-ring flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white"
                    >
                      <span
                        aria-hidden
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                          active
                            ? "bg-coral text-white"
                            : done
                              ? "bg-moss/15 text-moss"
                              : "border border-stone-300 bg-white text-steel"
                        }`}
                      >
                        {done ? <Check size={13} /> : i + 1}
                      </span>
                      <span className={`text-sm ${active ? "font-semibold text-ink" : done ? "text-moss" : "text-steel"}`}>{p.label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="mt-auto text-meta uppercase tracking-wide text-steel">
              Step <span className="nums text-ink">{ctrl.stepIndex + 1}</span> of {SETUP_STEPS.length}
            </p>
          </div>

          {/* Right pane — one step at a time (body scrolls, footer pinned) */}
          <div className="flex max-h-[86vh] min-h-[22rem] flex-col p-6 sm:p-8">
            <div className="flex-1 overflow-y-auto">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step.id}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  transition={{ duration: reduced ? 0 : 0.2 }}
                >
                  <p className={EYEBROW}>{step.id === "done" ? "Welcome aboard" : `Set up · ${step.label}`}</p>
                  <h2 className="mt-1 font-serif text-h2 text-ink">{step.title}</h2>
                  <p className={`mt-2 max-w-md ${INTRO}`}>{step.blurb}</p>

                  <div className="mt-6">
                    {step.id === "organization" ? (
                      <input
                        autoFocus
                        value={ctrl.state.orgName}
                        onChange={(e) => ctrl.update({ orgName: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && ctrl.canAdvance && ctrl.next()}
                        placeholder="e.g. Česká spořitelna"
                        className={`${FIELD} w-full max-w-md py-2.5 text-lg`}
                      />
                    ) : null}
                    {step.id === "language" ? (
                      <SegmentedControl<AppLanguage>
                        label="App language"
                        value={ctrl.state.language}
                        onChange={(language) => ctrl.update({ language })}
                        options={APP_LANGUAGES.map((l) => ({ value: l.value, label: l.native }))}
                      />
                    ) : null}
                    {step.id === "team" ? (
                      <div className="max-w-md">
                        <InviteEditor ctrl={ctrl} />
                      </div>
                    ) : null}
                    {step.id === "jobDescription" ? <JobDescriptionStep ctrl={ctrl} /> : null}
                    {step.id === "done" ? <DoneSummary ctrl={ctrl} /> : null}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Footer controls */}
            <div className="mt-6 flex items-center gap-2 border-t border-stone-200 pt-4">
              {ctrl.stepIndex > 0 && step.id !== "done" ? (
                <button type="button" onClick={ctrl.back} className={`${BTN_GHOST} h-10 px-3`}>
                  <ArrowLeft size={16} aria-hidden /> Back
                </button>
              ) : null}
              <div className="flex-1" />
              {canSkip ? (
                <button type="button" onClick={ctrl.next} className={`${BTN_GHOST} h-10 px-3`}>
                  Skip for now
                </button>
              ) : null}
              {step.id === "done" ? (
                <button type="button" onClick={ctrl.finish} className={`${BTN_PRIMARY} h-10 px-5`}>
                  <Rocket size={16} aria-hidden /> Enter KP
                </button>
              ) : (
                <button type="button" onClick={ctrl.next} disabled={!ctrl.canAdvance} className={`${BTN_PRIMARY} h-10 px-5`}>
                  Continue <ArrowRight size={16} aria-hidden />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Summary shown on the final step — reflects everything captured, so the user
// sees their setup pay off (org, language, invites, and the first role).
function DoneSummary({ ctrl }: { ctrl: OnboardingCtrl }) {
  const { orgName, language, invites, job } = ctrl.state;
  const lang = APP_LANGUAGES.find((l) => l.value === language)?.native;
  const role = job.title.trim() || (job.body.trim() ? "an imported role" : null);
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3 rounded-lg border border-moss/30 bg-moss/5 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-moss/15 text-moss">
          <Check size={20} aria-hidden />
        </span>
        <div className="text-sm">
          <p className="font-semibold text-ink">{orgName || "Your organization"} is ready</p>
          <p className="text-steel">
            Language: {lang}
            {invites.length > 0 ? ` · ${invites.length} teammate(s) invited` : " · no invites yet"}
          </p>
        </div>
      </div>
      {role ? (
        <div className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-coral/10 text-coral">
            <Rocket size={18} aria-hidden />
          </span>
          <div className="text-sm">
            <p className="font-semibold text-ink">First role: {role}</p>
            <p className="text-steel">KP will start sourcing and screening candidates against it.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
