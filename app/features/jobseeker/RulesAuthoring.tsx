"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Wand2 } from "lucide-react";
import { Badge } from "@/app/_components/Badge";
import { Tooltip } from "@/app/_components/Tooltip";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import { TableStatus } from "@/app/_components/table/TableStatus";
import { useTableSort, type SortAccessors } from "@/app/_components/table/useTableSort";
import { BTN_PRIMARY, BTN_SECONDARY, CHIP_QUIET, META_LABEL, PANEL_SUNKEN, STICKY_HEAD } from "@/app/_components/ui/recipes";
import type { ExtractionRule, JobseekerSource, RuleDryRunResult, RuleVerdict } from "@/app/_lib/jobseeker/types";
import { FailureNotice } from "./FailureNotice";
import { callJson, type ApiFailure, type PreviewResult, type ProposeResult } from "./sourcesApi";

// Preview and, for the board_rules adapter, rule authoring. Model-as-author,
// engine-as-extractor (ADR 0009 §2): "Author rules" asks the extraction_rules use case
// for a set (keyless twin marked `deterministic`), the same page is dry-run through the
// production engine, and "Save rules" is offered ONLY after a preview passed (`ok`)
// so the baseline PATCH persists beside the rules is one the owner has seen.
//
// SHARED VOCABULARY (2026-09-16): the well is `PANEL_SUNKEN` rather than its literal
// (which had no `dark:rounded-2xl`, so this was the one square-cornered box on a Spark
// Dark surface); the per-rule table goes through the shared table kit — `ColumnHead`
// renders the `<th>` so `scope` and `aria-sort` cannot be omitted, `useTableSort`
// orders it with missing values pinned last, and `TableStatus` announces a re-sort that
// otherwise happens entirely in the visual channel; refusals are `FailureNotice`, never
// a bare `text-red-700` line. Icon sizes follow SourceSwitch.tsx's rule.

const VERDICT_TONE: Record<RuleVerdict, "positive" | "critical" | "neutral" | "caution"> = {
  hit: "positive",
  "miss-required": "critical",
  "miss-optional": "neutral",
  ambiguous: "caution",
};

type RuleCol = "field" | "matched" | "verdict";
const NO_RULES: RuleDryRunResult[] = [];

export function RulesAuthoring({ source, onSaved }: { source: JobseekerSource; onSaved(next: JobseekerSource): void }) {
  const t = useTranslations("me.sources");
  const locale = useLocale();
  const [busy, setBusy] = useState<"preview" | "propose" | "save" | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [proposed, setProposed] = useState<ProposeResult | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [saved, setSaved] = useState(false);
  const isRules = source.adapter === "board_rules";
  const rules: ExtractionRule[] | null = proposed?.rules ?? source.rules;

  // Hooks are unconditional: the table's engine is armed even before a preview exists,
  // over an empty set, so the control flow below can stay a plain conditional render.
  const accessors: SortAccessors<RuleDryRunResult, RuleCol> = {
    field: (r) => r.field,
    matched: (r) => r.matched,
    verdict: (r) => r.verdict,
  };
  const { sorted, sort, toggle } = useTableSort<RuleDryRunResult, RuleCol>(preview?.perRule ?? NO_RULES, accessors, { col: "field", dir: "asc" });
  const COL_TITLE: Record<RuleCol, string> = { field: t("preview.field"), matched: t("preview.matched"), verdict: t("preview.verdict") };

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
    <div className={`space-y-3 ${PANEL_SUNKEN} p-3`}>
      <div className="flex flex-wrap items-center gap-2">
        {isRules ? (
          <button type="button" className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`} disabled={busy !== null} onClick={() => void propose()}>
            {busy === "propose" ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <Wand2 size={14} aria-hidden />} {busy === "propose" ? t("rules.proposing") : t("rules.author")}
          </button>
        ) : null}
        <button type="button" className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`} disabled={busy !== null || (isRules && !rules)} onClick={() => void runPreview()}>
          {busy === "preview" ? <Loader2 size={14} aria-hidden className="animate-spin" /> : null} {busy === "preview" ? t("preview.running") : t("preview.cta")}
        </button>
        {isRules ? (
          // The precondition was a `title=` on a disabled button — invisible to touch
          // and never shown on focus, i.e. a rule the reader could not reach.
          <Tooltip label={canSave ? t("rules.save") : t("rules.saveHint")}>
            <button type="button" className={`${BTN_PRIMARY} h-8 px-3 text-sm`} disabled={!canSave || busy !== null} onClick={() => void save()}>
              {busy === "save" ? t("rules.saving") : t("rules.save")}
            </button>
          </Tooltip>
        ) : null}
        {saved ? <Badge tone="positive" label={t("rules.saved")} /> : null}
      </div>

      {proposed ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-steel">
          <span className={CHIP_QUIET}>{t(`rules.source.${proposed.source}`)}</span>
          {proposed.invalid ? null : <span>{t("rules.proposedCount", { count: proposed.rules.length })}</span>}
        </div>
      ) : null}
      {/* A set that cannot run is a failure the reader must act on (author again, or by
          hand), so it wears the surface's one failure block. */}
      {proposed?.invalid ? <FailureNotice fallback={t("rules.invalid")} /> : null}

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

      {error ? <FailureNotice failure={error} fallback={t("preview.error")} onDismiss={() => setError(null)} /> : null}

      {preview ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={preview.outcome === "ok" ? "positive" : preview.outcome === "collapsed" ? "critical" : "caution"} label={t(`preview.outcome.${preview.outcome}`)} />
            {/* A count is a numeral, not a pill (surface-doctrine §3). */}
            <span className="nums text-steel">{t("preview.itemCount", { count: preview.itemCount })}</span>
          </div>
          {sorted.length > 0 ? (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <ColumnHead title={COL_TITLE.field} sortCol="field" sort={sort} onSort={toggle} className={STICKY_HEAD("head")} />
                    <ColumnHead title={COL_TITLE.matched} sortCol="matched" sort={sort} onSort={toggle} align="right" className={STICKY_HEAD("head")} />
                    <ColumnHead title={COL_TITLE.verdict} sortCol="verdict" sort={sort} onSort={toggle} className={STICKY_HEAD("head")} />
                    <ColumnHead title={t("preview.samples")} sort={sort} onSort={toggle} className={STICKY_HEAD("head")} />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.field} className="border-t border-stone-200 align-top transition-colors hover:bg-paper/70">
                      <td className="py-1 pr-3 font-mono text-ink">{r.field}</td>
                      {/* `nums` belongs on the CELL that holds a number, never on the
                          header that holds a word. */}
                      <td className="nums py-1 pr-3 text-right text-ink">{r.matched}</td>
                      <td className="py-1 pr-3">
                        <Badge tone={VERDICT_TONE[r.verdict]} label={t(`preview.ruleVerdict.${r.verdict}`)} />
                      </td>
                      <td className="py-1 text-steel">{r.samples.slice(0, 2).join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* The table announces its own changes: a re-sort is otherwise silent. */}
              <TableStatus columnTitle={COL_TITLE[sort.col]} dir={sort.dir} />
            </>
          ) : null}
          {preview.items.length > 0 ? (
            // Hairline-parted rows inside the well, not white boxes inside a sunken box
            // inside a panel (surface-doctrine §2).
            <ul className="divide-y divide-stone-200 border-t border-stone-200 text-sm">
              {preview.items.map((item, i) => (
                <li key={i} className="px-0.5 py-1.5">
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
