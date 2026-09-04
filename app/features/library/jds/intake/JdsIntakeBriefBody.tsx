"use client";

import { useTranslations } from "next-intl";
import { labelize } from "@/app/_lib/format";
import { labelOr } from "@/app/_lib/use-enum-label";
import { JdsIntakeBriefTitle } from "./JdsIntakeBriefTitle";
import { prepareFacets, sortByWeight, type BriefRequirement } from "./jdsIntakeBriefModel";
import {
  ConfidenceNote,
  ProvenanceDot,
  ProvenanceLegend,
  RationaleDisclosure,
  TurnRef,
  type BriefBodyProps,
} from "./JdsIntakeBriefAtoms";

// The live brief's body — "Annotated", the direction that won the /prototype
// round against the shipped flat sections and against a ranked "Scorecard".
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
//    (jdsIntakeBriefModel.ts); a `context`-graded line drops to steel, because
//    background should stay background.

const HEADING = "flex items-center gap-2 text-meta uppercase text-steel";

function Heading({ hue, label, count }: { hue: string; label: string; count?: number }) {
  return (
    <div className={HEADING}>
      <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${hue}`} aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
      {typeof count === "number" ? <span className="text-stone-400 nums">{count}</span> : null}
    </div>
  );
}

/** One annotated line: the sentence, then the margin. `evidence` is whatever
 *  the line can defend itself with — always in the same lane, always in the
 *  same order. */
function MarginRow({ children, evidence }: { children: React.ReactNode; evidence: React.ReactNode }) {
  return (
    <li className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 gap-2">
        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-stone-400" aria-hidden />
        <div className="min-w-0">{children}</div>
      </div>
      <span className="flex shrink-0 items-start gap-1.5 pt-0.5">{evidence}</span>
    </li>
  );
}

function RequirementLine({ r, onJump, learnableLabel }: { r: BriefRequirement; onJump?: (turn: number) => void; learnableLabel: string | null }) {
  return (
    <MarginRow
      evidence={
        <>
          <ProvenanceDot provenance={r.provenance} />
          <TurnRef turn={r.sourceTurn} onJump={onJump} />
        </>
      }
    >
      <span className="text-body text-ink">{r.skill}</span>
      {learnableLabel ? <span className="ml-1.5 text-meta text-amber-800">{learnableLabel}</span> : null}
      {/* Weight · confidence · rationale on demand — the defence for a line, not
          part of the scan (the flat sections carried the same three facts in the
          same disclosure). */}
      <RationaleDisclosure r={r} />
    </MarginRow>
  );
}

export function JdsIntakeBriefBody({ brief, musts, nices, frozen, saving, onSaveBrief, onJumpToTurn }: BriefBodyProps) {
  const t = useTranslations("library.tab.intake.brief");
  const tGroups = useTranslations("library.tab.intake.brief.groups");
  const outcomes = brief?.successCriteria ?? [];
  const languages = brief?.languages ?? [];
  const groups = prepareFacets(brief ?? null);

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

      {outcomes.length > 0 ? (
        <div>
          <Heading hue="bg-moss" label={t("outcomes")} count={outcomes.length} />
          <ul className="mt-2 space-y-2">
            {outcomes.map((s, i) => (
              <MarginRow key={i} evidence={null}>
                <span className="text-body text-ink">{s}</span>
              </MarginRow>
            ))}
          </ul>
        </div>
      ) : null}

      {musts.length > 0 ? (
        <div>
          <Heading hue="bg-coral" label={t("dealbreakers")} count={musts.length} />
          <ul className="mt-2 space-y-2">
            {sortByWeight(musts).map((r, i) => (
              <RequirementLine key={i} r={r} onJump={onJumpToTurn} learnableLabel={r.hardness === "learnable" ? t("learnable") : null} />
            ))}
          </ul>
        </div>
      ) : null}

      {nices.length > 0 ? (
        <div>
          <Heading hue="bg-steel" label={t("niceToHave")} count={nices.length} />
          <ul className="mt-2 space-y-2">
            {sortByWeight(nices).map((r, i) => (
              <RequirementLine key={i} r={r} onJump={onJumpToTurn} learnableLabel={null} />
            ))}
          </ul>
        </div>
      ) : null}

      {groups.map((group) => (
        <div key={group.key}>
          <Heading hue="bg-stone-300" label={labelOr(tGroups, group.key, labelize(group.key))} count={group.items.length} />
          <ul className="mt-2 space-y-2">
            {group.items.map((f, i) => (
              <MarginRow
                key={i}
                evidence={
                  <>
                    <ProvenanceDot provenance={f.provenance} />
                    {/* An uncertain reading says so in the margin (UAT drain §2.2);
                        confidence 1 renders nothing, so the number that survives
                        is the one carrying information. */}
                    <ConfidenceNote confidence={f.confidence} />
                    <TurnRef turn={f.sourceTurn} onJump={onJumpToTurn} />
                  </>
                }
              >
                <p className={`text-body ${f.importance === "context" ? "text-steel" : "text-ink"}`}>
                  <span className="text-meta text-steel">{f.label || f.key}</span>
                  <br />
                  {f.displayValue}
                </p>
              </MarginRow>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
