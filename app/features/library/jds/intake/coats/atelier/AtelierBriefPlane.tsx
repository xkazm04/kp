"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Lock, Pencil } from "lucide-react";
import { labelize } from "@/app/_lib/format";
import { labelOr } from "@/app/_lib/use-enum-label";
import { META_LABEL } from "@/app/_components/ui/recipes";
import type { RoleBrief } from "@/app/_lib/rolespec";
import { JdsIntakeBriefEdit } from "../../JdsIntakeBriefEdit";
import { JdsIntakeBriefTitle } from "../../JdsIntakeBriefTitle";
import { ConfidenceNote, ProvenanceDot, ProvenanceLegend, RationaleDisclosure, TurnRef } from "../../JdsIntakeBriefAtoms";
import { TypedText, useBriefReveal } from "../../BriefRevealAtoms";
import { ArrivalList, useArrivalDelta } from "../../IntakeArrivalMotion";
import { buildBriefSections, sectionLineKeys, type BriefSection } from "../../briefSections";
import { IconAction } from "../IconAction";
import { AtelierGhost } from "./atelierPlane";

// ATELIER — the brief as a LEDGER OF RECORD ROWS, not a bulleted list inside a
// sunken card.
//
// Every row has the same three lanes and they never move: a provenance dot in a
// fixed left gutter, the value in the reading column, the evidence trailing
// right. That is the whole difference from the classic body — there the bullet,
// the sentence and the margin were inline spans that re-flowed per row, so the
// eye had to re-find the lane on every line. Here the gutter is a column you can
// scan straight down: four moss dots in a row IS "they told us this".
//
// The bracketed CITATION is an affordance, not ink. It appears on hover or on
// keyboard focus inside the row and is otherwise absent, because a footnote
// number printed permanently beside fourteen sentences is fourteen pieces of
// chrome competing with the sentence they annotate. Confidence stays visible: an
// uncertain reading is information, and information does not hide.
//
// ARRIVAL is drawn in the gutter only. The row still enters on the shared
// stagger (ArrivalList, 40 ms, capped at 12) and the words still type themselves
// (TypedText) — Atelier adds one sweep on the DOT, so a row that just landed
// says so without any geometry moving.

function Heading({ hue, label, count }: { hue: string; label: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-stone-200 pb-1">
      <span className={`h-2 w-2 shrink-0 translate-y-px rounded-sm ${hue}`} aria-hidden />
      <span className={`${META_LABEL} min-w-0 truncate`}>{label}</span>
      <span className="ml-auto shrink-0 text-sm text-stone-400 nums">{count}</span>
    </div>
  );
}

export function AtelierBriefPlane({
  brief,
  intakeId,
  updatedAt,
  frozen,
  saving,
  onSaveBrief,
  onJumpToTurn,
  appMasterSlot,
}: {
  brief: RoleBrief | null;
  intakeId: string;
  updatedAt: string | null;
  frozen?: boolean;
  saving?: boolean;
  onSaveBrief?: (edited: RoleBrief) => void | Promise<boolean>;
  onJumpToTurn?: (turn: number) => void;
  appMasterSlot?: React.ReactNode;
}) {
  const t = useTranslations("library.tab.intake.brief");
  const tGroups = useTranslations("library.tab.intake.brief.groups");
  const tEdit = useTranslations("library.tab.intake.edit");
  const tGlyph = useTranslations("library.tab.intake.glyph");
  const [editing, setEditing] = useState(false);
  const sections = buildBriefSections(brief);
  // Owned here, exactly as the classic panel owns it: both classifiers must keep
  // running while the edit form is open, or closing the form would read as the
  // whole brief arriving at once.
  const reveal = useBriefReveal(sectionLineKeys(sections));
  const delta = useArrivalDelta(brief);
  const empty = !brief || (!brief.title && sections.length === 0);
  const languages = brief?.languages ?? [];

  const heading = (section: BriefSection): string => {
    if (section.kind === "outcomes") return t("outcomes");
    if (section.kind === "musts") return t("dealbreakers");
    if (section.kind === "nices") return t("niceToHave");
    const key = section.groupKey ?? "general";
    return labelOr(tGroups, key, labelize(key));
  };

  return (
    <div className="space-y-5 pb-2">
      {/* The zone controls, as glyphs on the plane. A frozen brief is a LOCK
          whose reason is in its tooltip — the classic coat spent a paragraph of
          the panel saying the same thing. */}
      <div className="flex items-center justify-end gap-1">
        {reveal.writing ? (
          <span className="inline-flex items-center gap-1 text-coral" role="status" aria-label={t("writing")}>
            <Pencil size={13} aria-hidden />
            <span className="sr-only">{t("writing")}</span>
          </span>
        ) : null}
        {frozen ? <IconAction icon={Lock} label={tEdit("frozen")} tone="muted" side="bottom" size={15} /> : null}
        {!empty && !editing && !frozen && onSaveBrief ? (
          <IconAction icon={Pencil} label={tGlyph("edit")} side="bottom" size={15} onClick={() => setEditing(true)} />
        ) : null}
      </div>

      {appMasterSlot}

      {empty ? (
        <AtelierGhost rows={5} />
      ) : editing && brief && onSaveBrief ? (
        <JdsIntakeBriefEdit
          brief={brief}
          intakeId={intakeId}
          updatedAt={updatedAt}
          saving={saving ?? false}
          onSave={async (edited) => {
            const ok = await onSaveBrief(edited);
            if (ok !== false) setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <ProvenanceLegend />
          <div>
            <Heading hue="bg-ink" label={t("role")} count={languages.length} />
            <div className="mt-2 pl-6">
              <JdsIntakeBriefTitle brief={brief} frozen={frozen} saving={saving} onSaveBrief={onSaveBrief} />
              {languages.length > 0 ? <p className="mt-1 text-meta text-steel">{languages.join(" · ")}</p> : null}
            </div>
          </div>

          {sections.map((section) => (
            <div key={section.key}>
              <Heading hue={section.hue} label={heading(section)} count={section.lines.length} />
              <ul className="mt-1">
                <ArrivalList
                  items={section.lines}
                  keyOf={(line) => line.key}
                  idOf={(line) => line.arrivalId}
                  sourceTurnOf={(line) => line.sourceTurn}
                  delta={delta}
                  onJumpToTurn={onJumpToTurn}
                  itemClassName="group/row flex items-start gap-3 py-1.5"
                  renderItem={(line) => (
                    <>
                      <span
                        className={`flex w-3 shrink-0 justify-center ${
                          delta.orderOf(line.arrivalId) >= 0 ? "animate-arrive-in" : ""
                        }`}
                      >
                        <ProvenanceDot provenance={line.provenance} />
                      </span>
                      <span className="min-w-0 flex-1">
                        {line.label ? <span className="mr-1.5 text-meta text-steel">{line.label}</span> : null}
                        <TypedText
                          text={line.text}
                          mode={reveal.mode(line.key)}
                          className={`text-body leading-6 ${line.muted ? "text-steel" : "text-ink"}`}
                        />
                        {section.kind === "musts" && line.learnable ? (
                          <span className="ml-1.5 text-meta text-amber-800">{t("learnable")}</span>
                        ) : null}
                        {line.requirement ? <RationaleDisclosure r={line.requirement} /> : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 pt-1">
                        <ConfidenceNote confidence={line.confidence} />
                        <span className="opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100">
                          <TurnRef turn={line.sourceTurn} onJump={onJumpToTurn} />
                        </span>
                      </span>
                    </>
                  )}
                />
              </ul>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
