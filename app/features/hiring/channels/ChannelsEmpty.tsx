"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { CARD_PAD, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { CHANNEL_EMPTY_SPECS, type ChannelEmptySpec } from "./channelsEmptySpecs";
import type { ChannelSectionId } from "./channelsSections";

// INTAKE BRIEF — the one editorial system for "this channel isn't connected yet",
// applied identically to all four panes (see channelsEmptySpecs.ts for the model).
// The channel reads as a commissioning brief: what it promises, what setting it up
// costs, in three numbered lines with margin numerals. Prose first, one glyph as
// the plate. No diagram.
//
// Honest about integration state by construction: `connected` swaps the setup
// contract for the "wired, nothing has arrived" copy, and the system has no visual
// vocabulary for traffic — no pulse, no flow animation, no live dot on a channel
// that isn't live. Motion is the `staggered-draw` entrance only.
//
// Every word comes from `channels.empty.*` in four locales; the spec carries keys,
// this component owns the only `t`.

function BriefEmpty({ spec, connected, action }: { spec: ChannelEmptySpec; connected: boolean; action?: ReactNode }) {
  const t = useTranslations("channels.empty");
  return (
    <div className={`${PANEL} ${CARD_PAD}`}>
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-6">
        <div className="min-w-0 flex-1">
          <p className={META_LABEL}>{connected ? t("connectedIdle") : t("notConnected")}</p>
          <h4 className="mt-1 font-serif text-h2 text-ink">{t(spec.promise)}</h4>
          <p className="mt-1.5 max-w-xl text-body text-steel">{connected ? t(spec.waiting) : t(spec.proof)}</p>

          {connected ? null : (
            <ol className="mt-4 space-y-2.5">
              {spec.steps.map((step, i) => (
                <li key={step} className="grid grid-cols-[1.75rem_1fr] items-baseline gap-2">
                  {/* Margin numerals — the editorial counterpart to the filled ink
                      ordinals in SetupGuide, so the brief reads as a page, not a wizard. */}
                  <span className="font-serif text-h3 leading-none text-stone-300 nums" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="text-base leading-6 text-steel">{t(step)}</span>
                </li>
              ))}
            </ol>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-stone-200 pt-4">
            {action}
            <span className="text-sm text-steel">{connected ? t(spec.actionHint) : t(spec.effort)}</span>
          </div>
        </div>

        <div className="shrink-0 self-center rounded-xl border border-stone-200 bg-paper/60 p-3 md:self-start">
          <MotionizedGlyph data={spec.glyph.data} viewBox={spec.glyph.viewBox} className="h-28 w-28" />
        </div>
      </div>
    </div>
  );
}

/**
 * The one seam every pane's initial state goes through.
 *
 * Reserved for the genuine first-run case: a filtered-to-zero list keeps its
 * one-line message, because a self-drawing illustration on a filter result is
 * noise and implies the ledger is empty when it isn't.
 */
export function ChannelEmpty({
  section,
  connected,
  action,
}: {
  section: ChannelSectionId;
  /** Is the channel actually wired? Drives honest copy — never guess this. */
  connected: boolean;
  /** The pane's real next-step control (Add inbox, Publish a role, ...). */
  action?: ReactNode;
}) {
  return <BriefEmpty spec={CHANNEL_EMPTY_SPECS[section]} connected={connected} action={action} />;
}
