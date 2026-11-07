"use client";

// The dev-visible layout switcher: a quiet segmented control, `?v=` is the whole state, so
// a reload or a shared URL lands on the same direction. Shown only where page.tsx allows
// it (outside production builds) — it is a judging aid, not product chrome.
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Segmented } from "@/app/_components/kit";
import { VARIANT_IDS, isVariantId, type VariantId } from "./types";

export function Switcher({ current }: { current: VariantId }) {
  const t = useTranslations("one.core.meta");
  const router = useRouter();
  return (
    <span data-role="one-switcher">
      <Segmented
        label={t("layout")}
        value={current}
        items={VARIANT_IDS.map((id) => ({ value: id, label: t(`variants.${id}`) }))}
        onChange={(v) => {
          if (isVariantId(v)) router.replace(`/one?v=${v}`);
        }}
      />
    </span>
  );
}
