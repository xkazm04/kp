"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MessageSquarePlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { railIconBtn } from "@/app/_components/ui/recipes";
import { useAttention } from "@/app/features/shell/useAttention";
import { useOptionalCompanionDock } from "./CompanionDockProvider";
import { CompanionSettingsMenu } from "./CompanionSettingsMenu";
import { CompanionVoiceMode } from "./voice/CompanionVoiceMode";
import { CompanionBody, CompanionRest } from "./CompanionDockBody";

/*
 * Candi's window — the persistent LEFT dock.
 *
 * It sits over the nav sidebar, not over the page. That is the whole point of
 * round 2: the operator asks about the pipeline while the pipeline is still on
 * screen, so the chat and the work are legible at the same time. Navigation is
 * the one region of the shell that is redundant DURING a conversation, and it is
 * exactly one control away — which is why the close affordance is a real icon
 * button in a header toolbar rather than a scrim or an edge gesture.
 *
 * Geometry: fixed full-height rail at sm+ whose bottom clears the live control
 * bar (--sim-bar-h), an inset bottom sheet below sm (where there is no permanent
 * sidebar to cover), the shared --z-sim-drawer layer — above the <aside>, below
 * the Modal at z-50, because a dialog the operator opened is always the more
 * recent intent. A complementary <aside>, not a dialog: no focus trap, no inert
 * page.
 *
 * Round 1 shipped two directional variants behind a switcher. Colleague won and
 * Desk was deleted; what survives of Desk is nothing — its provenance-in-the-
 * reading-path premise lost to marginalia on purpose.
 *
 * ROUND V2 gave her a second SHAPE and ROUND V3 settled it. `prefs.mode` picks
 * between this window and the voice strip (voice/CompanionVoiceMode.tsx), and
 * the branch is the LAST thing that happens: the thread, the utterance, the
 * preferences and the seed handoff are all resolved ABOVE this file now, in
 * `CompanionDockProvider`, and handed to whichever shape is on. So a mode flip
 * mid-conversation drops nothing — not a turn in flight, not an utterance, not
 * the operator's place — because there is exactly one of each and the mode only
 * decides who draws it.
 *
 * WHY THE SEAM LEFT THIS FILE. Voice mode's input is no longer here at all: it
 * is a layer-2 panel of the footer control dock, in another feature's tree. Two
 * surfaces, one conversation — see useCompanionRuntime.ts.
 */

const DOCK_SHELL =
  "animate-slide-in motion-reduce:animate-none fixed bottom-[calc(var(--sim-bar-h)_+_8px)] left-3 z-[var(--z-sim-drawer)] flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-paper shadow-overlay max-sm:inset-x-3 max-sm:max-h-[70dvh] sm:top-[25dvh] sm:w-[min(92vw,30rem)]";

export function CompanionDock() {
  const dock = useOptionalCompanionDock();
  const t = useTranslations("companion");
  const attention = useAttention();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const open = dock?.open ?? false;
  const voice = dock?.prefs.mode === "voice";
  // Voice mode keeps the strip up while an utterance is still in flight, because
  // closing her is not a request to be cut off mid-sentence — and the strip
  // carries the only stop control there is. In WINDOW mode the equivalent
  // courtesy is impossible (the rest pill has no transport), so closing the
  // window stops the audio, which is V1's contract unchanged.
  const speaking = dock?.speech.speakingId !== null && dock?.speech.speakingId !== undefined;
  const showVoice = voice && (open || speaking);
  const stop = dock?.speech.stop;
  useEffect(() => {
    if (open || voice || !stop) return;
    stop();
  }, [open, voice, stop]);

  if (!dock) return null;
  if (showVoice) {
    return (
      <CompanionVoiceMode thread={dock.thread} speech={dock.speech} prefs={dock.prefs} onClose={dock.closeDock} />
    );
  }
  if (!open) {
    return (
      <CompanionRest
        onOpen={() => dock.openDock()}
        busy={dock.thread.busy}
        unread={dock.unread}
        label={t("dock.open")}
      />
    );
  }

  return (
    <aside aria-label={t("dock.title")} className={DOCK_SHELL}>
      <CompanionToolbar
        eyebrow={t("dock.eyebrow")}
        label={t("dock.actions")}
        newLabel={t("dock.newThread")}
        closeLabel={t("dock.close")}
        // The settings gear rides the extension point the toolbar already had:
        // ahead of the two window controls, so Close never moves out from under
        // the operator's cursor. It hangs DOWN from the toolbar and right-aligns
        // to it: the dock's header is its top edge, so downward is the only
        // direction with room, and the transcript it briefly covers is the thing
        // the operator is about to change the shape of anyway.
        extra={
          <CompanionSettingsMenu
            prefs={dock.prefs}
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            side="bottom"
            align="end"
          />
        }
        // A new conversation is refused mid-turn rather than racing it: the
        // reply is already paid for, and dropping it on the floor to paint an
        // empty thread is the one outcome nobody asked for.
        canStartNew={dock.thread.ready && !dock.thread.busy}
        onNew={() => void dock.thread.newThread()}
        onClose={dock.closeDock}
      />
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3">
        <CompanionBody
          turns={dock.thread.turns}
          proposals={dock.thread.proposals}
          busy={dock.thread.busy}
          error={dock.thread.error}
          attention={attention}
          memoryEnabled={dock.thread.memoryEnabled}
          speech={dock.speech}
          onSend={dock.thread.send}
          onResolveProposal={dock.thread.resolveProposal}
        />
      </div>
    </aside>
  );
}

/**
 * The window's chrome: who this is on the left, what you can do to the window on
 * the right. Icon-only by design — the toolbar competes with a conversation for
 * a 26rem column, so it wins on height and loses on ink.
 *
 * `extra` is the EXTENSION POINT. Future actions (a thread switcher, pin,
 * export) render there, ahead of the two that manage the window itself, so the
 * close control never moves out from under the operator's cursor.
 *
 * `relative z-10` on the band is LOAD-BEARING, not decoration, and round V2 is
 * what found it. `backdrop-blur` gives this header its own stacking context,
 * which confines everything inside it — including the settings panel's `z-50` —
 * to the header's own level, and the body is a later sibling. Measured live: the
 * popover painted correctly and the transcript's chart swallowed every click on
 * it. Anything anchored in `extra` that opens over the body needs the header to
 * out-rank the body, or it is a control that can be seen and not pressed.
 */
function CompanionToolbar({
  eyebrow,
  label,
  newLabel,
  closeLabel,
  canStartNew,
  onNew,
  onClose,
  extra,
}: {
  eyebrow: string;
  label: string;
  newLabel: string;
  closeLabel: string;
  canStartNew: boolean;
  onNew: () => void;
  onClose: () => void;
  extra?: ReactNode;
}) {
  return (
    <header className="relative z-10 flex items-center justify-between gap-2 border-b border-stone-200 bg-paper/95 px-3 py-2 backdrop-blur">
      <p className="text-meta uppercase tracking-wide text-coral">{eyebrow}</p>
      <div role="group" aria-label={label} className="flex items-center gap-0.5">
        {extra}
        <button
          type="button"
          onClick={onNew}
          disabled={!canStartNew}
          aria-label={newLabel}
          className={`${railIconBtn(false)} disabled:opacity-40`}
        >
          <MessageSquarePlus size={18} aria-hidden />
        </button>
        <button type="button" onClick={onClose} aria-label={closeLabel} className={railIconBtn(false)}>
          <X size={18} aria-hidden />
        </button>
      </div>
    </header>
  );
}
