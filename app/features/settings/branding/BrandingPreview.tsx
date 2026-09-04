"use client";

import { useTranslations } from "next-intl";
import { PANEL, META_LABEL } from "@/app/_components/ui/recipes";
import { EXTERNAL_LOGO_IMG_ATTRS, shouldRenderLogo } from "@/app/_lib/brand-config";
import { DARK, INK, PAPER, STEEL, WHITE } from "@/app/_lib/brand";

// Tier 3 (docs/design/loading-choreography.md): the live preview is a secondary
// surface — the editor form is what the operator came to use — so it gets its
// own chunk and mounts a beat after the primary content (see the next/dynamic
// import + <Defer> in BrandingTab.tsx).
//
// BOTH THEMES, SIDE BY SIDE. The accent overrides --color-coral in Studio Light AND
// in Spark Dark, and the two get DIFFERENT values (the dark one is derived —
// docs/design/README.md, "The custom accent, in both themes"). This panel used to
// draw one card on `bg-white`, which in the dark theme IS the dark surface: the
// recruiter saw the LIGHT accent on a DARK card — a combination the app never paints
// — and had no way to see the dark twin at all before saving.
//
// The two cards are DELIBERATELY theme-INVARIANT: each is a picture OF a theme, so it
// must not re-skin with the viewer's own. That is why the surface colors here are
// inline values read from app/_lib/brand.ts's LIGHT/DARK role mirrors (the sanctioned
// stylesheet-less seam, kept in lockstep with globals.css by `npm run design:check`)
// rather than Tailwind tokens: `bg-paper` would turn the "Studio Light" card dark the
// moment the operator flips their own appearance.
const GROUNDS = {
  light: { canvas: PAPER, surface: WHITE, ink: INK, steel: STEEL, onAccent: WHITE },
  dark: { canvas: DARK.PAPER, surface: DARK.SURFACE, ink: DARK.INK, steel: DARK.STEEL, onAccent: DARK.SURFACE },
} as const;

type CardLabels = { theme: string; button: string; badge: string; focus: string; fallbackName: string };

function ThemeCard({
  theme,
  accent,
  name,
  logo,
  logoError,
  onLogoError,
  labels,
}: {
  theme: keyof typeof GROUNDS;
  accent: string;
  name: string;
  logo: string;
  logoError: boolean;
  onLogoError: () => void;
  labels: CardLabels;
}) {
  const g = GROUNDS[theme];
  return (
    <div className="rounded-xl p-4" style={{ background: g.canvas, border: `1px solid ${g.surface}` }}>
      <p className="text-sm font-medium" style={{ color: g.steel }}>
        {labels.theme}
      </p>
      <div className="mt-3 rounded-lg p-3" style={{ background: g.surface }}>
        <div className="flex items-center gap-3">
          {shouldRenderLogo(logo, logoError) ? (
            // eslint-disable-next-line @next/next/no-img-element -- external logo URL, not a bundled asset
            <img
              src={logo.trim()}
              alt={name.trim() || labels.fallbackName}
              onError={onLogoError}
              {...EXTERNAL_LOGO_IMG_ATTRS}
              className="h-8 w-8 rounded-md object-contain"
            />
          ) : (
            <span
              className="grid h-8 w-8 place-items-center rounded-md text-sm font-bold"
              style={{ background: accent, color: g.onAccent }}
            >
              {(name.trim() || "K").charAt(0).toUpperCase()}
            </span>
          )}
          <span className="font-serif text-h3" style={{ color: g.ink }}>
            {name.trim() || labels.fallbackName}
          </span>
        </div>
        <div className="mt-4 space-y-3">
          {/* Ground 1 — the FILL under a button label. `text-white` is a ROLE: a light
              label in Studio Light, the dark card surface in Spark Dark. */}
          <span
            className="inline-flex h-9 items-center rounded-full px-4 text-sm font-medium"
            style={{ background: accent, color: g.onAccent }}
          >
            {labels.button}
          </span>
          <div>
            <span
              className="inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium"
              style={{ background: `${accent}1a`, color: accent }}
            >
              {labels.badge}
            </span>
          </div>
          {/* Ground 2 — the thin graphical indicator (focus ring / active-nav bar),
              drawn on the CANVAS. The second ground the contrast rule checks. */}
          <div
            className="rounded-md p-2"
            style={{ background: g.canvas, outline: `2px solid ${accent}`, outlineOffset: "1px" }}
          >
            <span className="text-sm" style={{ color: g.steel }}>
              {labels.focus}
            </span>
          </div>
        </div>
      </div>
      <p className="nums mt-2 text-sm" style={{ color: g.steel }}>
        {accent}
      </p>
    </div>
  );
}

export function BrandPreview({
  name,
  effectiveAccent,
  effectiveAccentDark,
  logo,
  logoError,
  onLogoError,
}: {
  name: string;
  effectiveAccent: string;
  /** The DERIVED Spark Dark twin of `effectiveAccent` (deriveDarkAccent). Equal to
   *  it when the accent already reads on ink — the operator sees that too. */
  effectiveAccentDark: string;
  logo: string;
  logoError: boolean;
  onLogoError: () => void;
}) {
  const t = useTranslations("branding");
  const shared = { name, logo, logoError, onLogoError };
  const labels = {
    button: t("previewButton"),
    badge: t("previewBadge"),
    focus: t("previewFocus"),
    fallbackName: t("previewName"),
  };
  return (
    <div className={`${PANEL} p-5`}>
      <p className={META_LABEL}>{t("previewTitle")}</p>
      <p className="mt-2 text-sm text-steel">{t("previewBothThemes")}</p>
      <div className="mt-4 space-y-4">
        <ThemeCard theme="light" accent={effectiveAccent} {...shared} labels={{ ...labels, theme: t("previewThemeLight") }} />
        <ThemeCard theme="dark" accent={effectiveAccentDark} {...shared} labels={{ ...labels, theme: t("previewThemeDark") }} />
      </div>
      {effectiveAccentDark !== effectiveAccent ? (
        <p className="mt-3 text-sm text-steel">{t("previewDarkDerived")}</p>
      ) : null}
    </div>
  );
}
