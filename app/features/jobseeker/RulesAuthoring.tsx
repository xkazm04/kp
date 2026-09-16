"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Badge } from "@/app/_components/Badge";
import { BTN_PRIMARY, BTN_SECONDARY, CHIP_QUIET, META_LABEL } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { ExtractionRule, JobseekerSource, RuleVerdict } from "@/app/_lib/jobseeker/types";
import { callJson, type ApiFailure, type PreviewResult, type ProposeResult } from "./sourcesApi";

// Preview and, for the board_rules adapter, rule authoring. Model-as-author,
// engine-as-extractor (ADR 0009 §2): "Author rules" asks the extraction_rules use case
// for a set (keyless twin marked `deterministic`), the same page is dry-run through the
// production engine, and "Save rules" is offered ONLY after a preview passed (`ok`)
// so the baseline PATCH persists beside the rules is one the owner has seen.

const VERDICT_TONE: Record<RuleVerdict, "positive" | "critical" | "neutral" | "caution"> = {
  hit: "positive",
  "miss-required": "critical",
  "miss-optional": "neutral",
  ambiguous: "caution",
};

export function RulesAuthoring({ source, onSaved }: { source: JobseekerSource; onSaved(next: JobseekerSource): void }) {
  const t = useTranslations("me.sources");
  const locale = useLocale();
  const resolveError = useErrorMessage();
  const [busy, setBusy] = useState<"preview" | "propose" | "save" | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [proposed, setProposed] = useState<ProposeResult | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [saved, setSaved] = useState(false);
  const isRules = source.adapter === "board_rules";
  const rules: ExtractionRule[] | null = proposed?.rules ?? source.rules;

  const runPreview = async () => {
    setBusy("preview");
    setError(null);
    setSaved(false);
    const r = await callJson<PreviewResult>(`/api/jobseeker/sources/${encodeURIComponent(source.id)}/preview`, {
      method: "POST",
      body: JSON.stringify(isRules && rules ? { rules } : {}),
    });
    setBusy(null);
    if (!r.ok) {
      setError(r.fail);
      return;
    }
    setPreview(r.body);
  };

  const propose = async () => {
    setBusy("propose");
    setError(null);
    setSaved(false);
    setPreview(null);
    const r = await callJson<ProposeResult>(`/api/jobseeker/sources/${encodeURIComponent(source.id)}/rules/propose`, { method: "POST", body: JSON.stringify({ lang: locale }) });
    setBusy(null);
    if (!r.ok) {
      setError(r.fail);
      return;
    }
    setProposed(r.body);
    // The propose route already dry-ran the SAME page: that is the preview.
    if (r.body.rules.length > 0) setPreview(r.body);
  };

  const save = async () => {
    if (!rules || !preview) return;
    setBusy("save");
    setError(null);
    const r = await callJson<{ source: JobseekerSource }>(`/api/jobseeker/sources/${encodeURIComponent(source.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ rules, rulesBaseline: preview.baseline }),
    });
    setBusy(null);
    if (!r.ok) {
      setError(r.fail);
      return;
    }
    setSaved(true);
    onSaved(r.body.source);
  };

  const canSave = isRules && !!rules && rules.length > 0 && preview?.outcome === "ok";

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {isRules ? (
          <button type="button" className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`} disabled={busy !== null} onClick={() => void propose()}>
            {busy === "propose" ? <Loader2 size={13} aria-hidden className="animate-spin" /> : null} {busy === "propose" ? t("rules.proposing") : t("rules.author")}
          </button>
        ) : null}
        <button type="button" className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`} disabled={busy !== null || (isRules && !rules)} onClick={() => void runPreview()}>
          {busy === "preview" ? <Loader2 size={13} aria-hidden className="animate-spin" /> : null} {busy === "preview" ? t("preview.running") : t("preview.cta")}
        </button>
        {isRules ? (
          <button type="button" className={`${BTN_PRIMARY} h-8 px-3 text-sm`} disabled={!canSave || busy !== null} title={canSave ? undefined : t("rules.saveHint")} onClick={() => void save()}>
            {busy === "save" ? t("rules.saving") : t("rules.save")}
          </button>
        ) : null}
        {saved ? <Badge tone="positive" label={t("rules.saved")} /> : null}
      </div>

      {proposed ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-steel">
          <span className={CHIP_QUIET}>{t(`rules.source.${proposed.source}`)}</span>
          {proposed.invalid ? <span className="text-red-700">{t("rules.invalid")}</span> : <span>{t("rules.proposedCount", { count: proposed.rules.length })}</span>}
        </div>
      ) : null}

      {isRules && rules && rules.length > 0 ? (
        <div>
          <p className={META_LABEL}>{t("rules.title")}</p>
          <ul className="mt-1 space-y-0.5 text-sm text-steel">
            {rules.map((r) => (
              <li key={r.field} className="font-mono">
                <span className="text-ink">{r.field}</span> {r.locator.kind}: {r.locator.expr}
                {r.locator.attr ? ` @${r.locator.attr}` : ""} {r.required ? `(${t("rules.required")})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {resolveError(error, t("preview.error"))}
        </p>
      ) : null}

      {preview ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={preview.outcome === "ok" ? "positive" : preview.outcome === "collapsed" ? "critical" : "caution"} label={t(`preview.outcome.${preview.outcome}`)} />
            <span className="text-steel">{t("preview.itemCount", { count: preview.itemCount })}</span>
          </div>
          {preview.perRule.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-sm text-steel">
                  <th className="py-1 pr-3 font-medium">{t("preview.field")}</th>
                  <th className="py-1 pr-3 font-medium">{t("preview.matched")}</th>
                  <th className="py-1 pr-3 font-medium">{t("preview.verdict")}</th>
                  <th className="py-1 font-medium">{t("preview.samples")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.perRule.map((r) => (
                  <tr key={r.field} className="border-t border-stone-200 align-top">
                    <td className="py-1 pr-3 font-mono text-ink">{r.field}</td>
                    <td className="py-1 pr-3 nums text-ink">{r.matched}</td>
                    <td className="py-1 pr-3">
                      <Badge tone={VERDICT_TONE[r.verdict]} label={t(`preview.ruleVerdict.${r.verdict}`)} />
                    </td>
                    <td className="py-1 text-steel">{r.samples.slice(0, 2).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {preview.items.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {preview.items.map((item, i) => (
                <li key={i} className="rounded-md border border-stone-200 bg-white px-2.5 py-1.5">
                  <span className="font-medium text-ink">{String(item.title ?? item.url ?? "")}</span>
                  {item.company ? <span className="text-steel"> · {String(item.company)}</span> : null}
                  {item.location ? <span className="text-steel"> · {String(item.location)}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
