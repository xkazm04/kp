"use client";

// The preflight strip: what the engine can read of each attached file, shown
// above the Analyze button, plus the one combination that cannot run — blind
// screening over a CV with no text to redact — stated with its two remedies.
// The decision is analyzeCvReadability.preflightVerdict; this only renders it.
// The engine's own fail-closed refusal is untouched: this is an earlier copy of
// it, never a replacement.
import { AlertTriangle, CheckCircle2, HelpCircle, Loader2, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { BTN_SECONDARY, META_LABEL, PANEL_ACCENT, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import type { PreflightVerdict, Readability } from "./analyzeCvReadability";

export const PREFLIGHT_BLOCK_ID = "analyze-preflight-block";

type Tone = "ok" | "busy" | "note" | "block" | "unknown";

const TONE_ICON = {
  ok: <CheckCircle2 className="h-4 w-4 shrink-0 text-moss" aria-hidden />,
  busy: <Loader2 className="h-4 w-4 shrink-0 animate-spin text-steel" aria-hidden />,
  note: <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" aria-hidden />,
  block: <ShieldAlert className="h-4 w-4 shrink-0 text-coral" aria-hidden />,
  unknown: <HelpCircle className="h-4 w-4 shrink-0 text-steel" aria-hidden />,
} satisfies Record<Tone, ReactNode>;

export function AnalyzeReadabilityStrip({
  cvFiles,
  jdFile,
  readability,
  verdict,
  blind,
  jdTextTyped,
  onDisableBlind,
  onRemoveCv,
}: {
  cvFiles: readonly File[];
  jdFile: File | null;
  readability: { cvs: Readability[]; jd: Readability | null };
  verdict: PreflightVerdict;
  blind: boolean;
  jdTextTyped: boolean;
  onDisableBlind: () => void;
  onRemoveCv: (index: number) => void;
}) {
  const t = useTranslations("analyze");
  if (cvFiles.length === 0 && !jdFile) return null;

  const cvLabel = (i: number): string =>
    cvFiles.length > 1
      ? `${t("variantPrefix", { letter: String.fromCharCode(65 + i) }).trim()} ${cvFiles[i].name}`
      : cvFiles[i].name;

  function describe(r: Readability, role: "cv" | "jd"): { tone: Tone; text: string } {
    switch (r.kind) {
      case "checking":
        return { tone: "busy", text: t("preflightChecking") };
      case "readable":
        return {
          tone: "ok",
          text: r.pages
            ? t("preflightReadablePages", { pages: r.pages, chars: r.chars })
            : t("preflightReadable", { chars: r.chars }),
        };
      case "thin":
        return { tone: "note", text: t("preflightThin", { chars: r.chars }) };
      case "no-text":
        if (role === "jd") {
          return { tone: "note", text: jdTextTyped ? t("preflightJdEmptyOverridesText") : t("preflightJdEmpty") };
        }
        return blind
          ? { tone: "block", text: t("preflightBlindUnmaskable") }
          : { tone: "note", text: t("preflightModelRead") };
      case "unreadable":
        return { tone: role === "cv" && blind ? "block" : "note", text: t("preflightUnreadable") };
      case "unchecked":
        return { tone: "unknown", text: t("preflightUnchecked") };
    }
  }

  const rows: { key: string; label: string; tone: Tone; text: string }[] = [
    ...readability.cvs.map((r, i) => ({ key: `cv-${i}`, label: cvLabel(i), ...describe(r, "cv") })),
    ...(jdFile && readability.jd
      ? [{ key: "jd", label: `${t("preflightJdLabel")}: ${jdFile.name}`, ...describe(readability.jd, "jd") }]
      : []),
  ];

  return (
    <section aria-label={t("preflightHeading")} className="mt-4 space-y-2">
      <div className={`${PANEL_SUNKEN} px-3 py-2`}>
        <p className={`${META_LABEL} mb-1`}>{t("preflightHeading")}</p>
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.key} className="flex min-w-0 items-start gap-2 text-sm">
              {TONE_ICON[row.tone]}
              <span className="min-w-0">
                <span className="break-all font-medium text-ink">{row.label}</span>
                <span className="text-steel"> · </span>
                <span className={row.tone === "block" ? "font-medium text-coral" : "text-steel"}>{row.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {verdict.blockRun ? (
        <div id={PREFLIGHT_BLOCK_ID} role="alert" className={`${PANEL_ACCENT} px-3 py-2`}>
          <p className="text-sm font-medium text-ink">{t("preflightBlockBlind")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {verdict.remedies.includes("disable-blind") ? (
              <button type="button" onClick={onDisableBlind} className={`${BTN_SECONDARY} h-9 bg-white px-3 text-sm`}>
                {t("preflightRunWithoutBlind")}
              </button>
            ) : null}
            {verdict.remedies.includes("remove-variant")
              ? verdict.blindUnmaskable.map((i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onRemoveCv(i)}
                    className={`${BTN_SECONDARY} h-9 bg-white px-3 text-sm`}
                  >
                    {t("preflightRemove", { name: cvLabel(i) })}
                  </button>
                ))
              : null}
          </div>
        </div>
      ) : verdict.waiting ? (
        <p id={PREFLIGHT_BLOCK_ID} role="status" className="text-sm text-steel">
          {t("preflightWaiting")}
        </p>
      ) : null}
    </section>
  );
}
