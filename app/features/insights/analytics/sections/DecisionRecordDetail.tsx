"use client";

// The expanded detail under one sealed decision record.
//
// UAT LUC-ANA-10 — the legal basis was `line-clamp-2` with no title, no expand and
// no row detail, so the column an auditor reads first was the one column she could
// not finish reading. UAT CS-L1-005 — `policyVersion` was sealed on every record
// (three distinct screening floors in the live fixture alone) and rendered nowhere,
// while the per-record content hash had been dropped from the table even though the
// threshold-history strip renders the identical fingerprint idiom twenty lines away.
// UAT LUC-GEF-L1-11 — `GET /api/decisions/records?candidate=` had existed for a full
// cycle with ZERO UI callers: the right-to-explanation artifact was in the API and
// unreachable from any screen. It is reachable from here.
//
// Everything shown is already on the wire; nothing here re-derives or re-computes a
// sealed value. The localized rationale is a VIEW (the panel renders it from the
// structured reasonCode), so the byte-stable sealed English text is shown beside it
// and labelled as the text that is actually hashed.
//
// UAT LUC-ANA-13 — and the Art. 12 pair below it. `parseSealTraceability` was written,
// documented and covered by eleven test assertions, and had ZERO production callers: the
// prompt version behind a ranking and the model's own words about the person it crowned
// were sealed on every group-eval record (group-eval-run.ts) and readable only by opening
// raw `payload_json` out of the JSON dossier. This row is where they belong — it is
// already the place an auditor opens to read the legal basis in full.
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import type { DecisionRecord } from "@/app/_lib/decision-record-store";
import { parseSealTraceability } from "@/app/_lib/decision-attribution";
import { formatAuditTime } from "../analyticsDecisionLogTypes";

// The record kinds a group evaluation seals (group_eval_lead / group_eval_advisory) —
// the only ones an AI Act Art. 12 question can be asked of, because they are the only
// ones whose decision was produced by a model reasoning over a cohort. Matched by family
// prefix rather than by a copy of the canonical pair, so a future sibling kind inherits
// the block instead of silently losing its traceability; every other kind (an advance, an
// offer, a human scorecard) renders nothing here, because "not recorded" would be noise
// on a decision no prompt ever touched.
const isGroupEvalRecord = (kind: string): boolean => kind.startsWith("group_eval");

export function DecisionRecordDetail({
  record,
  localizedRationale,
  locale,
  zone,
  onExportDossier,
  busy,
}: {
  record: DecisionRecord;
  localizedRationale: string;
  locale: string;
  zone: string;
  /** Fetches ?candidate=<ref> and hands the reader the subject's dossier. */
  onExportDossier: (candidateRef: string) => void;
  busy: boolean;
}) {
  const t = useTranslations("analytics.decisionRecords");
  // The sealed text is only worth showing separately when the localized view
  // actually differs from it; otherwise it is the same sentence twice.
  const showSealedText = localizedRationale.trim() !== record.rationale.trim();
  // UAT LUC-ANA-13 — read straight off the sealed payload. The parser's honesty rule is
  // load-bearing here: it returns null rather than an empty shell, so `null` genuinely
  // means "this seal carries no traceability" (a pre-W0.3 record, or a run where no model
  // produced reasoning) and is rendered as that sentence — never as a blank block, and
  // never as a plausible-looking placeholder an auditor could mistake for a record.
  const showTrace = isGroupEvalRecord(record.kind);
  const trace = showTrace ? parseSealTraceability(record.payloadJson) : null;
  const lead = trace?.leadReasoning ?? null;

  return (
    <div className="space-y-3 border-l-2 border-coral/40 bg-paper/60 px-4 py-3">
      <p className="max-w-prose text-sm text-ink">{localizedRationale}</p>
      {showSealedText ? (
        <p className="max-w-prose text-sm text-steel">
          <span className="text-meta uppercase text-steel">{t("detailSealedText")}</span>{" "}
          <span className="italic">{record.rationale}</span>
        </p>
      ) : null}

      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <dt className="text-meta uppercase text-steel">{t("detailPolicy")}</dt>
          <dd className="font-mono text-ink">{record.policyVersion || "—"}</dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-2">
          <dt className="text-meta uppercase text-steel">{t("detailSealedAt")}</dt>
          {/* Rendered in the table's zone, with the ISO instant beside it: the two
              values an auditor has to reconcile against an export are both here. */}
          <dd className="text-ink nums">
            {formatAuditTime(record.createdAt, locale, zone) || "—"} <span className="font-mono text-steel">{record.createdAt}</span>
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-2">
          <dt className="text-meta uppercase text-steel">{t("detailContentHash")}</dt>
          <dd className="break-all font-mono text-ink">{record.contentHash}</dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-2">
          <dt className="text-meta uppercase text-steel">{t("detailPrevHash")}</dt>
          <dd className="break-all font-mono text-steel">{record.prevHash || "—"}</dd>
        </div>
      </dl>

      {/* ── AI Act Art. 12 traceability: which prompt ranked them, and what the model
             actually said about the one it put first. ── */}
      {showTrace ? (
        <section className="space-y-2 rounded-md border border-stone-200 bg-white px-3 py-2">
          <h4 className="text-meta uppercase text-steel">{t("traceTitle")}</h4>
          {!trace ? (
            // The whole pair is absent. Said in one sentence that names BOTH possible
            // causes, because "we did not record it" and "no model was involved" are
            // different facts and this record cannot distinguish them after the fact.
            <p className="max-w-prose text-sm text-steel">{t("traceAbsent")}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-meta uppercase text-steel">{t("tracePrompt")}</span>
                {/* Plural by design (see SealTraceability): a cache straddling a prompt
                    bump legitimately mixes two versions, and collapsing that to one would
                    misreport which prompt produced which part of the ranking. */}
                {trace.promptVersion.length > 0 ? (
                  trace.promptVersion.map((v) => (
                    <span
                      key={v}
                      className="rounded-full border border-stone-300 bg-paper px-2 py-0.5 font-mono text-sm text-ink"
                    >
                      {v}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-amber-700">{t("traceNotRecorded")}</span>
                )}
              </div>

              {lead ? (
                <div className="space-y-1">
                  <p className="text-meta uppercase text-steel">{t("traceLead")}</p>
                  {/* VERBATIM, and marked as a quotation. This is evidence: an auditor
                      asked what the model said, so paraphrasing it here would answer a
                      different question. Clipped at seal time, never re-narrated. */}
                  {lead.verdict ? (
                    <blockquote className="max-w-prose border-l-2 border-stone-300 pl-3 text-sm italic text-ink">
                      {lead.verdict}
                    </blockquote>
                  ) : null}
                  {lead.strengths.length > 0 ? (
                    <p className="max-w-prose text-sm text-ink">
                      <span className="text-meta uppercase text-steel">{t("traceStrengths")}</span>{" "}
                      {lead.strengths.join(" · ")}
                    </p>
                  ) : null}
                  {lead.gaps.length > 0 ? (
                    <p className="max-w-prose text-sm text-ink">
                      <span className="text-meta uppercase text-steel">{t("traceGaps")}</span> {lead.gaps.join(" · ")}
                    </p>
                  ) : null}
                  <p className="text-meta text-steel">{t("traceVerbatim")}</p>
                </div>
              ) : (
                // A prompt version but no model text: half the pair, and the half an
                // Art. 12 reviewer came for. Amber, and stated, rather than an absent row.
                <p className="max-w-prose text-sm text-amber-700">{t("traceLeadAbsent")}</p>
              )}
            </>
          )}
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => onExportDossier(record.candidateRef)}
        disabled={busy}
        className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-sm font-medium text-steel hover:bg-paper hover:text-ink disabled:opacity-50 print:hidden"
      >
        <Download size={12} aria-hidden /> {busy ? t("dossierBusy") : t("dossierExport")}
      </button>
    </div>
  );
}
