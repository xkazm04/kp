"use client";

import { useTranslations } from "next-intl";
import type { RoleBrief } from "@/app/_lib/rolespec";
import { provenanceTone, type BriefRequirement, type ProvenanceTone } from "./jdsIntakeBriefModel";

// The leaf pieces the live-brief body draws with, split from
// JdsIntakeBriefBody.tsx so both stay under the 200-line cap.
//
// The colour contract is the app's own (docs/design/README.md: "coral = act,
// moss = good, amber = maybe, steel = commentary") applied to the one axis this
// panel is about — how much of the brief is the requestor's own words:
//   stated  → moss   (they said it)
//   inferred→ amber  (the agent read it; maybe)
//   default → steel  (template fill; commentary)
// The vocabulary is stated ONCE by the legend and then carried as a 6px dot,
// which is what lets a line report its provenance without a word of chrome.

export type BriefBodyProps = {
  brief: RoleBrief | null;
  musts: BriefRequirement[];
  nices: BriefRequirement[];
  frozen?: boolean;
  saving?: boolean;
  onSaveBrief?: (edited: RoleBrief) => void | Promise<boolean>;
  onJumpToTurn?: (turn: number) => void;
};

export const PROVENANCE_DOT: Record<ProvenanceTone, string> = {
  stated: "bg-moss",
  inferred: "bg-dial-amber",
  default: "bg-steel",
};

/** The whole provenance vocabulary, once, above the brief — so no line below
 *  has to repeat "you said" / "assumed" in words. */
export function ProvenanceLegend() {
  const t = useTranslations("library.tab.intake.provenance");
  const tones: ProvenanceTone[] = ["stated", "inferred", "default"];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {tones.map((tone) => (
        <span key={tone} className="inline-flex items-center gap-1.5 text-meta text-steel">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PROVENANCE_DOT[tone]}`} aria-hidden />
          {t(tone)}
        </span>
      ))}
    </div>
  );
}

/** One value's reading, as a dot. The accessible name stays a full word — the
 *  colour is the shorthand for sighted readers, never the only carrier. */
export function ProvenanceDot({ provenance }: { provenance?: string | null }) {
  const t = useTranslations("library.tab.intake.provenance");
  const tone = provenanceTone(provenance);
  return (
    <span
      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${PROVENANCE_DOT[tone]}`}
      title={t(tone)}
      role="img"
      aria-label={t(tone)}
    />
  );
}

/** Confidence, only when the reading is uncertain — a full-confidence number on
 *  every line is noise that buries the one that carries information
 *  (UAT drain §2.2; see docs/features/intake/README.md). */
export function ConfidenceNote({ confidence }: { confidence?: number | null }) {
  const t = useTranslations("library.tab.intake.defense");
  if (confidence == null || confidence >= 1) return null;
  return (
    <span className="text-meta text-steel nums" title={t("confidence")}>
      {Math.round(confidence * 100)}%
    </span>
  );
}

/** The transcript back-reference: click and the conversation scrolls to that
 *  bubble and flashes it. Bracketed number, footnote-shaped, so it reads as a
 *  citation rather than as another tag. */
export function TurnRef({ turn, onJump }: { turn?: number | null; onJump?: (turn: number) => void }) {
  const t = useTranslations("library.tab.intake.defense");
  if (turn == null) return null;
  const label = `${t("fromTurn")} ${turn}`;
  return (
    <button
      type="button"
      className="focus-ring shrink-0 rounded text-meta text-steel underline decoration-dotted underline-offset-2 transition-colors hover:text-coral nums"
      onClick={onJump ? () => onJump(turn) : undefined}
      title={label}
      aria-label={label}
    >
      <span aria-hidden>[{turn}]</span>
    </button>
  );
}

/** A requirement's defence, revealed on demand: the same weight · confidence ·
 *  rationale triple the flat sections carried, kept out of the scan. */
export function RationaleDisclosure({ r }: { r: BriefRequirement }) {
  const t = useTranslations("library.tab.intake.defense");
  return (
    <details className="group/why mt-0.5">
      <summary className="focus-ring inline-flex cursor-pointer list-none items-center gap-1 text-meta text-steel transition-colors hover:text-ink">
        {t("details")}
      </summary>
      <p className="mt-1 text-meta leading-5 text-steel">
        {`${t("weight")} ${Math.round((r.weight ?? 0) * 100)}% · ${t("confidence")} ${Math.round((r.confidence ?? 0) * 100)}% — ${
          r.rationale || t("rationaleNone")
        }`}
      </p>
    </details>
  );
}
