"use client";

/**
 * Variant B — "the first candidate, staged".
 *
 * Metaphor: a rehearsal of the real board. Rather than explaining the chain in
 * prose, the empty state *is* the board — the actual STAGES lanes, in order,
 * with a dashed slot waiting in the first lane where candidate #1 will land.
 * The recruiter learns the funnel by seeing the thing they'll use, and the
 * upstream links read as "the way to fill this slot" rather than as navigation.
 *
 * Differs from variant A: the glyph is a supporting mark beside the copy, not a
 * hero, and the teaching happens through real stage nouns (localized via
 * enumLabel, the same labels the live board headers use) instead of a 3-step
 * explainer. Kept static — a small decorative glyph next to text doesn't earn an
 * ambient loop.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, UserPlus } from "lucide-react";
import { PANEL_SUNKEN, EYEBROW, BTN_PRIMARY, BTN_SECONDARY, META_LABEL } from "@/app/_components/ui/recipes";
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { PIPELINE_GLYPH } from "@/app/_components/glyph/glyphs/pipelineGlyph";
import { buildTabSwitchUrl, type WorkspaceTabId } from "@/app/features/shell/tabs";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { STAGES, STAGE_HELP } from "@/app/features/shared/pipelineTypes";

/** The props the Pipeline empty state has always been given. */
export type PipelineEmptyProps = {
  title: string;
  body: string;
  links: { tab: WorkspaceTabId; label: string }[];
  extraAction?: React.ReactNode;
};

// A single lane of the rehearsal board. The first lane carries the waiting slot;
// the rest are drawn empty so the funnel's shape is legible at a glance.
function GhostLane({ index, label, help, waiting }: { index: number; label: string; help: string; waiting: boolean }) {
  return (
    <li className="min-w-0 flex-1">
      <p className={`truncate ${META_LABEL}`} title={help}>
        <span className="text-stone-400">{index + 1}.</span> {label}
      </p>
      <div
        className={`mt-1.5 flex h-16 items-center justify-center rounded-md border border-dashed px-2 text-center ${
          waiting ? "border-coral/50 bg-coral/5" : "border-stone-200 bg-white"
        }`}
      >
        {waiting ? (
          <span className="flex items-center gap-1.5 text-sm font-medium text-coral">
            <UserPlus size={14} aria-hidden /> First candidate
          </span>
        ) : (
          <span className="text-sm text-stone-400" aria-hidden>
            —
          </span>
        )}
      </div>
    </li>
  );
}

export function PipelineEmptyFirstCandidate({ title, body, links, extraAction }: PipelineEmptyProps) {
  const router = useRouter();
  const search = useSearchParams();
  const enumLabel = useEnumLabel();
  const go = (tab: PipelineEmptyProps["links"][number]["tab"]) =>
    router.push(buildTabSwitchUrl(tab, search.toString()));

  return (
    <div className={`${PANEL_SUNKEN} p-6`}>
      <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
        <MotionizedGlyph
          data={PIPELINE_GLYPH.data}
          viewBox={PIPELINE_GLYPH.viewBox}
          className="h-24 w-24 shrink-0"
        />
        <div className="min-w-0">
          <p className={EYEBROW}>Your board, waiting</p>
          <p className="mt-1 text-base font-semibold text-ink">{title}</p>
          <p className="mt-1 max-w-xl text-sm text-steel">{body}</p>
        </div>
      </div>

      <ol className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-start">
        {STAGES.map((stage, i) => (
          <GhostLane
            key={stage}
            index={i}
            label={enumLabel("stage", stage)}
            help={STAGE_HELP[stage] ?? stage}
            waiting={i === 0}
          />
        ))}
      </ol>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {links.map((link, i) => (
          <button
            key={link.tab}
            type="button"
            onClick={() => go(link.tab)}
            className={`${i === 0 ? BTN_PRIMARY : BTN_SECONDARY} px-3 py-1.5 text-sm`}
          >
            {link.label} <ArrowRight size={13} aria-hidden />
          </button>
        ))}
        {extraAction ?? null}
      </div>
    </div>
  );
}
