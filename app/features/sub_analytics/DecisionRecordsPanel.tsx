"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ShieldCheck, ShieldAlert, Download } from "lucide-react";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { downloadFile } from "@/app/_lib/export-utils";
import { buildUrl, clearedTabScopedParams } from "@/app/features/tabs";
import { waveReasonText } from "@/app/_lib/decision-attribution";
// `import type` only — decision-record-store has server imports; types are erased.
import type { DecisionRecord, ChainVerdict } from "@/app/_lib/decision-record-store";

// Decision System of Record (moonshot D) — the recruiter/auditor view of the
// sealed decision chain. The point is the VERIFY BADGE: a tamper-evident proof,
// not just a log. "Export dossier" hands an auditor / right-to-explanation
// request the whole chain + verdict in one click.

// `resolved` (Direction 2) maps a record's candidateRef → the live board entry it
// still points at, so a record whose subject is on the board can be opened there;
// a ref that no longer resolves (records outlive entries) stays plain text.
type Payload = { records: DecisionRecord[]; chain: ChainVerdict; resolved?: Record<string, { label: string; live: boolean }> };

function fmtTime(iso: string): string {
  // Deterministic, locale-free: YYYY-MM-DD HH:MM. Avoids a hydration mismatch from
  // toLocaleString and keeps the audit timestamp unambiguous.
  return iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso;
}

export function DecisionRecordsPanel() {
  const t = useTranslations("analytics.decisionRecords");
  const tReasons = useTranslations("decisions.wave");
  const search = useSearchParams();
  const { data, error, reload } = useJsonFetch<Payload>("/api/decisions/records");
  // Direction 2 — reuse the board deep-link idiom (?q=<label>) to open a record's
  // subject on the board when it still resolves to a live entry.
  const boardHref = (q: string) => buildUrl({ ...clearedTabScopedParams(), tab: "pipeline", q }, search.toString());

  // Localized rationale (UAT E): the sealed `rationale` is byte-stable English (it's
  // hashed — never touch it), but a Czech auditor shouldn't have to read English.
  // Re-render it from the structured reasonCode + inputs the record ALSO carries —
  // the same mirror the screen-wave modal uses — falling back to the English
  // rationale for unmapped codes (older shapes, non-wave kinds). A sealed record is
  // always committed, so reject uses the "did" phrasing.
  const localizedRationale = (r: DecisionRecord): string => {
    if (!r.reasonCode) return r.rationale;
    let params: Record<string, string | number> = {};
    try {
      const inputs = (JSON.parse(r.payloadJson) as { inputs?: unknown })?.inputs;
      if (inputs && typeof inputs === "object" && inputs !== null) params = inputs as Record<string, string | number>;
    } catch {
      return r.rationale;
    }
    // The ONE shared resolver (waveReasonText) the reconsider queue + decision log also
    // use; an unmapped code returns null → fall back to the byte-stable English rationale.
    return waveReasonText(tReasons, { reasonCode: r.reasonCode, reasonParams: params }) ?? r.rationale;
  };

  function exportDossier() {
    if (!data) return;
    // Add a localized rationale ALONGSIDE the byte-stable English one (UAT E). The
    // sealed `rationale` is untouched (it stays in the hash → verification is
    // unaffected); `rationaleLocalized` is a convenience view for a non-English reader.
    const dossier = {
      ...data,
      records: data.records.map((r) => ({ ...r, rationaleLocalized: localizedRationale(r) })),
    };
    downloadFile("decision-records.json", JSON.stringify(dossier, null, 2), "application/json");
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
        // bug-ui-scan-2026-07-09 (analytics-calibration-dashboards #4): recover from a
        // transient failure with the shared retry, announced assertively (role="alert").
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-stone-500" role="alert">
          <span>{t("error")}</span>
          <button
            type="button"
            onClick={reload}
            className="focus-ring inline-flex h-8 items-center rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
          >
            {t("retry")}
          </button>
        </div>
      ) : !data ? (
        <p className="mt-4 text-sm text-stone-400" role="status">
          {t("loading")}
        </p>
      ) : (
        <>
          {/* Tamper-evidence verdict — the headline of this panel. Theme-mapped
              tokens (moss = verified / coral = broken) so both themes read
              correctly; the old raw emerald/red palette had no dark values. */}
          {data.chain.ok ? (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-moss/30 bg-moss/10 px-3 py-2 text-sm text-moss">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              {t("verified", { count: data.chain.count })}
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-coral/30 bg-coral/10 px-3 py-2 text-sm text-coral" role="alert">
              <ShieldAlert className="h-4 w-4" aria-hidden />
              {t("broken", { seq: data.chain.brokenAtSeq ?? 0 })}
            </div>
          )}

          {data.records.length === 0 ? (
            <p className="mt-4 text-sm text-stone-400">{t("empty")}</p>
          ) : (
            <ul className="mt-4 divide-y divide-stone-100">
              {data.records.map((r) => {
                const subject = data.resolved?.[r.candidateRef];
                return (
                <li key={r.seq} className="py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-ink">{r.kind.replace(/_/g, " ")}</span>
                    <span className="shrink-0 font-mono text-xs text-stone-400">{r.actor}</span>
                  </div>
                  <p className="mt-0.5 text-stone-600">{localizedRationale(r)}</p>
                  <div className="mt-1 flex items-center gap-3 text-xs text-stone-400">
                    <span className="font-mono">#{r.seq}</span>
                    {/* Direction 2 — open the subject on the board when the ref still
                        resolves to a live entry; otherwise plain text (a record
                        outlives its entry; policy records have no candidate). */}
                    {subject?.live ? (
                      <Link
                        href={boardHref(subject.label)}
                        title={t("viewCandidate")}
                        className="focus-ring rounded font-mono text-steel underline-offset-2 hover:text-coral hover:underline"
                      >
                        {subject.label}
                      </Link>
                    ) : (
                      <span className="font-mono" title={t("refUnresolved")}>
                        {r.candidateRef}
                      </span>
                    )}
                    <span>{fmtTime(r.createdAt)}</span>
                    {/* truncated content hash — the visible fingerprint of the seal */}
                    <span className="font-mono" title={r.contentHash}>
                      {r.contentHash.slice(0, 8)}…
                    </span>
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
