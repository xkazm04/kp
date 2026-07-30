"use client";

import { useTranslations } from "next-intl";
import { PANEL, META_LABEL } from "@/app/_components/ui/recipes";
import { EXTERNAL_LOGO_IMG_ATTRS, shouldRenderLogo } from "@/app/_lib/brand-config";

// Tier 3 (docs/design/loading-choreography.md): the live preview is a secondary
// surface — the editor form is what the operator came to use — so it gets its
// own chunk and mounts a beat after the primary content (see the next/dynamic
// import + <Defer> in BrandingTab.tsx).
export function BrandPreview({
  name,
  effectiveAccent,
  logo,
  logoError,
  onLogoError,
}: {
  name: string;
  effectiveAccent: string;
  logo: string;
  logoError: boolean;
  onLogoError: () => void;
}) {
  const t = useTranslations("branding");
  return (
    <div className={`${PANEL} p-5`}>
      <p className={META_LABEL}>{t("previewTitle")}</p>
      <div className="mt-4 flex items-center gap-3">
        {shouldRenderLogo(logo, logoError) ? (
          // eslint-disable-next-line @next/next/no-img-element -- external logo URL, not a bundled asset
          <img
            src={logo.trim()}
            alt={name.trim() || t("previewName")}
            onError={onLogoError}
            {...EXTERNAL_LOGO_IMG_ATTRS}
            className="h-8 w-8 rounded-md object-contain"
          />
        ) : (
          <span
            className="grid h-8 w-8 place-items-center rounded-md text-sm font-bold text-white"
            style={{ background: effectiveAccent }}
          >
            {(name.trim() || "K").charAt(0).toUpperCase()}
          </span>
        )}
        <span className="font-serif text-h3 text-ink">{name.trim() || t("previewName")}</span>
      </div>
      <div className="mt-5 space-y-3">
        <button
          type="button"
          className="inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-white"
          style={{ background: effectiveAccent }}
        >
          {t("previewButton")}
        </button>
        <div>
          <span
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium"
            style={{ background: `${effectiveAccent}1a`, color: effectiveAccent }}
          >
            {t("previewBadge")}
          </span>
        </div>
        <p className="text-sm text-steel">
          {t.rich("previewLink", {
            a: (chunks) => (
              <span className="font-medium" style={{ color: effectiveAccent }}>
                {chunks}
              </span>
            ),
          })}
        </p>
      </div>
    </div>
  );
}
