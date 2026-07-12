"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, FIELD, INTRO, META_LABEL, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";
import { Skeleton } from "@/app/_components/Skeleton";
import { CORAL } from "@/app/_lib/brand";
import { accentIsLegible, type BrandConfig } from "@/app/_lib/brand-config";

// Branding tab (E3 white-label) — edit the workspace's display name, primary accent
// color, and logo. The accent re-skins the whole app (and the candidate-facing
// pages) via the CSS-variable override in app/_components/BrandStyle.tsx; here we
// also apply it LIVE on save so the change is visible without a reload.

/** Set/clear the --color-coral custom property on <html> so a saved accent takes
 *  effect immediately (the server-injected <style> applies on the next full load). */
function applyLiveAccent(accent: string | null): void {
  const root = document.documentElement;
  if (accent) root.style.setProperty("--color-coral", accent);
  else root.style.removeProperty("--color-coral");
}

export function BrandingTab() {
  const t = useTranslations("branding");
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState("");
  const [accent, setAccent] = useState("");
  const [logo, setLogo] = useState("");
  const [status, setStatus] = useState<{ kind: "saved" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/brand")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((b: BrandConfig) => {
        setName(b.displayName ?? "");
        setAccent(b.accentColor ?? "");
        setLogo(b.logoUrl ?? "");
        setLoaded(true);
      })
      .catch(() => setLoadFailed(true));
  }, []);

  // The color the preview + <input type=color> show — the typed accent when it's a
  // valid hex, else the product default coral (so the swatch is never broken).
  const effectiveAccent = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(accent.trim()) ? accent.trim() : CORAL;

  // A valid-hex accent that fails WCAG contrast (invisible white button text /
  // focus rings). Drives both a live inline warning and a hard block on save, so
  // the operator can't ship an unreadable accent app-wide + on candidate pages.
  const accentIllegible =
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(accent.trim()) && !accentIsLegible(accent.trim());

  const save = useCallback(async () => {
    if (accent.trim() && !accentIsLegible(accent.trim())) {
      setStatus({ kind: "error", text: t("accentContrast") });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const r = await fetch("/api/brand", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name, accentColor: accent, logoUrl: logo }),
      });
      if (!r.ok) throw new Error();
      const saved = (await r.json()) as BrandConfig;
      // Reflect what the server actually stored (a bad color/URL comes back null).
      setName(saved.displayName ?? "");
      setAccent(saved.accentColor ?? "");
      setLogo(saved.logoUrl ?? "");
      applyLiveAccent(saved.accentColor);
      setStatus({ kind: "saved", text: t("saved") });
    } catch {
      setStatus({ kind: "error", text: t("saveFailed") });
    } finally {
      setSaving(false);
    }
  }, [name, accent, logo, t]);

  const reset = useCallback(() => {
    setName("");
    setAccent("");
    setLogo("");
    setStatus(null);
  }, []);

  return (
    <section className="space-y-6">
      <header>
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <SectionTitle className="mt-1">{t("title")}</SectionTitle>
        <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("intro")}</p>
      </header>

      {loadFailed ? (
        <div className={`${PANEL_SUNKEN} p-4`}>
          <p className="text-base text-coral">{t("loadFailed")}</p>
        </div>
      ) : !loaded ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* Editor */}
          <div className={`${PANEL} space-y-5 p-5`}>
            <div>
              <label htmlFor="brand-name" className={META_LABEL}>
                {t("nameLabel")}
              </label>
              <input
                id="brand-name"
                type="text"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
                className={`${FIELD} mt-1 w-full`}
              />
              <p className="mt-1 text-sm text-steel">{t("nameHelp")}</p>
            </div>

            <div>
              <label htmlFor="brand-accent" className={META_LABEL}>
                {t("accentLabel")}
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="brand-accent"
                  type="color"
                  value={effectiveAccent}
                  onChange={(e) => setAccent(e.target.value)}
                  aria-label={t("accentLabel")}
                  className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-stone-200 bg-white p-0.5"
                />
                <input
                  type="text"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  placeholder="#d65a4a"
                  spellCheck={false}
                  className={`${FIELD} w-32 nums`}
                />
                {accent.trim() ? (
                  <button type="button" onClick={() => setAccent("")} className="text-sm text-steel underline hover:text-ink">
                    {t("accentClear")}
                  </button>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-steel">{t("accentHelp")}</p>
              {accentIllegible ? (
                <p role="alert" className="mt-1 text-sm text-coral">
                  {t("accentContrast")}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="brand-logo" className={META_LABEL}>
                {t("logoLabel")}
              </label>
              <input
                id="brand-logo"
                type="url"
                value={logo}
                onChange={(e) => setLogo(e.target.value)}
                placeholder="https://…/logo.png"
                spellCheck={false}
                className={`${FIELD} mt-1 w-full`}
              />
              <p className="mt-1 text-sm text-steel">{t("logoHelp")}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-stone-200 pt-4">
              <button type="button" onClick={save} disabled={saving} className={`${BTN_PRIMARY} h-9 px-4 text-sm`}>
                {saving ? t("saving") : t("save")}
              </button>
              <button type="button" onClick={reset} disabled={saving} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
                <RotateCcw size={14} aria-hidden /> {t("reset")}
              </button>
              {status ? (
                <span
                  role={status.kind === "error" ? "alert" : "status"}
                  className={`inline-flex items-center gap-1.5 text-sm ${status.kind === "error" ? "text-coral" : "text-moss"}`}
                >
                  {status.kind === "saved" ? <CheckCircle2 size={15} aria-hidden /> : null}
                  {status.text}
                </span>
              ) : null}
            </div>
            <p className="text-sm text-steel">{t("appliesNote")}</p>
          </div>

          {/* Live preview */}
          <div className={`${PANEL} p-5`}>
            <p className={META_LABEL}>{t("previewTitle")}</p>
            <div className="mt-4 flex items-center gap-3">
              {logo.trim() ? (
                // eslint-disable-next-line @next/next/no-img-element -- external logo URL, not a bundled asset
                <img src={logo} alt="" className="h-8 w-8 rounded-md object-contain" />
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
        </div>
      )}
    </section>
  );
}
