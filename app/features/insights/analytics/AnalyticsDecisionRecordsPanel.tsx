"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ShieldCheck, ShieldAlert, Download } from "lucide-react";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { apiErrorPayload, LocalizedFailure } from "./analyticsFetchError";
import { downloadFile } from "@/app/_lib/export-utils";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import { waveReasonText } from "@/app/_lib/decision-attribution";
import { resolveAuditTimeZone } from "./analyticsDecisionLogTypes";
import { DecisionRecordsTable } from "./sections/DecisionRecordsTable";
// `import type` only — decision-record-store has server imports; types are erased.
import type { DecisionRecord, ChainVerdict } from "@/app/_lib/decision-record-store";

import { LoadingGap } from "@/app/_components/ui/LoadingGap";
// Decision System of Record (moonshot D) — the recruiter/auditor view of the
// sealed decision chain. The point is the VERIFY BADGE: a tamper-evident proof,
// not just a log. "Export dossier" hands an auditor / right-to-explanation
// request the whole chain + verdict in one click.

// `resolved` (Direction 2) maps a record's candidateRef → the live board entry it
// still points at, so a record whose subject is on the board can be opened there;
// a ref that no longer resolves (records outlive entries) stays plain text. The
// row rendering (subject link, timestamp) moved to sections/DecisionRecordsTable.
type Payload = { records: DecisionRecord[]; chain: ChainVerdict; resolved?: Record<string, { label: string; live: boolean }> };


export function DecisionRecordsPanel() {
  const t = useTranslations("analytics.decisionRecords");
  const tReasons = useTranslations("decisions.wave");
  // The server answers a failure with a CODE, never with prose the UI may paint
  // (api-contracts.md §1.1). This export threw the raw HTTP status and, failing that,
  // the server's English `error` string — neither of which ever reached a reader,
  // because the catch downstream painted one flat sentence for both. Resolve the code
  // in the reader's language and throw THAT, so the row can say what actually happened.
  const errMsg = useErrorMessage();
  const locale = useLocale();
  const zone = useMemo(() => resolveAuditTimeZone(), []);
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

  // UAT LUC-ANA-11 — every export names its own scope, in the file itself. A JSON
  // artifact that does not say which workspace chain it came from, when, in which
  // zone and under what scope cannot be attached to a filing: nothing in it lets the
  // recipient reproduce it. Machine field names on purpose (this block is parsed,
  // not read), so it needs no catalog entry and cannot drift out of translation.
  const withProvenance = (payload: Payload, scope: string) => ({
    provenance: {
      artifact: "kp-decision-records",
      scope,
      generatedAt: new Date().toISOString(),
      timeZone: zone,
      locale,
      recordCount: payload.records.length,
      // The verdict always covers the WHOLE workspace chain, even in a
      // single-subject dossier: integrity is a property of the chain, not of the
      // rows this file happens to carry. Saying so here stops a reader from
      // reporting "chain verified" as a statement about one candidate.
      chainScope: "workspace",
      chainVerified: payload.chain.ok,
      chainKeyed: payload.chain.keyed,
      chainKeylessCount: payload.chain.keylessCount,
    },
    ...payload,
    // Add a localized rationale ALONGSIDE the byte-stable English one (UAT E). The
    // sealed `rationale` is untouched (it stays in the hash → verification is
    // unaffected); `rationaleLocalized` is a convenience view for a non-English reader.
    records: payload.records.map((r) => ({ ...r, rationaleLocalized: localizedRationale(r) })),
  });

  function exportChain() {
    if (!data) return;
    downloadFile("decision-records-chain.json", JSON.stringify(withProvenance(data, "workspace-chain"), null, 2), "application/json");
  }

  // UAT LUC-GEF-L1-11 (recurrence 2) — the right-to-explanation artifact.
  // `GET /api/decisions/records?candidate=` had shipped a full cycle with ZERO UI
  // callers: present in the API, unreachable from every screen, so answering a
  // subject-access request meant a developer with a terminal. The route (not the
  // client) does the scoping, so the dossier is the server's own projection of that
  // subject's records — operator-gated like the full read (G5).
  async function exportDossier(candidateRef: string) {
    const res = await fetch(`/api/decisions/records?candidate=${encodeURIComponent(candidateRef)}`);
    if (!res.ok) throw new LocalizedFailure(errMsg(await apiErrorPayload(res), t("dossierFailed")));
    const payload = (await res.json()) as Payload & { error?: string; code?: string };
    // A 200 carrying an `error` is the route's degraded shape; it is a failure like
    // any other and folds through the same resolver.
    if (payload.error) throw new LocalizedFailure(errMsg(payload, t("dossierFailed")));
    const safeRef = candidateRef.replace(/[^a-zA-Z0-9_-]+/g, "-");
    downloadFile(
      `decision-dossier-${safeRef}.json`,
      JSON.stringify(withProvenance(payload, `candidate:${candidateRef}`), null, 2),
      "application/json"
    );
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
            onClick={exportChain}
            className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-md border border-stone-300 px-3 py-1.5 text-sm text-ink hover:bg-stone-50"
          >
            <Download className="h-4 w-4" aria-hidden />
            {/* G4 — the button names its own scope. "Export dossier" was ambiguous
                between the whole chain and one subject's records, and only one of
                those two is what a subject-access request asks for. */}
            {t("exportChain")}
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
        // Loading choreography (docs/design/loading-choreography.md, tier 2): a quiet
        // reserved box — invisible for 150ms — instead of a bare "loading" line.
        <LoadingGap className="mt-4 min-h-[10rem]" />
      ) : (
        <>
          {/* Tamper-evidence verdict — the headline of this panel. Theme-mapped
              tokens (moss = verified / coral = broken) so both themes read
              correctly; the old raw emerald/red palette had no dark values.

              UAT LUC-ANA-1 — the headline is now CONDITIONED ON THE KEY, because
              `ok:true` and "tamper-resistant" are two different claims. Every one of
              the 66 sealed records on the live host carries key_id "" — a public
              SHA-256 with no secret — and the panel asserted the strong claim over
              exactly the rows it cannot vouch for. A chain nobody ever keyed is
              integrity-EVIDENT (it catches accidental corruption, a deleted row, a
              casual edit) and forgeable by anyone who can write the table; that is
              what it now says, in those words, with the ceiling beside it: a key set
              tomorrow cannot retro-seal what was sealed today. */}
          {!data.chain.ok ? (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-coral/30 bg-coral/10 px-3 py-2 text-sm text-coral" role="alert">
              <ShieldAlert className="h-4 w-4" aria-hidden />
              {t("broken", { seq: data.chain.brokenAtSeq ?? 0 })}
            </div>
          ) : data.chain.keylessCount > 0 && data.chain.keylessCount === data.chain.count ? (
            // NEVER keyed — the only state in which the chain protects nothing against
            // an insider, and the state the live deployment is in.
            <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
              <div className="space-y-1">
                <p className="font-semibold">{t("verifiedKeyless", { count: data.chain.count })}</p>
                <p>{t("keylessExplain")}</p>
                <p>{t("keylessCeiling", { keyless: data.chain.keylessCount })}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-4 flex items-center gap-2 rounded-md border border-moss/30 bg-moss/10 px-3 py-2 text-sm text-moss">
                <ShieldCheck className="h-4 w-4" aria-hidden />
                {t("verified", { count: data.chain.count })}
              </div>
              {/* Mixed chain: the keyless prefix IS covered — a forge cascades into the
                  first keyed link, which cannot be re-MAC'd — but those links carry no
                  MAC of their own, and the reader is told which ones and from where. */}
              {data.chain.keylessCount > 0 ? (
                <div className="mt-2 space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p>
                    {t("partialKeyless", {
                      keyless: data.chain.keylessCount,
                      count: data.chain.count,
                      seq: data.chain.firstKeyedSeq ?? 0,
                    })}
                  </p>
                  <p>{t("keylessCeiling", { keyless: data.chain.keylessCount })}</p>
                </div>
              ) : null}
            </>
          )}

          {data.records.length === 0 ? (
            <p className="mt-4 text-sm text-stone-400">{t("empty")}</p>
          ) : (
            // Was an unbounded <ul> that rendered EVERY sealed record: a 66-link
            // chain made this section ~9,000px tall, and a chain only grows.
            <DecisionRecordsTable
              records={data.records}
              resolved={data.resolved}
              rationaleOf={localizedRationale}
              boardHref={boardHref}
              onExportDossier={exportDossier}
            />
          )}
        </>
      )}
    </section>
  );
}
