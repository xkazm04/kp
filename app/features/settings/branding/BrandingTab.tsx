"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { EYEBROW, INTRO, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";
import { Defer } from "@/app/_components/ui/Defer";
import { CORAL } from "@/app/_lib/brand";
import { accentIsLegible, isBrandFormDirty, normalizeHex6, type BrandConfig, type BrandFormValues } from "@/app/_lib/brand-config";
import { BrandingEditorForm } from "./BrandingEditorForm";

// Tier 3 (docs/design/loading-choreography.md): the live preview panel is secondary to
// the editor form, so it gets its own chunk and mounts a beat later via <Defer>.
const BrandPreview = dynamic(() => import("./BrandingPreview").then((m) => ({ default: m.BrandPreview })), {
  loading: () => <div className="reveal-quiet min-h-[14rem]" aria-hidden />,
});

// Branding tab (E3 white-label) — edit the workspace's display name, primary accent
// color, and logo. The accent re-skins the whole app (and the candidate-facing
// pages) via the CSS-variable override in app/_components/BrandStyle.tsx; here we
// also apply it LIVE on save so the change is visible without a reload.

/** Drive the --color-coral custom property on <html> from the FULL live accent so a
 *  save takes effect immediately. Always SETS an inline value (never removeProperty):
 *  on first load the active override lives in the server-injected <style>'s :root
 *  rule, which removeProperty can't undo — so *clearing* must set the product default
 *  (CORAL) inline, which outranks that rule, rather than remove an absent inline
 *  property and fall the cascade back onto the stale server color. */
function applyLiveAccent(accent: string | null): void {
  document.documentElement.style.setProperty("--color-coral", accent || CORAL);
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
  // The last loaded/saved values — Reset restores to THESE (not empty), and both the
  // Save button and the unsaved-change guard compare the live form against them.
  const [baseline, setBaseline] = useState<BrandFormValues>({ name: "", accent: "", logo: "" });
  // Preview logo failed to load (→ show the default mark instead of a broken image).
  const [logoError, setLogoError] = useState(false);

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
        setBaseline({ name: b.displayName ?? "", accent: b.accentColor ?? "", logo: b.logoUrl ?? "" });
        setLoaded(true);
      })
      .catch(() => setLoadFailed(true));
  }, []);

  // The color the preview + <input type=color> show — the typed accent normalized to
  // 6-digit hex (so `${accent}1a` alpha suffixes and the color input never break),
  // else the product default coral (so the swatch is never blank).
  const effectiveAccent = normalizeHex6(accent.trim()) ?? CORAL;

  // A valid-hex accent that fails WCAG contrast (invisible white button text /
  // focus rings). Drives both a live inline warning and a hard block on save, so
  // the operator can't ship an unreadable accent app-wide + on candidate pages.
  const accentIllegible =
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(accent.trim()) && !accentIsLegible(accent.trim());

  // Whether the form diverges from the last loaded/saved state (Save-enabled + guard).
  const dirty = isBrandFormDirty({ name, accent, logo }, baseline);

  // Unsaved-change guard: warn before a full page unload/close/reload while dirty.
  // (In-app soft navigation isn't intercepted here — that would require the app-shell
  // router, which this tab doesn't own and is out of scope for this component.)
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

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
      // Reflect what the server actually stored (a bad color/URL comes back null),
      // and re-baseline so the form is now clean and Reset reverts to the saved value.
      setName(saved.displayName ?? "");
      setAccent(saved.accentColor ?? "");
      setLogo(saved.logoUrl ?? "");
      setLogoError(false); // retry the preview against the newly stored URL
      setBaseline({ name: saved.displayName ?? "", accent: saved.accentColor ?? "", logo: saved.logoUrl ?? "" });
      applyLiveAccent(saved.accentColor);
      setStatus({ kind: "saved", text: t("saved") });
    } catch {
      setStatus({ kind: "error", text: t("saveFailed") });
    } finally {
      setSaving(false);
    }
  }, [name, accent, logo, t]);

  // Revert the form to the last loaded/saved values (NOT empty) — this is the
  // "discard my edits" affordance. To wipe the brand entirely, clear the fields and
  // Save. Disabled when nothing has changed, so it can't read as "clear".
  const reset = useCallback(() => {
    setName(baseline.name);
    setAccent(baseline.accent);
    setLogo(baseline.logo);
    setLogoError(false); // retry the preview against the reverted URL
    setStatus(null);
  }, [baseline]);

  return (
    // Tier 1: the header is chrome — the form frame + editor panel are the
    // second direct stagger child, so they cascade in as a single unit. Tier 2
    // lives inside that child: a quiet reserved-height box while the config
    // fetch is in flight (never a skeleton), the real editor once it arrives.
    <section className="stagger-children space-y-6" aria-busy={!loaded && !loadFailed}>
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
        <div className="reveal-quiet min-h-[26rem]" aria-hidden />
      ) : (
        <div className="animate-arrive-in grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* Editor */}
          <BrandingEditorForm
            name={name}
            onNameChange={setName}
            accent={accent}
            onAccentChange={setAccent}
            effectiveAccent={effectiveAccent}
            accentIllegible={accentIllegible}
            logo={logo}
            onLogoChange={(v) => {
              setLogo(v);
              // Retry the preview whenever the URL changes (clears a prior load
              // error) — done in the event, not an effect.
              setLogoError(false);
            }}
            dirty={dirty}
            saving={saving}
            status={status}
            onSave={save}
            onReset={reset}
          />

          {/* Live preview — tier 3: secondary to the editor, its own chunk,
              committed one frame later via <Defer>. */}
          <Defer strategy="next-frame" placeholder={<div className={`${PANEL} reveal-quiet min-h-[14rem] p-5`} aria-hidden />}>
            <BrandPreview
              name={name}
              effectiveAccent={effectiveAccent}
              logo={logo}
              logoError={logoError}
              onLogoError={() => setLogoError(true)}
            />
          </Defer>
        </div>
      )}
    </section>
  );
}
