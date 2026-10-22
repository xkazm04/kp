"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useBrand } from "@/app/_components/BrandProvider";
import { BrandLogo } from "@/app/_components/BrandHeader";
import { shouldRenderLogo } from "@/app/_lib/brand-config";

// Who is hiring, at the top of a public candidate door (/apply, /apply/quick,
// /status, /schedule). The owner's white-label brand — deployment config, not
// an internal id, so it is fine on the public wire (it already rides BrandProvider).
//
// The sibling of BrandHeader with ONE deliberate difference: an unset brand renders
// NOTHING. BrandHeader falls back to the KandiDate mark because the workspace is the
// product's own chrome; on a candidate door that fallback would present the software
// vendor as the employer. Quiet on purpose: one line, meta size, no tagline.
export function EmployerBrand({ className = "" }: { className?: string }) {
  const t = useTranslations("common");
  const { displayName, logoUrl } = useBrand();
  // A logo that 404s or is renamed drops out rather than leaving a broken-image glyph;
  // the name (when set) still says who is hiring.
  const [logoError, setLogoError] = useState(false);
  const showLogo = shouldRenderLogo(logoUrl, logoError);
  if (!displayName && !showLogo) return null;
  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      {showLogo ? (
        // Beside the name the logo repeats it, so it is decorative; alone it IS the name.
        <BrandLogo
          src={logoUrl!}
          alt={displayName ? "" : t("employerLogo")}
          onError={() => setLogoError(true)}
          className="h-8 w-auto max-w-32 shrink-0 rounded-md object-contain"
        />
      ) : null}
      {displayName ? <p className="truncate text-meta font-semibold text-ink">{displayName}</p> : null}
    </div>
  );
}
