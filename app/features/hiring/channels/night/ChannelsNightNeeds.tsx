"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { NeedsItem, NeedsList } from "@/app/_components/kit/scene";
import { DRAIN_FAIL_KEY } from "./channelsNightCopy";
import { NEEDS_SHOWN, type NeedItem } from "./channelsNightPlumbing";

/** One need's words: its title (rich: the count wears the pill), detail and call to action. */
export function useNeedWords() {
  const t = useTranslations("channelsNight.plumbing.need");
  const tr = useTranslations();
  return (item: NeedItem, pill: (c: ReactNode) => ReactNode) => {
    const values = { ...item.n, role: item.role ?? "" };
    return {
      title: t.rich(`${item.key}.title`, { ...values, em: pill }),
      /** The title as a plain string (an accessible name). */
      plainTitle: t.markup(`${item.key}.title`, { ...values, em: (c) => c }),
      detail:
        item.key === "edgeFailing" && item.failKind
          ? tr(DRAIN_FAIL_KEY[item.failKind])
          : item.key === "dead" && !(item.n.failed && item.n.bounced)
            ? t(item.n.failed ? "dead.detailFailed" : "dead.detailBounced", values)
            : t(`${item.key}.detail`, values),
      cta: t(`${item.key}.cta`),
    };
  };
}

/**
 * What needs a person, worst first (items at or above NEEDS_SHOWN; the ranking is
 * channelsNightPlumbing.rankNeeds), as the kit's `NeedsList` of one-button `NeedsItem`s, each
 * keyed for focus (`data-level-key`). Renders nothing when nothing does.
 */
export function ChannelsNightNeeds({ needs, onOpen }: { needs: readonly NeedItem[]; onOpen: (item: NeedItem, el: HTMLElement) => void }) {
  const t = useTranslations("channelsNight.plumbing");
  const wordsOf = useNeedWords();
  const shown = needs.filter((n) => n.sev >= NEEDS_SHOWN);
  return (
    <NeedsList title={t("needsTitle")} count={shown.length}>
      {shown.map((item) => {
        const w = wordsOf(item, (c) => <strong>{c}</strong>);
        return (
          <NeedsItem
            key={item.id}
            tone={item.tone}
            title={w.title}
            detail={w.detail}
            cta={w.cta}
            data-level-key={`need-${item.id}`}
            onClick={(e) => onOpen(item, e.currentTarget)}
          />
        );
      })}
    </NeedsList>
  );
}
