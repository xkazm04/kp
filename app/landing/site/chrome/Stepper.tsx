"use client";

import { useTranslations } from "next-intl";
import { GLYPH } from "./glyphs";

/*
 * The bottom stepper both pages share: previous button, one dot per step, next
 * button. Presentational and controlled: the page owns which step is current
 * and what moving means; this renders it.
 *
 *   variant "page"  -> `.stepper`, fixed to the viewport's bottom edge (About's
 *                      eight steps; `count` is the phone line that replaces the
 *                      dots below 1100px, e.g. "Step 04 of 08 · Screen").
 *   variant "scene" -> `.sc-nav`, positioned inside its overlay (the landing's
 *                      nine-feature scene).
 *
 * Every visible string comes in through props, already translated by the page;
 * only the "Previous" / "Next" fallbacks are the chrome's own. `prevLabel` /
 * `nextLabel` are the neighbouring step names shown beside the arrows (hidden on
 * phones); when given, the buttons are named "Previous: <name>" / "Next: <name>".
 * A step's `label` is its dot's accessible name; `signed` gives the dot its amber
 * ring (About's human gates).
 */
export type StepperStep = { label: string; signed?: boolean };

export type StepperProps = {
  variant?: "page" | "scene";
  /** Name of the whole control, e.g. "The eight steps". */
  ariaLabel: string;
  /** Name of the dot list, e.g. "All eight steps". */
  dotsLabel: string;
  steps: readonly StepperStep[];
  /** Index of the current step; any index outside `steps` marks none (About's overview and ending). */
  active: number;
  onSelect: (index: number) => void;
  onPrev: () => void;
  onNext: () => void;
  prevLabel?: string;
  nextLabel?: string;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  /** Phone-only position line (variant "page"). */
  count?: string;
  id?: string;
};

export default function Stepper({
  variant = "page",
  ariaLabel,
  dotsLabel,
  steps,
  active,
  onSelect,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
  prevDisabled = false,
  nextDisabled = false,
  count,
  id
}: StepperProps) {
  const t = useTranslations("siteChrome");
  return (
    <nav className={variant === "page" ? "stepper" : "sc-nav"} aria-label={ariaLabel} id={id}>
      <button
        className="btn btn-sm"
        type="button"
        onClick={onPrev}
        disabled={prevDisabled}
        aria-label={prevLabel ? t("stepper.previousTo", { name: prevLabel }) : undefined}
      >
        <span aria-hidden="true">{GLYPH.prev}</span> <span className="st-lbl">{prevLabel ?? t("stepper.previous")}</span>
      </button>
      <ol className="sc-dots" aria-label={dotsLabel}>
        {steps.map((step, i) => (
          <li key={i}>
            <button
              type="button"
              className={step.signed ? "sd is-signed" : "sd"}
              aria-label={step.label}
              aria-current={i === active ? "true" : "false"}
              onClick={() => onSelect(i)}
            />
          </li>
        ))}
      </ol>
      {variant === "page" && count !== undefined ? (
        <p className="stepper-count" aria-hidden="true">
          {count}
        </p>
      ) : null}
      <button
        className="btn btn-sm"
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        aria-label={nextLabel ? t("stepper.nextTo", { name: nextLabel }) : undefined}
      >
        <span className="st-lbl">{nextLabel ?? t("stepper.next")}</span> <span aria-hidden="true">{GLYPH.next}</span>
      </button>
    </nav>
  );
}
