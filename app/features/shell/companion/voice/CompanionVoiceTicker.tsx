"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { PANEL } from "@/app/_components/ui/recipes";
import { VoiceNav } from "./VoiceNav";
import { VoicePlaybackButton } from "./VoicePlayback";
import { VoiceBlocks, VoiceBusyNote, VoiceEmpty, VoiceMetaChips, VoiceProposals, VoiceProse } from "./VoiceParts";
import type { VoiceVariantProps } from "./voiceTypes";

/*
 * DIRECTION A — "Ticker". The CALM direction.
 *
 * METAPHOR: a newsroom crawl frozen on its last item. One strip across the top
 * of the screen, one to two lines of prose, and the rest of the display is the
 * operator's work — which is the entire reason they asked for this mode. The
 * strip is a HEADLINE, not a window: it tells you what she said and gives you
 * one control to hear it, and everything with height to it (a table, a chart,
 * her provenance) is one press away behind "show details" rather than pushing
 * the page down.
 *
 * HOW IT DIFFERS from the dock: the dock spends a 30rem column to make a
 * conversation legible; the Ticker spends ~5rem of height to make ONE answer
 * legible and gives the column back. It is the direction that wins if the
 * operator's real complaint was "the chat is in the way".
 *
 * WHAT IT GIVES UP, stated rather than discovered: two lines is a glance, not a
 * read. An answer with real substance is a click away in every case, and if the
 * round finds that the click is always pressed, that is the finding — Ticker
 * loses to Stage and the disclosure was the tell.
 *
 * PROPOSALS ARE NOT BEHIND THE DISCLOSURE, in this direction least of all. It is
 * the one thing in an answer the operator must respond to, and a minimal strip
 * that hides the only actionable thing would be minimal about the wrong half.
 *
 * NO MOTION. The calm direction earns its name by having none: colours and
 * borders transition on hover, the disclosure snaps, and a strip that is on
 * screen permanently must never move on its own.
 */
export function CompanionVoiceTicker({
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
  // Keyed by entry id rather than a boolean, so arrowing to another answer
  // collapses back to the headline with no effect to run and no stale open
  // panel showing the previous answer's table.
  const [openId, setOpenId] = useState<string | null>(null);
  const entry = history.entry;
  const open = entry !== null && openId === entry.id;
  const hasDetails = entry !== null && ((entry.meta?.blocks ?? []).length > 0 || entry.content.length > 140);

  return (
    <div className={`${PANEL} px-3 py-2`}>
      <div className="flex items-center gap-2.5">
        <VoicePlaybackButton entry={entry} speech={speech} />
        <div className="min-w-0 flex-1">
          {entry ? (
            <VoiceProse entry={entry} clamp={!open} />
          ) : busy ? (
            <VoiceBusyNote compact />
          ) : (
            <VoiceEmpty compact />
          )}
          {entry && busy ? (
            <span className="text-sm text-steel" role="status">
              {t("chat.thinking")}
            </span>
          ) : null}
        </div>
        {hasDetails ? (
          <button
            type="button"
            onClick={() => setOpenId(open ? null : (entry?.id ?? null))}
            aria-expanded={open}
            className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-full border border-stone-200 px-2.5 py-1 text-sm text-steel transition-colors hover:border-coral/40 hover:text-ink"
          >
            {open ? t("voiceMode.detailsHide") : t("voiceMode.details")}
            <ChevronDown size={14} aria-hidden className={open ? "rotate-180" : ""} />
          </button>
        ) : null}
        <VoiceNav history={history} className="shrink-0" />
        {chrome}
      </div>

      {error ? <p className="mt-1.5 text-sm text-coral">{error}</p> : null}

      {entry && open ? (
        <div className="mt-2 border-t border-stone-200 pt-2">
          <VoiceBlocks entry={entry} labels={blockLabels} maxHeight="14rem" />
          <VoiceMetaChips entry={entry} />
        </div>
      ) : null}

      {entry ? <VoiceProposals entry={entry} proposalById={proposalById} onResolve={onResolveProposal} /> : null}
    </div>
  );
}
