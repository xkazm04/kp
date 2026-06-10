"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { formatRelativeTime } from "@/app/_lib/format";
import { useEnumLabel } from "@/app/_lib/use-enum-label";

type AnalysisRow = {
  slug: string;
  candidate_label: string;
  jd_slug: string | null;
  score: number | null;
  role_family: string | null;
  seniority: string | null;
  created_at: string;
  disposition?: string | null;
  // SCOR2 — warn-shaped sanity-check count stamped at save time; NULL on rows
  // saved before the column existed (no pill).
  review_flags?: number | null;
};

// RES5 — the recruiter's recorded decision on a saved analysis, shown as a pill on
// the history row. Tone mirrors the decision queue's language.
const DISPOSITION_STYLE: Record<string, string> = {
  advance: "bg-moss/10 text-moss",
  hold: "bg-dial-amber/20 text-ink",
  pass: "bg-coral/10 text-coral",
};

// Distinct, sorted, non-null values of a column — drives the filter dropdowns
// from whatever's actually in the loaded history.
function distinct(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort();
}

export function HistoryTab() {
  const t = useTranslations("history");
  const enumLabel = useEnumLabel();
  const dispLabel = (d: string) => {
    const key = `disposition.${d}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : d;
  };
  const [rows, setRows] = useState<AnalysisRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Client-side search + filter (RES3). History was an un-queryable flat table —
  // unusable past a few dozen runs. Filtering the loaded set (≤200 rows) needs no
  // schema/server change; server-side query params + tagging are a follow-up for
  // when history outgrows that cap.
  const [q, setQ] = useState("");
  const [roleFamily, setRoleFamily] = useState("");
  const [seniority, setSeniority] = useState("");
  // RES3 follow-up (06-10 scan #3): the recorded disposition (RES5) is the
  // strongest triage signal on the table but postdated the filter bar — make it
  // filterable. "undecided" matches rows with no recorded decision.
  const [disposition, setDisposition] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/analyses")
      .then(async (response) => {
        if (!response.ok) throw new Error(t("loadFailedStatus", { status: response.status }));
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        setRows((payload.analyses as AnalysisRow[]) ?? []);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : t("loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const families = useMemo(() => distinct((rows ?? []).map((r) => r.role_family)), [rows]);
  const seniorities = useMemo(() => distinct((rows ?? []).map((r) => r.seniority)), [rows]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (!needle || r.candidate_label.toLowerCase().includes(needle) || r.slug.toLowerCase().includes(needle)) &&
        (!roleFamily || r.role_family === roleFamily) &&
        (!seniority || r.seniority === seniority) &&
        (!disposition || (disposition === "undecided" ? r.disposition == null : r.disposition === disposition))
    );
  }, [rows, q, roleFamily, seniority, disposition]);
  const filtering = Boolean(q.trim() || roleFamily || seniority || disposition);
  const clearAll = () => {
    setQ("");
    setRoleFamily("");
    setSeniority("");
    setDisposition("");
  };

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">{t("intro")}</p>
      </header>

      <div className="mt-5">
        {error ? (
          <p className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
        ) : rows == null ? (
          <p className="text-base text-steel">{t("loading")}</p>
        ) : rows.length === 0 ? (
          <p className="rounded-md bg-paper p-4 text-base text-steel">
            {t.rich("emptyNoRuns", { b: (chunks) => <strong>{chunks}</strong> })}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="history-search" className="sr-only">{t("searchLabel")}</label>
              <input
                id="history-search"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="focus-ring h-9 min-w-[200px] flex-1 rounded-md border border-stone-200 px-3 text-base"
              />
              <select
                value={roleFamily}
                onChange={(e) => setRoleFamily(e.target.value)}
                aria-label={t("filterFamily")}
                className="focus-ring h-9 rounded-md border border-stone-200 px-2 text-base capitalize"
              >
                <option value="">{t("allFamilies")}</option>
                {families.map((f) => (
                  <option key={f} value={f}>{enumLabel("family", f)}</option>
                ))}
              </select>
              <select
                value={seniority}
                onChange={(e) => setSeniority(e.target.value)}
                aria-label={t("filterSeniority")}
                className="focus-ring h-9 rounded-md border border-stone-200 px-2 text-base capitalize"
              >
                <option value="">{t("allSeniority")}</option>
                {seniorities.map((s) => (
                  <option key={s} value={s}>{enumLabel("seniority", s)}</option>
                ))}
              </select>
              <select
                value={disposition}
                onChange={(e) => setDisposition(e.target.value)}
                aria-label={t("filterDisposition")}
                className="focus-ring h-9 rounded-md border border-stone-200 px-2 text-base"
              >
                <option value="">{t("allDispositions")}</option>
                {Object.keys(DISPOSITION_STYLE).map((d) => (
                  <option key={d} value={d}>{dispLabel(d)}</option>
                ))}
                <option value="undecided">{t("dispositionUndecided")}</option>
              </select>
              {filtering ? (
                <span className="text-sm text-steel" aria-live="polite">{t("showing", { shown: filtered.length, total: rows.length })}</span>
              ) : null}
              {filtering ? (
                <button
                  type="button"
                  onClick={clearAll}
                  className="focus-ring inline-flex items-center gap-1 rounded-full border border-coral/40 bg-coral/5 px-2.5 py-0.5 text-sm font-semibold text-coral hover:bg-coral/10"
                >
                  {t("clear")}
                </button>
              ) : null}
            </div>
            {filtered.length === 0 ? (
              <p className="mt-4 rounded-md bg-paper p-4 text-base text-steel">
                {t("noMatch")}{" "}
                <button type="button" onClick={clearAll} className="font-semibold text-coral underline underline-offset-2">
                  {t("clearFilters")}
                </button>
              </p>
            ) : (
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
                    {filtered.map((row) => (
                  <tr key={row.slug} className="hover:bg-paper/60">
                    <Td>
                      <Link
                        href={`/history/${row.slug}`}
                        className="font-mono text-base font-medium text-coral hover:underline"
                      >
                        {row.slug}
                      </Link>
                    </Td>
                    <Td>{row.candidate_label}</Td>
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
                    <Td>{formatRelative(row.created_at)}</Td>
                  </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </section>
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

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return iso;
  // Within a day: the shared relative "ago" renderer. Older: an absolute date,
  // which reads better than "37d ago" for a history view.
  if (Date.now() - ts < 86_400_000) return formatRelativeTime(iso);
  return new Date(iso).toLocaleDateString();
}
