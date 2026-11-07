"use client";

// The dev-visible layout switcher for round 1: three links, `?v=` is the whole state, so
// a reload or a shared URL lands on the same direction. Shown only where page.tsx allows
// it (outside production builds) — it is a judging aid, not product chrome.
import Link from "next/link";
import { useTranslations } from "next-intl";
import { VARIANT_IDS, type VariantId } from "./types";

export function Switcher({ current }: { current: VariantId }) {
  const t = useTranslations("one.core.meta");
  return (
    <div className="k-chips" role="group" aria-label={t("layout")} data-role="one-switcher">
      {VARIANT_IDS.map((id) => (
        <Link key={id} className="k-chip" href={`/one?v=${id}`} aria-current={id === current ? "page" : undefined} data-variant={id}>
          {t(`variants.${id}`)}
        </Link>
      ))}
    </div>
  );
}
