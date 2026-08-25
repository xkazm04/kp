"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ChatBlockLabels } from "@/app/_components/chat/chatBlockTypes";
import { PANEL } from "@/app/_components/ui/recipes";
import type { CompanionProposal } from "@/app/_lib/db/companion";
import type { CompanionSpeech } from "../useCompanionSpeech";
import { VoiceNav } from "./VoiceNav";
import { VoicePlaybackButton } from "./VoicePlayback";
import { VoiceBlocks, VoiceBusyNote, VoiceEmpty, VoiceMetaChips, VoiceProposals, VoiceProse } from "./VoiceParts";
import type { VoiceHistory } from "./useVoiceHistory";

/*
 * THE VOICE-MODE PRESENTATION — "the Ticker". Round V3 promoted it from one of
 * three directions to the only one; Stage and HUD are deleted.
 *
 * METAPHOR: a newsroom crawl frozen on its last item. One strip near the top of
 * the screen, one to two lines of prose, and the rest of the display is the
 * operator's work — which is the entire reason they asked for this mode. The
 * strip is a HEADLINE: it tells you what she said and gives you one control to
 * hear it, and everything with height to it (a table, a chart, her provenance)
 * is one press away behind "show details" rather than pushing the page down.
 *
 * WHAT V3 TOOK FROM STAGE, and only this: the WIDTH. A strip that spanned the
 * viewport read as a system banner — a notification bar the app had put there —
 * rather than as Candi's window. The host caps it at Stage's reading measure
 * (~40rem) and centres it, so the same content reads as a thing you opened. The
 * register is unchanged: still one to two lines, still no motion, still the
 * disclosure for anything taller.
 *
 * WHERE THE INPUT WENT. There is no bar under this any more. Typing to her is a
 * layer-2 panel in the footer control dock (`CompanionInputPanel`, panel id
 * `candi`), which is what makes the two competing surfaces one surface: opening
 * Automations closes Candi, opening Candi closes Automations, and the strip
 * follows the panel. This component knows none of that — it renders an answer.
 *
 * PROPOSALS ARE NOT BEHIND THE DISCLOSURE. It is the one thing in an answer the
 * operator must respond to, and a minimal strip that hid the only actionable
 * thing would be minimal about the wrong half.
 *
 * NO MOTION. The strip is on screen permanently; colours and borders transition
 * on hover, the disclosure snaps, and nothing moves on its own.
 */

/**
 * The prose length above which the strip offers its expander.
 *
 * DELIBERATELY BELOW the two-line measure it is protecting. At the ~40rem cap a
 * clamped line holds roughly 80 characters, so two lines is ~160 — and the
 * V2 threshold of 140 sat close enough underneath that to be a coin toss on
 * fonts, locale and zoom. A reply that lost its tail to `line-clamp-2` with no
 * expander beside it would be CONTENT CUT, which is the one thing this surface
 * may not do: an operator cannot know that what they are reading is not all of
 * it. Erring low costs an expander over a reply that did fit; erring high costs
 * a sentence nobody can reach.
 */
const CLAMP_SAFE_CHARS = 100;

/** Her full prose is ALWAYS what the strip carries — never `meta.voiceReply`,
 *  which is the composition for the ear and is what the play button speaks. So a
 *  turn with no voice composition has nothing to fall back FROM: the strip is
 *  already showing every character she wrote, clamped visually and expandable in
 *  place. `line-clamp` hides overflow; it never truncates the text. */
function hasMoreToShow(content: string, blocks: number): boolean {
  return blocks > 0 || content.includes("\n") || content.length > CLAMP_SAFE_CHARS;
}

export function CompanionVoiceTicker({
  history,
  speech,
  busy,
  error,
  proposalById,
  onResolveProposal,
  blockLabels,
  chrome,
}: {
  /** Where in her answers the operator is, and how to move. */
  history: VoiceHistory;
  speech: CompanionSpeech;
  /** A turn is in flight. The shown answer is still the last one she gave —
   *  a fetch never blanks what is already on screen. */
  busy: boolean;
  /** Already resolved to a sentence by the host; null when nothing failed. */
  error: string | null;
  /** Live proposal rows, keyed by id — the turn's `meta.proposalIds` is what
   *  joins them, never position. */
  proposalById: Map<string, CompanionProposal>;
  onResolveProposal: (id: string, decision: "accept" | "decline") => Promise<boolean>;
  blockLabels: ChatBlockLabels;
  /** The strip's own controls (settings, close). A slot rather than a fixed row
   *  because the host owns what the window can DO and this owns what it says. */
  chrome: ReactNode;
}) {
  const t = useTranslations("companion");
  // Keyed by entry id rather than a boolean, so arrowing to another answer
  // collapses back to the headline with no effect to run and no stale open
  // panel showing the previous answer's table.
  const [openId, setOpenId] = useState<string | null>(null);
  const entry = history.entry;
  const open = entry !== null && openId === entry.id;
  const hasDetails = entry !== null && hasMoreToShow(entry.content, (entry.meta?.blocks ?? []).length);

  return (
    <div className={`${PANEL} px-3 py-2`}>
      <div className="flex items-center gap-2.5">
        <VoicePlaybackButton entry={entry} speech={speech} />
        <div className="min-w-0 flex-1">
          {entry ? <VoiceProse entry={entry} clamp={!open} /> : busy ? <VoiceBusyNote /> : <VoiceEmpty />}
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
