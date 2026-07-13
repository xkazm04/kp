"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { useBrand } from "@/app/_components/BrandProvider";
import { EXTERNAL_LOGO_IMG_ATTRS, shouldRenderLogo } from "@/app/_lib/brand-config";

// The white-label header block (mark + name [+ tagline]) shared by both sidebars
// (E-BRD-3). Renders the workspace's logo + display name when set, else the default
// KandiDate mark + name. Presentational inner content only — callers own the
// surrounding Link/div wrapper (the two sidebars differ there). `markClass` carries
// the size/rotation per call site.
export function BrandHeader({ markClass, showTagline = true }: { markClass: string; showTagline?: boolean }) {
  const t = useTranslations("nav");
  const { displayName, logoUrl } = useBrand();
  const name = displayName || t("brandName");
  // A configured logo that 404s / renames / is slow falls back to the default mark
  // instead of a permanently broken-image glyph.
  const [logoError, setLogoError] = useState(false);
  return (
    <>
      {shouldRenderLogo(logoUrl, logoError) ? (
        // eslint-disable-next-line @next/next/no-img-element -- external brand logo URL, not a bundled asset
        <img
          src={logoUrl!}
          alt={name}
          onError={() => setLogoError(true)}
          {...EXTERNAL_LOGO_IMG_ATTRS}
          className={`shrink-0 rounded-md object-contain ${markClass}`}
        />
      ) : (
        <KandidateMark className={`shrink-0 text-ink [--k-accent:var(--color-coral)] [--k-fg:var(--color-paper)] ${markClass}`} />
      )}
      {showTagline ? (
        <div className="leading-tight">
          <p className="font-serif text-h3 text-ink">{name}</p>
          <p className="text-sm uppercase tracking-[0.12em] text-steel">{t("tagline")}</p>
        </div>
      ) : (
        <p className="font-serif text-h3 text-ink">{name}</p>
      )}
    </>
  );
}
