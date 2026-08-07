"use client";

// The analysis history table (+ its Th/Td/formatRelative helpers), split out of
// HistoryTab.tsx.
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatRelativeTime } from "@/app/_lib/format";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { DISPOSITION_STYLE, type AnalysisRow } from "./HistoryTypes";

export function HistoryTable({ rows, dispLabel }: { rows: AnalysisRow[]; dispLabel: (d: string) => string }) {
  const t = useTranslations("history");
  const enumLabel = useEnumLabel();
  const locale = useLocale();

  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-stone-200">
      <table className="min-w-full divide-y divide-stone-200">
        <thead className="bg-paper">
          <tr>
            <Th>{t("colSlug")}</Th>
            <Th>{t("colCandidate")}</Th>
            <Th>{t("colFamily")}</Th>
            <Th>{t("colSeniority")}</Th>
            <Th>{t("colScore")}</Th>
            <Th>{t("colDecision")}</Th>
            <Th>{t("colJd")}</Th>
            <Th>{t("colSaved")}</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-200">
          {rows.map((row) => (
            <tr key={row.slug} className="hover:bg-paper/60">
              <Td>
                <Link
                  href={`/history/${row.slug}`}
                  className="font-mono text-base font-medium text-coral hover:underline"
                >
                  {row.slug}
                </Link>
              </Td>
              <Td>
                {row.candidate_label}
                {row.prior_runs ? (
                  <span
                    className="ml-1.5 inline-block rounded-full bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-steel"
                    title={t("priorRuns", { count: row.prior_runs })}
                  >
                    {"↻ "}
                    {row.prior_runs}
                  </span>
                ) : null}
              </Td>
              <Td className="capitalize">{row.role_family ? enumLabel("family", row.role_family) : "—"}</Td>
              <Td className="capitalize">{row.seniority ? enumLabel("seniority", row.seniority) : "—"}</Td>
              <Td>
                {row.score ?? "—"}
                {row.review_flags ? (
                  <span
                    className="ml-1.5 inline-block rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800"
                    title={t("reviewFlags", { count: row.review_flags })}
                  >
                    ⚠ {row.review_flags}
                  </span>
                ) : null}
              </Td>
              <Td>
                {row.disposition ? (
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-sm font-semibold capitalize ${
                      DISPOSITION_STYLE[row.disposition] ?? "bg-stone-100 text-steel"
                    }`}
                  >
                    {dispLabel(row.disposition)}
                  </span>
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                {row.jd_slug ? (
                  <Link
                    href={`/?tab=library&jd=${row.jd_slug}`}
                    className="font-mono text-sm text-coral hover:underline"
                  >
                    {row.jd_slug}
                  </Link>
                ) : (
                  "—"
                )}
              </Td>
              <Td>{formatRelative(row.created_at, locale)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide text-steel"
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-base text-ink ${className}`}>{children}</td>;
}

function formatRelative(iso: string, locale: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return iso;
  // Within a day: the shared relative "ago" renderer. Older: an absolute date,
  // which reads better than "37d ago" for a history view. Both halves render in
  // the ACTIVE locale — the absolute fallback used to take the JS runtime's
  // default, which is the viewer's OS locale, not the app's.
  if (Date.now() - ts < 86_400_000) return formatRelativeTime(iso, locale);
  return new Date(iso).toLocaleDateString(locale);
}
