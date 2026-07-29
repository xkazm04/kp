"use client";

// Variant B — "the record that hasn't been opened".
//
// Metaphor: a run is not a to-do list, it is a RECORD the company keeps about a
// hand-off — who was hired, what they told you before day one, what they signed,
// and what was actually completed. So the empty state draws that record as a
// blank dossier: the real run card (name slot, 0% meter, questionnaire chip) over
// the three ledgers a run maintains, each showing what it will hold and how many
// entries it starts with. Nothing is promised that the record cannot evidence —
// the signature ledger states plainly that the in-app seam is audit-stamped, not
// eIDAS-binding.
//
// Differs from Variant A by looking BACKWARD from the finished record (what will
// be provable about this hire) rather than forward at the new joiner's first day.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildTabSwitchUrl, type WorkspaceTabId } from "@/app/features/shell/tabs";
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { ONBOARDING_RUN_GLYPH } from "@/app/_components/glyph/glyphs/onboardingRunGlyph";
import { CARD_PAD, EYEBROW, META_LABEL, PANEL, PANEL_SUNKEN, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { OnboardingRecordPanel } from "./OnboardingRecordPanel";
import type { PlanTemplate, WaitingHire } from "./OnboardingEmptyFirstDay";

// Where a hire comes from — the two upstream steps that end in stage Hired.
const UPSTREAM: { tab: WorkspaceTabId; label: string }[] = [
  { tab: "pipeline", label: "Move a candidate to Hired" },
  { tab: "decisions", label: "Close an open decision" },
];

export function OnboardingEmptyRecord({
  hired,
  templates,
  templateId,
  onTemplateChange,
  onStart,
}: {
  hired: WaitingHire[];
  templates: PlanTemplate[];
  templateId: string;
  onTemplateChange: (id: string) => void;
  onStart: (entryId: string) => void;
}) {
  const t = useTranslations("onboarding");
  const search = useSearchParams();
  const searchStr = search.toString();
  const active = templates.find((tpl) => tpl.id === templateId) ?? templates[0];
  const taskCount = active?.tasks.length ?? 0;
  const questionCount = active?.questionnaire.length ?? 0;
  const first = hired[0];
  const starved = !first;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
        <MotionizedGlyph
          data={ONBOARDING_RUN_GLYPH.data}
          viewBox={ONBOARDING_RUN_GLYPH.viewBox}
          className="h-24 w-24 shrink-0 sm:h-28 sm:w-28"
        />
        <div>
          <p className={EYEBROW}>Record</p>
          <h3 className={`mt-1 ${TITLE_DISPLAY}`}>No hand-off on file</h3>
          <p className="mt-2 max-w-xl text-body text-steel">
            {starved
              ? "A run is the record of one hand-off — opened when a candidate reaches Hired, closed when the last task is ticked. No candidate has reached Hired, so there is nothing on file to open."
              : "A run is the record of one hand-off — opened when a candidate reaches Hired, closed when the last task is ticked. Here is the record you are about to open."}
          </p>
        </div>
      </div>

      {/* The blank record. Named when a hire is waiting; a dashed slot when not —
          the slot is never paired with a start action it cannot honour. */}
      <OnboardingRecordPanel
        first={first}
        starved={starved}
        taskCount={taskCount}
        questionCount={questionCount}
        templates={templates}
        templateId={templateId}
        onTemplateChange={onTemplateChange}
        active={active}
        onStart={onStart}
      />

      {/* Starved: the record has no subject, so the only honest affordance is the
          upstream step that produces one. Otherwise: the rest of the queue. */}
      {starved ? (
        <section className={`${PANEL_SUNKEN} ${CARD_PAD}`}>
          <p className={META_LABEL}>A record opens when</p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {UPSTREAM.map((u) => (
              <Link
                key={u.tab}
                href={buildTabSwitchUrl(u.tab, searchStr)}
                className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-coral hover:underline"
              >
                {u.label} <ArrowRight size={13} aria-hidden />
              </Link>
            ))}
          </div>
        </section>
      ) : hired.length > 1 ? (
        <section className={`${PANEL} ${CARD_PAD}`}>
          <p className={META_LABEL}>Also waiting</p>
          <ul className="mt-2 divide-y divide-stone-200" role="list">
            {hired.slice(1).map((h) => (
              <li key={h.entryId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-base font-semibold text-ink">{h.candidateLabel ?? t("aCandidate")}</p>
                  {h.jobTitle ? <p className="text-meta text-steel">{h.jobTitle}</p> : null}
                </div>
                <button type="button" onClick={() => onStart(h.entryId)} className="focus-ring text-sm font-semibold text-coral hover:underline">
                  {t("startCta")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
