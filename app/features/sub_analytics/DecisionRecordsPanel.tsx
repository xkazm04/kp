"use client";

import { useTranslations } from "next-intl";
import { ShieldCheck, ShieldAlert, Download } from "lucide-react";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { downloadFile } from "@/app/_lib/export-utils";
// `import type` only — decision-record-store has server imports; types are erased.
import type { DecisionRecord, ChainVerdict } from "@/app/_lib/decision-record-store";

// Decision System of Record (moonshot D) — the recruiter/auditor view of the
// sealed decision chain. The point is the VERIFY BADGE: a tamper-evident proof,
// not just a log. "Export dossier" hands an auditor / right-to-explanation
// request the whole chain + verdict in one click.

type Payload = { records: DecisionRecord[]; chain: ChainVerdict };

function fmtTime(iso: string): string {
  // Deterministic, locale-free: YYYY-MM-DD HH:MM. Avoids a hydration mismatch from
  // toLocaleString and keeps the audit timestamp unambiguous.
  return iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso;
}

export function DecisionRecordsPanel() {
  const t = useTranslations("analytics.decisionRecords");
  const { data, error } = useJsonFetch<Payload>("/api/decisions/records");

  function exportDossier() {
    if (!data) return;
    downloadFile("decision-records.json", JSON.stringify(data, null, 2), "application/json");
  }

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-serif text-h2 text-ink">{t("title")}</h3>
          <p className="mt-1 max-w-prose text-sm text-stone-500">{t("blurb")}</p>
        </div>
        {data && data.records.length > 0 ? (
          <button
            type="button"
            onClick={exportDossier}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-stone-300 px-3 py-1.5 text-sm text-ink hover:bg-stone-50"
          >
            <Download className="h-4 w-4" aria-hidden />
            {t("export")}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-4 text-sm text-stone-500" role="status">
          {t("error")}
        </p>
      ) : !data ? (
        <p className="mt-4 text-sm text-stone-400" role="status">
          {t("loading")}
        </p>
      ) : (
        <>
          {/* Tamper-evidence verdict — the headline of this panel. */}
          {data.chain.ok ? (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              {t("verified", { count: data.chain.count })}
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              <ShieldAlert className="h-4 w-4" aria-hidden />
              {t("broken", { seq: data.chain.brokenAtSeq ?? 0 })}
            </div>
          )}

          {data.records.length === 0 ? (
            <p className="mt-4 text-sm text-stone-400">{t("empty")}</p>
          ) : (
            <ul className="mt-4 divide-y divide-stone-100">
              {data.records.map((r) => (
                <li key={r.seq} className="py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-ink">{r.kind.replace(/_/g, " ")}</span>
                    <span className="shrink-0 font-mono text-xs text-stone-400">{r.actor}</span>
                  </div>
                  <p className="mt-0.5 text-stone-600">{r.rationale}</p>
                  <div className="mt-1 flex items-center gap-3 text-xs text-stone-400">
                    <span className="font-mono">#{r.seq}</span>
                    <span className="font-mono">{r.candidateRef}</span>
                    <span>{fmtTime(r.createdAt)}</span>
                    {/* truncated content hash — the visible fingerprint of the seal */}
                    <span className="font-mono" title={r.contentHash}>
                      {r.contentHash.slice(0, 8)}…
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
