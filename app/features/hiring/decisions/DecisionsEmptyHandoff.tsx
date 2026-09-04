"use client";

/**
 * Decisions empty state — variant B: "relay handoff".
 *
 * Metaphor: **you passed the baton.** The fork is idle because the work moved
 * downstream, not because it stopped. So the surface reads as a departures
 * board: the glyph is the hero (the fork itself, at rest), and each chain
 * destination is a full card telling the recruiter what is waiting for them
 * there — the next leg of the relay, not a footnote link.
 *
 * Differs from the baseline `ChainEmptyState`: the links are promoted from
 * inline text to the primary affordance, and the copy voice is forward-looking
 * ("next leg") rather than terminal ("caught up"). Same chain, same hops.
 */

import { ArrowRight, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { GLYPH_SIZE } from "@/app/_components/glyph/glyphSizes";
import { DECISIONS_GLYPH } from "@/app/_components/glyph/glyphs/decisionsGlyph";
import { CARD_PAD, EYEBROW, ICON_STICKER, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { DESTINATION_ICON, hintFor, useChainNav, type ChainLink } from "./DecisionsEmptyShared";
import type { DecisionsEmptyProps } from "./DecisionsEmptyShared";

/** One leg of the relay: where the work is now, and what is waiting there. */
function DestinationCard({ link, onOpen }: { link: ChainLink; onOpen: () => void }) {
  const t = useTranslations("decisions.empty");
  const Icon = DESTINATION_ICON[link.tab];
  const hintKey = hintFor(link.tab);
  const hint = hintKey ? t(hintKey) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${PANEL} ${CARD_PAD} focus-ring group flex w-full items-start gap-3 text-left transition-colors hover:border-coral/40`}
    >
      {Icon ? (
        <span className={`${ICON_STICKER} h-10 w-10 shrink-0`}>
          <Icon size={18} aria-hidden className="text-moss" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-base font-semibold text-ink">
          {link.label}
          <ArrowRight size={14} aria-hidden className="text-coral transition-transform group-hover:translate-x-0.5" />
        </span>
        {hint ? <span className="mt-1 block text-sm text-steel">{hint}</span> : null}
      </span>
    </button>
  );
}

export function DecisionsEmptyHandoff({ title, body, links, reconsiderCount }: DecisionsEmptyProps) {
  const t = useTranslations("decisions.empty");
  const go = useChainNav();
  return (
    <div className={`${PANEL_SUNKEN} p-8 text-center`}>
      {/* Hero: the decision fork at rest — advance on one branch, hold on the other. */}
      <MotionizedGlyph
        data={DECISIONS_GLYPH.data}
        viewBox={DECISIONS_GLYPH.viewBox}
        className={`mx-auto ${GLYPH_SIZE.xl}`}
      />
      <p className={`mt-3 ${EYEBROW}`}>{t("batonEyebrow")}</p>
      <h3 className="mt-0.5 font-serif text-h2 text-ink">{title}</h3>
      <p className="mx-auto mt-2 max-w-lg text-base text-steel">{body}</p>

      {links.length > 0 ? (
        <div className="mx-auto mt-6 grid max-w-2xl gap-3 sm:grid-cols-2">
          {links.map((link) => (
            <DestinationCard key={link.tab} link={link} onOpen={() => go(link.tab)} />
          ))}
        </div>
      ) : null}

      {/* The one branch that runs backwards: rejects a recruiter can still pull back. */}
      {reconsiderCount > 0 ? (
        <p className="mx-auto mt-5 inline-flex items-center gap-1.5 text-sm text-steel">
          <RotateCcw size={13} aria-hidden className="text-coral" />
          {t("reconsiderLine", { count: reconsiderCount })}
        </p>
      ) : null}
    </div>
  );
}
