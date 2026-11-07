"use client";

// The dev-visible direction switcher, in the header's own segmented language (Seg.tsx):
// `?v=` is the whole state, so a reload or a shared URL lands on the same direction. Shown
// only where page.tsx allows it (outside production builds) — a judging aid, not product chrome.
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SEG_GROUP, Seg } from "./Seg";
import { VARIANT_IDS, type VariantId } from "./types";

export function Switcher({ current }: { current: VariantId }) {
  const t = useTranslations("one.core.meta");
  const router = useRouter();
  return (
    <div className={SEG_GROUP} role="group" aria-label={t("layout")} data-role="one-switcher">
      {VARIANT_IDS.map((id) => (
        <Seg key={id} group="switcher" active={id === current} aria-pressed={id === current} onClick={() => router.replace(`/one?v=${id}`)}>
          {t(`variants.${id}`)}
        </Seg>
      ))}
    </div>
  );
}
