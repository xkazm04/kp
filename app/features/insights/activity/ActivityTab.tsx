"use client";

// Insights → Activity — the row-level audit trail of every LLM action the
// workspace ran (background-mode round, 2026-08-12): when, which use case,
// which provider/model actually served, tokens, cost, and whether the answer
// was the model's or the deterministic fallback. The complement of the Models
// tab's daily rollup: that panel answers "what does this cost", this one
// answers "what exactly happened, in order".
//
// Reuses the shared table primitives rather than reinventing the table:
// ColumnFilter headers (use case / provider selects) + TablePager over the
// bounded in-memory window the API returns (the pager's documented contract).
import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { EYEBROW, INTRO, PANEL } from "@/app/_components/ui/recipes";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";
import { ColumnFilter } from "@/app/_components/table/ColumnFilter";
import { clampPage, pageSlice, TablePager } from "@/app/_components/table/TablePager";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { labelize } from "@/app/_lib/format";
import { ActivityDetailModal } from "./ActivityDetailModal";
import type { LlmActivityRow } from "@/app/_lib/db/llm";

type Payload = { rows: LlmActivityRow[]; window: number };

const num = (v: number | null) => (v == null ? "—" : v.toLocaleString("en-US"));

export function ActivityTab() {
  const t = useTranslations("activity");
  const tModels = useTranslations("models");
  const format = useFormatter();
  const { data, error } = useJsonFetch<Payload>("/api/llm/activity");

  const [useCaseFilter, setUseCaseFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [page, setPage] = useState(0);
  // The row whose detail is open. Held as the ROW, not an id: the table already
  // has the ledger facts in hand, so the modal paints them on the first frame
  // and only the linked run's output has to be fetched.
  const [detail, setDetail] = useState<LlmActivityRow | null>(null);

  // Use-case display name with the app-wide has() fallback (the Models tab's
  // convention) — a new server-side use case renders labelized, never crashes.
  const caseLabel = (useCase: string): string => {
    const key = `useCases.${useCase}` as Parameters<typeof tModels>[0];
    return tModels.has(key) ? tModels(key) : labelize(useCase);
  };

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const filtered = rows.filter(
    (r) => (!useCaseFilter || r.useCase === useCaseFilter) && (!providerFilter || r.provider === providerFilter)
  );
  const safePage = clampPage(page, filtered.length);
  const shown = pageSlice(filtered, safePage);

  const caseOptions = [...new Set(rows.map((r) => r.useCase))].sort().map((v) => ({ value: v, label: caseLabel(v) }));
  const providerOptions = [...new Set(rows.map((r) => r.provider))].sort().map((v) => ({ value: v, label: v }));

  return (
    <section className="stagger-children space-y-6" aria-busy={!data && !error}>
      <header>
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <SectionTitle className="mt-1">{t("title")}</SectionTitle>
        <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("intro", { window: data?.window ?? 500 })}</p>
      </header>

      {error ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-base text-red-700">{t("loadError")}</p>
      ) : !data ? (
        <div className="reveal-quiet min-h-[24rem]" aria-hidden />
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-paper/40 p-6 text-base text-steel">
          {t("empty")}
        </p>
      ) : (
        <div className={`${PANEL} animate-arrive-in p-5`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-base">
              <thead>
                <tr className="border-b border-stone-200 text-left text-meta uppercase text-steel">
                  <th className="pb-2 pr-3 font-semibold">{t("colWhen")}</th>
                  <th className="pb-2 pr-3 font-semibold">
                    <ColumnFilter
                      title={t("colUseCase")}
                      value={useCaseFilter}
                      onChange={(v) => {
                        setUseCaseFilter(v);
                        setPage(0);
                      }}
                      options={caseOptions}
                    />
                  </th>
                  <th className="pb-2 pr-3 font-semibold">
                    <ColumnFilter
                      title={t("colProvider")}
                      value={providerFilter}
                      onChange={(v) => {
                        setProviderFilter(v);
                        setPage(0);
                      }}
                      options={providerOptions}
                    />
                  </th>
                  <th className="pb-2 pr-3 font-semibold">{t("colModel")}</th>
                  <th className="pb-2 pr-3 text-right font-semibold">{t("colTokens")}</th>
                  <th className="pb-2 pr-3 text-right font-semibold">{t("colCost")}</th>
                  <th className="pb-2 font-semibold">{t("colSource")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  // Row-click opens the detail. The whole row is the mouse target
                  // (a tr can't be a button), while the timestamp cell holds a real
                  // <button> so the same affordance is reachable by keyboard and
                  // announced by assistive tech — clicking the row is a shortcut for
                  // pressing it, not the only way in.
                  <tr
                    key={r.id}
                    onClick={() => setDetail(r)}
                    className="cursor-pointer border-b border-stone-100 align-top transition-colors hover:bg-paper/70"
                  >
                    <td className="whitespace-nowrap py-2 pr-3 text-sm text-steel nums">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation(); // the row handler would fire a second time
                          setDetail(r);
                        }}
                        className="focus-ring rounded text-left underline-offset-2 hover:text-ink hover:underline"
                      >
                        {format.dateTime(new Date(r.ts), { dateStyle: "medium", timeStyle: "short" })}
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-ink">{caseLabel(r.useCase)}</td>
                    <td className="py-2 pr-3 text-steel">{r.provider}</td>
                    <td className="max-w-[14rem] truncate py-2 pr-3 font-mono text-sm text-steel">{r.model ?? "—"}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right text-sm text-steel nums">
                      {t("tokens", { input: num(r.inputTokens), output: num(r.outputTokens) })}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right text-sm text-ink nums">
                      {/* "$0" and "cost unknown" are different facts (Azure /
                          unpriced models) — never render an unknown as 0. */}
                      {r.costUsd == null ? "—" : `$${r.costUsd.toFixed(4)}`}
                    </td>
                    <td className="py-2">
                      {r.source === "llm" ? (
                        <span className="text-sm font-medium text-moss">{t("sourceLlm")}</span>
                      ) : (
                        <span className="text-sm text-steel">{t("sourceDeterministic")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-steel">{t("noMatches")}</p>
          ) : (
            <div className="mt-3">
              <TablePager page={safePage} total={filtered.length} onPage={setPage} />
            </div>
          )}
        </div>
      )}

      {detail ? <ActivityDetailModal row={detail} caseLabel={caseLabel} onClose={() => setDetail(null)} /> : null}
    </section>
  );
}
