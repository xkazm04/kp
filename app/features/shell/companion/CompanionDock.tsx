"use client";

import { useEffect, type ReactNode } from "react";
import { MessageSquarePlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { railIconBtn } from "@/app/_components/ui/recipes";
import { useAttention } from "@/app/features/shell/useAttention";
import { useOptionalCompanionDock } from "./CompanionDockProvider";
import { useCompanionThread } from "./useCompanionThread";
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
 */

const DOCK_SHELL =
  "animate-slide-in motion-reduce:animate-none fixed bottom-[calc(var(--sim-bar-h)_+_8px)] left-3 z-[var(--z-sim-drawer)] flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-paper shadow-overlay max-sm:inset-x-3 max-sm:max-h-[70dvh] sm:top-[25dvh] sm:w-[min(92vw,30rem)]";

export function CompanionDock() {
  const dock = useOptionalCompanionDock();
  const t = useTranslations("companion");
  const attention = useAttention();
  const open = dock?.open ?? false;
  const thread = useCompanionThread(open, dock?.markUnread);

  // The palette hands over a query; send it once the thread exists, then clear
  // it so re-opening the dock does not re-ask the same question.
  const seed = dock?.seed ?? null;
  const consumeSeed = dock?.consumeSeed;
  useEffect(() => {
    if (!open || !seed || !thread.ready || !consumeSeed) return;
    consumeSeed();
    void thread.send(seed);
  }, [open, seed, thread, consumeSeed]);

  if (!dock) return null;
  if (!open) {
    return (
      <CompanionRest onOpen={() => dock.openDock()} busy={thread.busy} unread={dock.unread} label={t("dock.open")} />
    );
  }

  return (
    <aside aria-label={t("dock.title")} className={DOCK_SHELL}>
      <CompanionToolbar
        eyebrow={t("dock.eyebrow")}
        label={t("dock.actions")}
        newLabel={t("dock.newThread")}
        closeLabel={t("dock.close")}
        // A new conversation is refused mid-turn rather than racing it: the
        // reply is already paid for, and dropping it on the floor to paint an
        // empty thread is the one outcome nobody asked for.
        canStartNew={thread.ready && !thread.busy}
        onNew={() => void thread.newThread()}
        onClose={dock.closeDock}
      />
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3">
        <CompanionBody
          turns={thread.turns}
          proposals={thread.proposals}
          busy={thread.busy}
          error={thread.error}
          attention={attention}
          memoryEnabled={thread.memoryEnabled}
          onSend={thread.send}
          onResolveProposal={thread.resolveProposal}
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
    <header className="flex items-center justify-between gap-2 border-b border-stone-200 bg-paper/95 px-3 py-2 backdrop-blur">
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
