"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { useAttention } from "@/app/features/shell/useAttention";
import { useOptionalCompanionDock } from "./CompanionDockProvider";
import { useCompanionThread } from "./useCompanionThread";
import { CompanionColleague, ColleagueRest } from "./CompanionDockColleague";
import { CompanionDesk, DeskRest } from "./CompanionDockDesk";
import type { CompanionVariantId } from "./companionVariants";

/*
 * The persistent right dock — Candi's home in the studio.
 *
 * Geometry is SimExplainDrawer's, deliberately: a full-height right rail at sm+
 * whose bottom clears the live control bar (--sim-bar-h), an inset bottom sheet
 * below sm, the same z-layer, the same slide-in gated on motion-reduce. It is a
 * complementary <aside>, not a dialog — it does not trap focus or block the page,
 * because the whole point is to talk about the tab you are looking at.
 *
 * PROTOTYPE ROUND 1: the body is behind a two-way switcher (Colleague / Desk).
 * The switcher is scaffold — it goes away when a direction wins.
 */

const DOCK_SHELL =
  "animate-slide-in motion-reduce:animate-none fixed bottom-[calc(var(--sim-bar-h)_+_8px)] right-3 z-[var(--z-sim-drawer)] flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-paper shadow-overlay max-sm:inset-x-3 max-sm:max-h-[70dvh] sm:top-3 sm:w-[min(92vw,26rem)]";

export function CompanionDock() {
  const dock = useOptionalCompanionDock();
  const t = useTranslations("companion");
  const attention = useAttention();
  const [variant, setVariant] = useState<CompanionVariantId>("colleague");
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
    const rest = { onOpen: () => dock.openDock(), busy: thread.busy, unread: dock.unread, label: t("dock.open") };
    return variant === "desk" ? <DeskRest {...rest} /> : <ColleagueRest {...rest} />;
  }

  const body = { turns: thread.turns, busy: thread.busy, error: thread.error, attention, onSend: thread.send };
  return (
    <aside aria-label={t("dock.title")} className={DOCK_SHELL}>
      <header className="flex items-start justify-between gap-2 border-b border-stone-200 bg-paper/95 px-4 py-3 backdrop-blur">
        <div className="min-w-0">
          <p className="text-meta uppercase tracking-wide text-coral">{t("dock.eyebrow")}</p>
          {/* Scaffold: the round-1 direction switcher. One of these wins and the
              control disappears with the loser. */}
          <SegmentedControl
            label={t("dock.variantLabel")}
            value={variant}
            onChange={setVariant}
            className="mt-1.5 flex flex-wrap gap-1.5"
            options={[
              { value: "colleague", label: t("dock.variantColleague") },
              { value: "desk", label: t("dock.variantDesk") },
            ]}
          />
        </div>
        <button
          type="button"
          onClick={dock.closeDock}
          aria-label={t("dock.close")}
          className="focus-ring rounded-md p-1.5 text-steel hover:bg-stone-100"
        >
          <X size={18} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3">
        {variant === "desk" ? <CompanionDesk {...body} /> : <CompanionColleague {...body} />}
      </div>
    </aside>
  );
}
