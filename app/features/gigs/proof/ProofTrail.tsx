"use client";

import type { ReactNode, RefObject } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Tooltip } from "@/app/_components/Tooltip";
import type { ListPosition } from "../logic/front";

// The row on top of a proof, pinned while it scrolls: the way back and the list it was
// opened from, the section tabs, then Decline (D) and the ← / → / × buttons that mirror
// the keys, with where this gig sits in the list ("1 of 76") between the arrows.

export function ProofTrail({
  label,
  pos,
  backRef,
  onBack,
  onStep,
  tabs,
  canDecline,
  onDecline,
  declineRef,
  declining = false,
}: {
  label: string;
  pos: ListPosition | null;
  backRef: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
  onStep: (id: string) => void;
  tabs?: ReactNode;
  canDecline: boolean;
  onDecline: () => void;
  declineRef: RefObject<HTMLButtonElement | null>;
  declining?: boolean;
}) {
  const t = useTranslations("gigs");
  return (
    <nav className="trail" aria-label={t("proof.trail")}>
      <span className="trail-crumbs">
        <button ref={backRef} type="button" className="crumb" onClick={onBack}>
          {t("proof.back")}
        </button>
        <span className="sep" aria-hidden>
          /
        </span>
        <span className="pos">{label}</span>
      </span>
      {tabs}
      <span className="step">
        {canDecline ? (
          <button ref={declineRef} type="button" className="btn quiet danger" disabled={declining} onClick={onDecline}>
            {t("detail.decline")} <kbd aria-hidden>D</kbd>
          </button>
        ) : null}
        <Tooltip label={t("proof.prev")}>
          <button type="button" className="btn quiet iconbtn" aria-label={t("proof.prev")} disabled={!pos?.prev} onClick={() => pos?.prev && onStep(pos.prev)}>
            <ChevronLeft size={16} aria-hidden />
          </button>
        </Tooltip>
        {pos ? <span className="pos">{t("proof.of", { index: pos.index, total: pos.total })}</span> : null}
        <Tooltip label={t("proof.next")}>
          <button type="button" className="btn quiet iconbtn" aria-label={t("proof.next")} disabled={!pos?.next} onClick={() => pos?.next && onStep(pos.next)}>
            <ChevronRight size={16} aria-hidden />
          </button>
        </Tooltip>
        <Tooltip label={t("proof.close")}>
          <button type="button" className="btn quiet iconbtn" aria-label={t("proof.close")} onClick={onBack}>
            <X size={16} aria-hidden />
          </button>
        </Tooltip>
      </span>
    </nav>
  );
}
