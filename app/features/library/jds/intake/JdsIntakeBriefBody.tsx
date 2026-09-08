"use client";

import { useTranslations } from "next-intl";
import { labelize } from "@/app/_lib/format";
import { labelOr } from "@/app/_lib/use-enum-label";
import { META_LABEL } from "@/app/_components/ui/recipes";
import type { RoleBrief } from "@/app/_lib/rolespec";
import { JdsIntakeBriefTitle } from "./JdsIntakeBriefTitle";
import { ConfidenceNote, ProvenanceDot, ProvenanceLegend, RationaleDisclosure, TurnRef } from "./JdsIntakeBriefAtoms";
import { TypedText, type BriefReveal } from "./BriefRevealAtoms";
import { ArrivalList, type ArrivalDelta } from "./IntakeArrivalMotion";
import type { BriefLine, BriefSection } from "./briefSections";

// The live brief's body — "Annotated", the direction that won the /prototype
// round against the shipped flat sections and a ranked "Scorecard", and won
// again against "Notepad" and "Cards" in a second round.
//
// Metaphor: a brief someone has marked up. The panel keeps ONE reading column of
// plain bulleted sentences; every piece of evidence about a line — where it came
// from, how sure the engine is, which turn said it — is pushed into a narrow
// right-hand MARGIN that runs the full height of the panel. The eye reads
// content down the left and only glances sideways when it doubts a line.
//
//  · COLOUR IS THE SECTION, not the row: a hue block by each heading
//    (moss = the outcomes they committed to, coral = the hard lines, steel =
//    the flexible ones, stone = context), following the app's own contract
//    (docs/design/README.md: coral = act, moss = good, amber = maybe, steel =
//    commentary). The prose itself is never tinted.
//  · The provenance vocabulary is stated ONCE as a legend, then carried as a
//    6px dot in the margin — which is what removes the "you said" / "assumed"
//    chip repeated on every line (14 times in a live App-master brief).
//  · BULLETS, not chip rows — the sentences read as sentences.
//  · Context facets are grouped, de-duplicated and graded by the shared model
//    (jdsIntakeBriefModel.ts, via briefSections.ts); a `context`-graded line
//    drops to steel, because background should stay background.
//  · A line REVEALS according to its history (briefReveal.ts): one that landed
//    while the requestor was talking types itself out, one that was already on
//    the page fades in once, one that merely survived a re-extraction does not
//    animate at all. The panel owns that classification — see
//    JdsIntakeBriefPanel — so the body only asks each line how it should enter.
//
// The section walk itself lives in briefSections.ts, because a reveal needs a
// stable identity per line and identity is not a rendering concern.

const HEADING = `flex items-center gap-2 ${META_LABEL}`;

function Heading({ hue, label, count }: { hue: string; label: string; count?: number }) {
  return (
    <div className={HEADING}>
      <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${hue}`} aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
      {typeof count === "number" ? <span className="text-stone-400 nums">{count}</span> : null}
    </div>
  );
}

/** One annotated line: the sentence, then the margin. The margin is whatever
 *  the line can defend itself with — always in the same lane, always in the
 *  same order.
 *
 *  It renders the row's CONTENT, not its `<li>`: the list item belongs to
 *  `ArrivalList`, which is what knows whether this row just landed. */
function AnnotatedLine({
  line,
  mode,
  onJump,
  learnableLabel,
}: {
  line: BriefLine;
  mode: BriefReveal["mode"];
  onJump?: (turn: number) => void;
  learnableLabel: string | null;
}) {
  return (
    <>
      <div className="flex min-w-0 flex-1 gap-2">
        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-stone-400" aria-hidden />
        <div className="min-w-0">
          {line.label ? <span className="text-meta text-steel">{line.label}<br /></span> : null}
          <TypedText text={line.text} mode={mode(line.key)} className={`text-body ${line.muted ? "text-steel" : "text-ink"}`} />
          {learnableLabel ? <span className="ml-1.5 text-meta text-amber-800">{learnableLabel}</span> : null}
          {/* Weight · confidence · rationale on demand — the defence for a line,
              not part of the scan. */}
          {line.requirement ? <RationaleDisclosure r={line.requirement} /> : null}
        </div>
      </div>
      <span className="flex shrink-0 items-start gap-1.5 pt-0.5">
        <ProvenanceDot provenance={line.provenance} />
        {/* An uncertain reading says so in the margin (UAT drain §2.2);
            confidence 1 renders nothing, so the number that survives is the one
            carrying information. */}
        <ConfidenceNote confidence={line.confidence} />
        <TurnRef turn={line.sourceTurn} onJump={onJump} />
      </span>
    </>
  );
}

export function JdsIntakeBriefBody({
  brief,
  sections,
  mode,
  delta,
  frozen,
  saving,
  onSaveBrief,
  onJumpToTurn,
}: {
  brief: RoleBrief | null;
  /** Built once by the panel, which also owns the reveal classification over
   *  the same line keys — two walks would be two identities. */
  sections: BriefSection[];
  mode: BriefReveal["mode"];
  /** Which rows the last turn added or rewrote (`IntakeArrivalMotion`). The rows
   *  MOVE on that; the words inside them are still the reveal's job. */
  delta: ArrivalDelta;
  frozen?: boolean;
  saving?: boolean;
  onSaveBrief?: (edited: RoleBrief) => void | Promise<boolean>;
  onJumpToTurn?: (turn: number) => void;
}) {
  const t = useTranslations("library.tab.intake.brief");
  const tGroups = useTranslations("library.tab.intake.brief.groups");
  const languages = brief?.languages ?? [];

  const heading = (section: BriefSection): string => {
    if (section.kind === "outcomes") return t("outcomes");
    if (section.kind === "musts") return t("dealbreakers");
    if (section.kind === "nices") return t("niceToHave");
    const key = section.groupKey ?? "general";
    return labelOr(tGroups, key, labelize(key));
  };

  return (
    <div className="space-y-5">
      <ProvenanceLegend />

      <div>
        <Heading hue="bg-ink" label={t("role")} />
        <div className="mt-2">
          <JdsIntakeBriefTitle brief={brief} frozen={frozen} saving={saving} onSaveBrief={onSaveBrief} />
          {languages.length > 0 ? <p className="mt-1 text-meta text-steel">{languages.join(" · ")}</p> : null}
        </div>
      </div>

      {sections.map((section) => (
        <div key={section.key}>
          <Heading hue={section.hue} label={heading(section)} count={section.lines.length} />
          <ul className="mt-2 space-y-2">
            <ArrivalList
              items={section.lines}
              keyOf={(line) => line.key}
              idOf={(line) => line.arrivalId}
              sourceTurnOf={(line) => line.sourceTurn}
              delta={delta}
              onJumpToTurn={onJumpToTurn}
              itemClassName="flex items-start justify-between gap-3"
              renderItem={(line) => (
                <AnnotatedLine
                  line={line}
                  mode={mode}
                  onJump={onJumpToTurn}
                  learnableLabel={section.kind === "musts" && line.learnable ? t("learnable") : null}
                />
              )}
            />
          </ul>
        </div>
      ))}
    </div>
  );
}
