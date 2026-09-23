"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { BTN_PRIMARY, BTN_SECONDARY, CHIP_TOGGLE, FIELD, META_LABEL } from "@/app/_components/ui/recipes";
import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from "@/i18n/locales";

// OPENING A ROLE — the two questions a go-live now asks before it spends anything.
//
// Publishing used to be one click with no terms: the role went live and stayed live
// until somebody remembered to close it. It now opens FOR something — a number of
// hires, and the languages it is advertised in — and both are decisions a recruiter
// takes once per role and then lives with, so they belong in front of the button
// rather than in a settings panel nobody visits.
//
// Same confirm-over-detail shape as the close confirmation in JobsPostingModal: a
// themed stacked Modal (the Modal stack handles Escape/Tab per-dialog), never
// `window.confirm`, which the design tokens cannot reach.
//
// ONE dialog for BOTH publish surfaces — the posting modal's footer and the Drafts
// panel's row button — because they are the same act through the same route. Two
// copies would be two defaults, and the first divergence would be invisible.

export type PublishTerms = { targetHires: number; langs: Locale[] };

/** The ceiling the route enforces (JOB_TARGET_HIRES_INVALID). Restated here so the
 *  field cannot offer a number the door will refuse — the door stays the authority. */
export const MAX_TARGET_HIRES = 50;

export function JobsPublishDialog({
  reopen = false,
  onCancel,
  onConfirm,
}: {
  /** A CLOSED role going live again. Same terms, different verb — and the copy says
   *  "reopen" rather than "open", because restating a target on a role that already
   *  ran is a different decision from setting one for the first time. */
  reopen?: boolean;
  onCancel: () => void;
  onConfirm: (terms: PublishTerms) => void;
}) {
  const t = useTranslations("jobs.publishDialog");
  const rawLocale = useLocale();
  const appLocale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  // Lazy initializers: `useLocale()` is already resolved, but the array and the
  // string are rebuilt on every render otherwise, and the React Compiler reads a
  // bare `useState([appLocale])` as a fresh value per render.
  const [target, setTarget] = useState(() => "1");
  // The app's own language is the default and the one language that is never a
  // TRANSLATION — it is the posting itself. Pre-selected rather than merely
  // implied, so the chip row shows the recruiter the full set they are choosing
  // from instead of hiding the one that is always there.
  const [langs, setLangs] = useState<Locale[]>(() => [appLocale]);

  const parsed = Number(target);
  const targetValid = Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_TARGET_HIRES;
  const toggleLang = (loc: Locale) =>
    setLangs((prev) => (prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]));

  return (
    <Modal
      title={reopen ? t("titleReopen") : t("title")}
      onClose={onCancel}
      size="md"
      footer={
        <>
          <button type="button" onClick={onCancel} className={`${BTN_SECONDARY} h-9 px-4 text-sm`}>
            {t("cancel")}
          </button>
          <button
            type="button"
            // The language set is deliberately NOT required: a role advertised in no
            // stated language is the behaviour every publish had before this dialog,
            // and refusing it would break the one-click go-live for no gain.
            disabled={!targetValid}
            // The guided demo clicks this confirm (simMove.ts SIM_MOVES.publish): the
            // walk must go through the same terms dialog a recruiter does.
            data-sim-click="publish-confirm"
            onClick={() => onConfirm({ targetHires: parsed, langs })}
            className={`${BTN_PRIMARY} h-9 px-4 text-sm`}
          >
            {reopen ? t("confirmReopen") : t("confirm")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="role-target-hires" className={META_LABEL}>
            {t("targetLabel")}
          </label>
          <input
            id="role-target-hires"
            type="number"
            min={1}
            max={MAX_TARGET_HIRES}
            step={1}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-invalid={!targetValid}
            aria-describedby="role-target-hires-help"
            className={`${FIELD} mt-1 w-28 nums`}
          />
          <p id="role-target-hires-help" className={targetValid ? "mt-1 text-sm text-steel" : "mt-1 text-sm text-coral"}>
            {targetValid ? t("targetHelp") : t("targetInvalid", { max: MAX_TARGET_HIRES })}
          </p>
        </div>

        <div>
          <span className={META_LABEL}>{t("langsLabel")}</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {LOCALES.map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => toggleLang(loc)}
                aria-pressed={langs.includes(loc)}
                className={`${CHIP_TOGGLE(langs.includes(loc))} cursor-pointer px-2.5 py-0.5 uppercase`}
              >
                {loc}
              </button>
            ))}
          </div>
          {/* The honest claim, and the reason this line exists: the languages beyond
              the posting's own are generated by a model AFTER the role goes live, in
              parallel, and a deployment with no model configured gets none of them.
              Promising a translation the install cannot produce would be the green
              lie this app's comms layer is built to avoid. */}
          <p className="mt-1 text-sm text-steel">{t("langsHelp")}</p>
        </div>
      </div>
    </Modal>
  );
}
