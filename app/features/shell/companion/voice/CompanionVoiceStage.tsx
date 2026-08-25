"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { PANEL } from "@/app/_components/ui/recipes";
import { VoiceNav } from "./VoiceNav";
import { VoicePlaybackRow } from "./VoicePlayback";
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
 * DIRECTION B — "Stage". The VOICE-FORWARD direction.
 *
 * METAPHOR: a lit stage with one speaker on it. A centred card, deliberately
 * narrower than the screen (~40rem, a reading measure), larger type, and a real
 * transport row underneath — the register of something being PERFORMED rather
 * than displayed.
 *
 * THE ONE IDEA: what is on stage is the SPOKEN answer, not the written one.
 * Every reply since V1 is dual-channel — `meta.voiceReply` is the same answer
 * composed for the ear by the CLI, and the prose is composed for a 30rem column.
 * Every other surface in this app leads with the prose and treats the voice form
 * as an alternative rendering. This direction inverts that: the spoken line is
 * the headline, in the display face, and the written reply is the quieter thing
 * you expand when reading beats listening. If the operator's real ask was "I
 * want to LISTEN to my studio", this is the only direction that takes it
 * literally.
 *
 * HOW IT DIFFERS from Ticker: Ticker optimises for screen given back; Stage
 * optimises for the answer being pleasant to receive. It costs about twice the
 * height and it is not full-bleed, which is the trade the round is asking about.
 *
 * WHAT IT GIVES UP: a turn stored before V1, or one whose voice composition was
 * dropped, has no spoken form — the stage then shows the prose, which is
 * correct but is the direction at its least distinctive. That fallback is
 * visible on purpose rather than hidden behind a "voice unavailable" state.
 *
 * MOTION: one crossfade when the answer changes, reduced-motion gated, and
 * nothing else. The stage is where a beat is legitimate — an answer arriving is
 * an event — but it is click- and arrival-gated, never ambient.
 */
export function CompanionVoiceStage({
  history,
  speech,
  busy,
  error,
  proposalById,
  onResolveProposal,
  blockLabels,
  chrome,
}: VoiceVariantProps) {
  const t = useTranslations("companion");
  const reduced = useReducedMotion();
  const [openId, setOpenId] = useState<string | null>(null);
  const entry = history.entry;
  const open = entry !== null && openId === entry.id;

  // The composed-for-the-ear line, when there is one. `?? null` rather than a
  // fallback to the prose, so the branch below can SAY which of the two it is
  // showing instead of silently rendering the same string twice.
  const spoken = entry?.meta?.voiceReply?.text?.trim() || null;
  const headline = spoken ?? entry?.content ?? "";
  // Something to expand only when the written reply is genuinely a different
  // thing, or when she drew something. Otherwise the disclosure would open onto
  // a verbatim copy of the line above it.
  const hasWritten = entry !== null && ((spoken !== null && spoken !== entry.content) || (entry.meta?.blocks ?? []).length > 0);

  return (
    <div className="mx-auto w-full max-w-[40rem]">
      <div className={`${PANEL} p-4`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">{entry ? <VoicePromptEcho entry={entry} /> : null}</div>
          {chrome}
        </div>

        {entry ? (
          <motion.div
            key={entry.id}
            initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduced ? 0 : 0.2, ease: "easeOut" }}
            className="mt-1.5"
          >
            <p className="font-serif text-h2 leading-snug text-ink" aria-live="polite">
              {headline}
            </p>
          </motion.div>
        ) : busy ? (
          <p className="mt-1.5">
            <VoiceBusyNote />
          </p>
        ) : (
          <div className="mt-1.5">
            <VoiceEmpty />
          </div>
        )}

        {error ? <p className="mt-2 text-sm text-coral">{error}</p> : null}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 pt-3">
          <VoicePlaybackRow entry={entry} speech={speech} />
          <div className="flex items-center gap-2">
            {busy && entry ? <VoiceBusyNote compact /> : null}
            <VoiceNav history={history} />
          </div>
        </div>

        {entry ? <VoiceProposals entry={entry} proposalById={proposalById} onResolve={onResolveProposal} /> : null}

        {hasWritten && entry ? (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : entry.id)}
              aria-expanded={open}
              className="focus-ring inline-flex items-center gap-1 text-sm text-steel transition-colors hover:text-ink"
            >
              {open ? t("voiceMode.writtenHide") : t("voiceMode.written")}
              <ChevronDown size={14} aria-hidden className={open ? "rotate-180" : ""} />
            </button>
            {open ? (
              <div className="mt-2 max-h-[18rem] overflow-y-auto border-t border-stone-200 pt-2">
                <VoiceProse entry={entry} />
                <VoiceBlocks entry={entry} labels={blockLabels} maxHeight="none" />
                <VoiceMetaChips entry={entry} recallLimit={2} />
              </div>
            ) : null}
          </div>
        ) : entry ? (
          <VoiceMetaChips entry={entry} />
        ) : null}
      </div>
    </div>
  );
}
