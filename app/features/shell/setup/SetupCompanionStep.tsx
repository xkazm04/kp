"use client";

// Candi step — the one thing in this wizard that asks for CONSENT rather than
// for a setting.
//
// Her memory is not a row in kp's database: it is markdown in a folder in the
// operator's own home directory (~/.personas/companion-brain), shared on purpose
// with Personas' Athena. kp is therefore not entitled to create it, adopt it, or
// write into it until somebody says yes — and a first run that quietly births a
// mind on your disk is exactly the surprise this step exists to prevent.
//
// So the step LOOKS FIRST and asks the question the machine actually poses. The
// probe (GET /api/companion/brain, run by the host) creates nothing, which is
// what makes looking honest. Four outcomes, four different questions:
//
//   memory already on   nothing to ask — this workspace has been remembering for
//                       a while, and asking again would offer to connect what is
//                       already connected
//   a brain is present  adopt it? (never "start a fresh one alongside": one mind
//                       per machine is the doctrine, and a second would silently
//                       split her continuity in two)
//   no brain            make one?
//   probe failed        say so, and move on
//
// Skip is always there and always free. Nothing here is written now: the choice
// rides in the wizard's state and finish() persists it (setupOnboardingFinish),
// which is what keeps the Settings walkthrough honest — preview's finish()
// persists nothing at all, so a preview cannot birth anything.
//
// Register: the calm middle-slot form voice, like Company and Pipeline. The
// marketing energy ended at Welcome and a consent question is the last place to
// bring it back.

import { AlertTriangle, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { Skeleton } from "@/app/_components/Skeleton";
import { CHIP_TOGGLE, ICON_STICKER, META_LABEL } from "@/app/_components/ui/recipes";
import { EPISODE_PROBE_CAP, type CompanionBrainStatus } from "@/app/_lib/companion-brain-probe";
import { SETUP_PROSE } from "./setupProse";
import type { OnboardingCtrl } from "./setupSteps";

export function SetupCompanionStep({ ctrl }: { ctrl: OnboardingCtrl }) {
  const t = useTranslations("setup.companion");
  const { brain, brainLoad } = ctrl.state;

  if (brainLoad === "failed") {
    return (
      <p
        role="alert"
        className={`flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 ${SETUP_PROSE}`}
      >
        <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0" />
        {t("loadFailed")}
      </p>
    );
  }

  if (!brain) {
    // The shape of what is coming, not a shimmer bar: her mark, a line, a choice.
    return (
      <div className="space-y-5">
        <span className="sr-only" role="status">
          {t("loading")}
        </span>
        <div className="flex items-center gap-3" aria-hidden>
          <Skeleton className="h-11 w-11 rounded-xl" />
          <Skeleton className="h-5 w-40" />
        </div>
        <Skeleton className="h-16 w-full max-w-[36rem]" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Presence />
      {brain.memoryEnabled ? <AlreadyOn /> : <ConsentChoice ctrl={ctrl} brain={brain} />}
    </div>
  );
}

/** Her, small. The dock's own mark, at the dock's own treatment — recognising it
 *  three minutes later in the sidebar is the entire job of this element, so it
 *  must be the SAME drawing and not a wizard-only illustration. */
function Presence() {
  const t = useTranslations("setup.companion");
  const name = useTranslations("companion");
  return (
    <div className="flex items-center gap-3">
      <span className={`${ICON_STICKER} h-11 w-11`}>
        <KandidateMark className="h-7 w-7 text-ink [--k-accent:var(--color-coral)] [--k-fg:var(--color-paper)]" />
      </span>
      <span className="min-w-0">
        <span className="block font-serif text-h3 leading-tight text-ink">{name("name")}</span>
        <span className={`${META_LABEL} block`}>{t("role")}</span>
      </span>
    </div>
  );
}

/** The workspace is already remembering — an install that predates this step, or
 *  one that answered it before. Stated, not re-asked: an "Connect it" button over
 *  a memory that is already connected is a control with nothing to do. */
function AlreadyOn() {
  const t = useTranslations("setup.companion");
  return (
    <div className="flex items-start gap-3 rounded-lg border border-moss/30 bg-moss/5 p-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-moss/15 text-moss">
        <Check size={18} aria-hidden />
      </span>
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-ink">{t("onTitle")}</p>
        <p className={`text-steel ${SETUP_PROSE}`}>{t("onBody")}</p>
      </div>
    </div>
  );
}

/** The question itself, in whichever of its two forms this machine poses. */
function ConsentChoice({ ctrl, brain }: { ctrl: OnboardingCtrl; brain: CompanionBrainStatus }) {
  const t = useTranslations("setup.companion");
  const chosen = ctrl.state.companionChoice;
  const present = brain.present;
  const capped = brain.episodes >= EPISODE_PROBE_CAP;
  const adopt = present ? "connect" : "birth";

  return (
    <div className="space-y-4">
      <div>
        <p className="text-body font-semibold text-ink">{t(present ? "foundTitle" : "absentTitle")}</p>
        <p className={`mt-1 text-body text-steel ${SETUP_PROSE}`}>
          {present
            ? capped
              ? t("foundBodyMany")
              : t("foundBody", { count: brain.episodes })
            : t("absentBody")}
        </p>
        {/* Whose mind it is, when there is one. A brain Personas' Athena wrote is
            somebody else's self on the same disk, and "share" is the honest verb
            for what connecting to it does — nothing here rewrites it. */}
        {present ? (
          <p className={`mt-1 text-sm text-steel ${SETUP_PROSE}`}>
            {t(brain.constitutionOrigin === "kp" ? "originKp" : "originPersonas")}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <ChoiceTile
          label={t(present ? "connect" : "create")}
          selected={chosen === adopt}
          onSelect={() => ctrl.update({ companionChoice: chosen === adopt ? null : adopt })}
        />
        <ChoiceTile
          label={t("skip")}
          selected={chosen === null}
          onSelect={() => ctrl.update({ companionChoice: null })}
        />
      </div>

      {/* What the choice means, in the future tense it actually has: nothing is
          written until the wizard finishes, and saying otherwise here would be
          the same "Preview wrote for real" lie the axis step already fixed. */}
      <p aria-live="polite" className={`text-sm text-steel ${SETUP_PROSE}`}>
        {chosen === null ? t("chosenSkip") : t(chosen === "connect" ? "chosenConnect" : "chosenBirth")}
      </p>
    </div>
  );
}

/** One answer. `CHIP_TOGGLE` unmodified — including its padding, which is the
 *  recipe's and not the call site's: `px-4` layered over its `px-3` would be two
 *  same-specificity utilities racing on stylesheet order rather than a size
 *  choice. `aria-pressed` rather than a radiogroup because there are two of them
 *  and they are not a form field, and the workspace's own filter pills are the
 *  same semantic. The step's primary action is still the footer's Continue. */
function ChoiceTile({ label, selected, onSelect }: { label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect} className={CHIP_TOGGLE(selected)}>
      {selected ? <Check size={14} aria-hidden /> : null}
      {label}
    </button>
  );
}
