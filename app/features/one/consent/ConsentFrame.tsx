"use client";

// The consent card's one frame (round 3 shape): title (act + who), ONE consequence line, a
// quiet tag that says whether it can be undone here, the buttons — and everything else behind
// a "Details" disclosure, so the card reads in one glance. Every act's card draws through it
// (ConsentCard.tsx for the pipeline acts, ToolConsent.tsx for the letter and interview acts).
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CHIP_QUIET, PANEL_ACCENT } from "@/app/_components/ui/recipes";
import type { ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { WavePreview } from "./doors";

export type Phase =
  | { at: "idle" }
  | { at: "busy" }
  | { at: "previewed"; preview: WavePreview }
  | { at: "done"; lines: string[]; undo: (() => Promise<void>) | null }
  | { at: "undone"; lines: string[] }
  | { at: "stale" }
  | { at: "failed"; payload: ApiErrorPayload | null };

export const isSettled = (p: Phase): boolean => p.at === "done" || p.at === "undone" || p.at === "stale" || p.at === "failed";

export function ConsentFrame({
  act,
  proposalId,
  phase,
  className,
  title,
  line,
  footer,
  tag,
  details,
}: {
  act: string;
  proposalId: string;
  phase: Phase["at"];
  className?: string;
  title: string;
  line: ReactNode;
  footer: ReactNode;
  tag?: "final" | "undo";
  details?: ReactNode;
}) {
  const t = useTranslations("one.core.consent");
  return (
    <section
      className={`${PANEL_ACCENT} flex min-w-0 flex-col gap-2 p-[var(--one-pad)] ${className ?? ""}`}
      data-one-consent={act}
      data-proposal-id={proposalId}
      data-phase={phase}
      data-one-surface
      aria-label={t("heading")}
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="min-w-0 font-[family-name:var(--one-title-font)] text-h3 font-semibold text-ink">{title}</h3>
        {tag ? (
          <span className={`${CHIP_QUIET} shrink-0`} data-role="one-consent-tag">
            {tag === "final" ? t("finalTag") : t("undoTag")}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 text-micro text-ink">{line}</div>
      <div className="flex flex-wrap items-center gap-2 [&_.k-btn]:h-8 [&_.k-btn]:px-3">
        {footer}
        {details ? (
          // Everything past the one line lives here; open, it takes the row under the buttons.
          <details className="group ml-auto text-micro text-steel open:ml-0 open:basis-full" data-role="one-consent-details">
            <summary className="focus-ring ml-auto w-fit cursor-pointer list-none rounded-sm font-semibold text-steel group-open:ml-0 hover:text-ink [&::-webkit-details-marker]:hidden">
              <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
                ›
              </span>{" "}
              {t("details")}
            </summary>
            <div className="mt-1 flex flex-col gap-1 pl-3">{details}</div>
          </details>
        ) : null}
      </div>
    </section>
  );
}

/** The result lines after a press (role=status, so a screen reader hears the outcome). */
export function ResultLines({ lines }: { lines: string[] }) {
  return (
    <div className="flex flex-col gap-1" role="status" data-role="one-consent-result">
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}
