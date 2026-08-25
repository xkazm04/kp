"use client";

import { useTranslations } from "next-intl";
import { CHIP_QUIET, PANEL } from "@/app/_components/ui/recipes";
import { VoiceDots, VoiceNav } from "./VoiceNav";
import { VoicePlaybackButton } from "./VoicePlayback";
import {
  VoiceBlocks,
  VoiceBusyNote,
  VoiceEmpty,
  VoiceMetaChips,
  VoicePromptEcho,
  VoiceProposals,
  VoiceProse,
} from "./VoiceParts";
import type { VoiceVariantProps } from "./voiceTypes";

/*
 * DIRECTION C — "HUD". The INFORMATION-DENSE direction.
 *
 * METAPHOR: a head-up display. Everything the operator needs to stay oriented is
 * projected at the top of their field of view at once, and nothing is one press
 * away — because a HUD that hides a reading is not a HUD.
 *
 * Two bands. The upper one is the answer itself, scrolling inside its own pane
 * (no disclosure, no clamp: a table is drawn where it lands). The lower one is
 * the CONTEXT band — a mini-timeline of dots that is also a jump control, the
 * question this answer answered, her provenance chips, and one chip counting
 * what the studio is waiting on, from the same attention counts the sidebar
 * badges use.
 *
 * HOW IT DIFFERS: Ticker answers "what did she just say"; Stage answers "let me
 * hear it"; HUD answers "where am I in this conversation and what else is
 * outstanding". It is the only direction that draws data the ANSWER does not
 * contain, which is what makes it a real third option rather than a denser
 * Ticker — and also its risk: a permanent band of studio state at the top of the
 * screen is the thing most likely to read as noise after twenty minutes.
 *
 * THE DOTS ARE A CONTROL, not an indicator. At seventeen answers, clicking the
 * third dot beats pressing an arrow fourteen times, and the counter beside them
 * stays honest once the conversation is longer than the window of dots.
 *
 * NO MOTION, deliberately, and for a different reason than Ticker's: a dense
 * surface with animation is where noise becomes unreadable fastest.
 */
export function CompanionVoiceHud({
  history,
  speech,
  busy,
  error,
  proposalById,
  onResolveProposal,
  blockLabels,
  attention,
  chrome,
}: VoiceVariantProps) {
  const t = useTranslations("companion");
  const entry = history.entry;
  // Her own queue is NOT folded in here: an open proposal is answerable in this
  // very window, and counting it beside things that need a different tab would
  // send the operator away from the one place it can be resolved.
  const waiting = (attention?.decisions ?? 0) + (attention?.pipeline ?? 0);

  return (
    <div className={`${PANEL} overflow-hidden`}>
      <div className="flex items-start gap-2.5 px-3 py-2">
        <div className="pt-0.5">
          <VoicePlaybackButton entry={entry} speech={speech} />
        </div>
        <div className="max-h-[13rem] min-w-0 flex-1 overflow-y-auto">
          {entry ? (
            <>
              <VoiceProse entry={entry} />
              <VoiceBlocks entry={entry} labels={blockLabels} maxHeight="none" />
              <VoiceProposals entry={entry} proposalById={proposalById} onResolve={onResolveProposal} />
            </>
          ) : busy ? (
            <VoiceBusyNote compact />
          ) : (
            <VoiceEmpty compact />
          )}
          {error ? <p className="mt-1 text-sm text-coral">{error}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <VoiceNav history={history} />
          {chrome}
        </div>
      </div>

      {/* The context band. `bg-stone-50` recesses it against the answer above —
          the PANEL_SUNKEN register, without its border and radius, because it is
          a band inside a panel rather than a nested well. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-stone-200 bg-stone-50 px-3 py-1.5">
        <VoiceDots history={history} />
        {entry ? <VoicePromptEcho entry={entry} className="min-w-0 flex-1" /> : <span className="flex-1" />}
        {busy ? <VoiceBusyNote compact /> : null}
        {entry ? <VoiceMetaChips entry={entry} /> : null}
        {waiting > 0 ? <span className={CHIP_QUIET}>{t("voiceMode.attention", { count: waiting })}</span> : null}
      </div>
    </div>
  );
}
