"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, History } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { PANEL_ACCENT, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { cvVariantHash } from "@/app/_lib/cv-variant";
import {
  priorRunQuery,
  summarizePriorRuns,
  type PriorRunRow,
  type PriorRunSummary,
} from "./analyzePriorRuns";

export function AnalyzePriorRunsStrip({
  cvFiles,
  jdSlug,
  blind,
}: {
  cvFiles: readonly File[];
  jdSlug?: string | null;
  blind: boolean;
}) {
  const t = useTranslations("analyze");
  const format = useFormatter();
  const [, startTransition] = useTransition();
  const [rawSummary, setSummary] = useState<PriorRunSummary>({ verdict: "none" });

  useEffect(() => {
    if (blind || cvFiles.length === 0) {
      return;
    }

    let active = true;
    const controller = new AbortController();

    async function loadPriorRuns() {
      try {
        const hashes = await Promise.all(cvFiles.map((f) => cvVariantHash(f)));
        if (!active) return;

        const query = priorRunQuery({ cvHashes: hashes, jdSlug, blind });
        if (!query) {
          startTransition(() => {
            if (active) setSummary({ verdict: "none" });
          });
          return;
        }

        const params = new URLSearchParams();
        for (const h of query.cvHashes) {
          params.append("cv", h);
        }
        if (query.jdSlug) {
          params.set("jd", query.jdSlug);
        }

        const res = await fetch(`/api/analyze/prior?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!res.ok) {
          // Degradation rule: non-2xx treats as no strip, never as "never analyzed"
          if (active) setSummary({ verdict: "none" });
          return;
        }

        const data = (await res.json()) as { ok?: boolean; rows?: PriorRunRow[] };
        if (!active) return;

        const rows = Array.isArray(data.rows) ? data.rows : [];
        const result = summarizePriorRuns(rows, { jdSlug: query.jdSlug });
        startTransition(() => {
          if (active) setSummary(result);
        });
      } catch {
        if (active) setSummary({ verdict: "none" });
      }
    }

    void loadPriorRuns();

    return () => {
      active = false;
      controller.abort();
    };
  }, [cvFiles, jdSlug, blind]);

  const summary: PriorRunSummary =
    blind || cvFiles.length === 0 ? { verdict: "none" } : rawSummary;

  if (summary.verdict === "none") {
    return null;
  }

  if (summary.verdict === "decided") {
    const decisionDate = summary.decision.createdAt
      ? format.dateTime(new Date(summary.decision.createdAt), { dateStyle: "medium" })
      : "";

    return (
      <div
        role="region"
        aria-label={t("priorDecidedTitle")}
        className={`${PANEL_ACCENT} mt-4 p-4 text-sm`}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-coral" aria-hidden />
          <div className="flex-1 space-y-1">
            <p className="font-semibold text-ink">{t("priorDecidedTitle")}</p>
            <p className="text-steel">
              {t("priorDecidedBody", {
                disposition: summary.decision.disposition,
                date: decisionDate,
              })}
            </p>
            <div className="pt-1">
              <Link
                href={`/history/${summary.decision.slug}`}
                className="inline-flex items-center gap-1 font-semibold text-ink underline hover:text-coral"
              >
                <span>{t("priorOpenDecidedReport")}</span>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
            <p className="pt-1 text-xs text-steel">{t("priorDecidedWarning")}</p>

            {summary.otherRoles && summary.otherRoles.length > 0 && (
              <div className="pt-2 text-xs text-steel">
                <span className="font-medium text-ink">{t("priorOtherRolesLabel")} </span>
                {summary.otherRoles.map((role, idx) => (
                  <span key={role.slug}>
                    {idx > 0 && ", "}
                    <Link
                      href={`/history/${role.slug}`}
                      className="font-medium underline hover:text-ink"
                    >
                      {role.jdSlug || t("priorUnlinkedRole")}
                    </Link>
                  </span>
                ))}
                {summary.moreCount && summary.moreCount > 0 ? (
                  <span> {t("priorMoreCount", { count: summary.moreCount })}</span>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (summary.verdict === "seen") {
    const latestDate = summary.latest.createdAt
      ? format.dateTime(new Date(summary.latest.createdAt), { dateStyle: "medium" })
      : "";

    return (
      <div
        role="region"
        aria-label={t("priorSeenTitle")}
        className={`${PANEL_SUNKEN} mt-4 p-4 text-sm`}
      >
        <div className="flex items-start gap-3">
          <History className="mt-0.5 h-4 w-4 shrink-0 text-steel" aria-hidden />
          <div className="flex-1 space-y-1">
            <p className="font-semibold text-ink">{t("priorSeenTitle")}</p>
            <p className="text-steel">
              {t("priorSeenBody", {
                score: summary.latest.score != null ? String(summary.latest.score) : "—",
                date: latestDate,
              })}
            </p>
            <div className="pt-1">
              <Link
                href={`/history/${summary.latest.slug}`}
                className="inline-flex items-center gap-1 font-semibold text-ink underline hover:text-coral"
              >
                <span>{t("priorOpenLatestReport")}</span>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>

            {summary.otherRoles && summary.otherRoles.length > 0 && (
              <div className="pt-2 text-xs text-steel">
                <span className="font-medium text-ink">{t("priorOtherRolesLabel")} </span>
                {summary.otherRoles.map((role, idx) => (
                  <span key={role.slug}>
                    {idx > 0 && ", "}
                    <Link
                      href={`/history/${role.slug}`}
                      className="font-medium underline hover:text-ink"
                    >
                      {role.jdSlug || t("priorUnlinkedRole")}
                    </Link>
                  </span>
                ))}
                {summary.moreCount && summary.moreCount > 0 ? (
                  <span> {t("priorMoreCount", { count: summary.moreCount })}</span>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // summary.verdict === "seen-elsewhere"
  return (
    <div
      role="region"
      aria-label={t("priorSeenElsewhereTitle")}
      className={`${PANEL_SUNKEN} mt-4 p-4 text-sm`}
    >
      <div className="flex items-start gap-3">
        <History className="mt-0.5 h-4 w-4 shrink-0 text-steel" aria-hidden />
        <div className="flex-1 space-y-1">
          <p className="font-semibold text-ink">{t("priorSeenElsewhereTitle")}</p>
          <div className="pt-1 text-xs text-steel">
            <span className="font-medium text-ink">{t("priorOtherRolesLabel")} </span>
            {summary.otherRoles.map((role, idx) => (
              <span key={role.slug}>
                {idx > 0 && ", "}
                <Link
                  href={`/history/${role.slug}`}
                  className="font-medium underline hover:text-ink"
                >
                  {role.jdSlug || t("priorUnlinkedRole")}
                </Link>
              </span>
            ))}
            {summary.moreCount > 0 && (
              <span> {t("priorMoreCount", { count: summary.moreCount })}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
