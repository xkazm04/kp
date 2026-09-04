"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ChatBlockLabels } from "@/app/_components/chat/chatBlockTypes";
import { railIconBtn } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { CompanionSettingsMenu } from "../CompanionSettingsMenu";
import type { CompanionSpeech } from "../useCompanionSpeech";
import type { CompanionThreadState } from "../useCompanionThread";
import type { CompanionPrefsState } from "../useCompanionPrefs";
import { CompanionVoiceTicker } from "./CompanionVoiceTicker";
import { useVoiceHistory } from "./useVoiceHistory";

/*
 * VOICE MODE (settled in round V3) — the strip, and nothing else on the page.
 *
 * The dock puts a conversation in a column beside the work. This puts ONE answer
 * at the top of it and gives the column back. It is the shape you want when the
 * conversation is something you LISTEN to while working, and the shape that
 * makes "what did she say three answers ago" a countable step rather than a
 * scroll through a column you can no longer see.
 *
 * V2 SHIPPED A PAIR; V3 SHIPPED A WINDOW. The bottom half of that pair — a
 * free-floating input bar hovering above the control dock — is gone. Two
 * floating surfaces stacked at the bottom edge were two chromes competing for
 * the same strip of screen, and only one of them belonged to the app's own
 * footer. Typing to her is now a layer-2 panel INSIDE the control dock
 * (`CompanionInputPanel`, panel id `candi`), which is what makes her one of the
 * console's surfaces rather than a thing floating over it — and what makes the
 * operator's one-surface-at-a-time rule cover her too.
 *
 * WIDTH IS THE ROUND'S OTHER FINDING. Full-bleed, this strip read as a system
 * banner: something the app had put at the top of the screen, not something the
 * operator had opened. Capped at a reading measure and centred — the constraint
 * the losing "Stage" direction was right about — the identical content reads as
 * a window. It is the one thing V3 carried across from a rejected variant.
 *
 * PRESENTATION ONLY. Same provider, same thread, same routes, same proposals.
 * The thread and the speech seam are created ABOVE the mode branch (in
 * `CompanionDockProvider`) and handed down, which is what lets an operator flip
 * modes mid-conversation without dropping a turn — and what makes auto-speak one
 * behaviour rather than one per shape.
 *
 * GEOMETRY. Fixed, on `--z-sim-drawer` — the dock's own layer: above the
 * sidebar, below the Modal, because a dialog the operator opened is always the
 * more recent intent. Nothing traps focus and nothing is inert; the page behind
 * is the entire reason this mode exists.
 *
 * KEYBOARD. The window is one focus stop (`tabIndex=0`, a labelled region); Left
 * and Right walk her answers from there. Bound to the region rather than the
 * document on purpose: a global arrow handler would steal the keys from the page
 * this mode is deliberately leaving usable.
 *
 * ESCAPE IS THE EXCEPTION, and it is bound to the DOCUMENT for the same reason
 * the dock binds it there (CompanionDock, commit e775ff1e): the strip is one
 * focus stop that an operator working the page behind it does not have focus in,
 * so a region-scoped Escape would only work for someone who had tabbed into the
 * thing they are trying to dismiss. It runs the SAME close path the X button
 * does — the host's `close`, which sets the flag that hands focus back to the
 * rest pill — so "the pill gets focus back" stays a property of closing rather
 * than of which control did it. Skipped while the settings popover is open: that
 * popover binds Escape too, and two listeners on `document` never see each
 * other's stopPropagation.
 */

/** Stage's reading measure, the one thing V3 took from a rejected direction. */
const VOICE_WINDOW_WIDTH = "mx-auto w-full max-w-[40rem]";

export function CompanionVoiceMode({
  thread,
  speech,
  prefs,
  onClose,
}: {
  thread: CompanionThreadState;
  speech: CompanionSpeech;
  prefs: CompanionPrefsState;
  onClose: () => void;
}) {
  const t = useTranslations("companion");
  const resolveError = useErrorMessage();
  const history = useVoiceHistory(thread.turns);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const proposalById = useMemo(
    () => new Map(thread.proposals.map((proposal) => [proposal.id, proposal])),
    [thread.proposals]
  );
  const blockLabels = useMemo<ChatBlockLabels>(
    () => ({ table: t("blocks.table"), chart: t("blocks.chart"), emptyCell: t("blocks.emptyCell") }),
    [t]
  );
  const error = thread.error ? resolveError({ code: thread.error }, t("chat.errorGeneric")) : null;

  useEffect(() => {
    if (settingsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settingsOpen, onClose]);

  // The window's own controls, handed to the strip as a slot. The settings gear
  // is the SAME component the dock header mounts, so there is one companion
  // settings panel and not one per shape.
  const chrome = (
    <div className="flex shrink-0 items-center gap-0.5">
      <CompanionSettingsMenu prefs={prefs} open={settingsOpen} onOpenChange={setSettingsOpen} side="bottom" align="end" />
      <button type="button" onClick={onClose} aria-label={t("voiceMode.close")} title={t("voiceMode.close")} className={railIconBtn(false)}>
        <X size={18} aria-hidden />
      </button>
    </div>
  );

  return (
    <section
      aria-label={t("voiceMode.label")}
      tabIndex={0}
      onKeyDown={history.onKeyDown}
      className={`focus-ring animate-slide-in motion-reduce:animate-none fixed inset-x-3 top-3 z-[var(--z-sim-drawer)] rounded-xl ${VOICE_WINDOW_WIDTH}`}
    >
      <CompanionVoiceTicker
        history={history}
        speech={speech}
        busy={thread.busy}
        error={error}
        proposalById={proposalById}
        onResolveProposal={thread.resolveProposal}
        blockLabels={blockLabels}
        chrome={chrome}
      />
    </section>
  );
}
