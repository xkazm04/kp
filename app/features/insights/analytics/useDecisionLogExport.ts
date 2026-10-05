"use client";

// The wiring half of the decision-log export: next-intl, the comms capability
// bit, the fetch loop and the download, around the pure builder in
// decisionLogCsv.ts.
//
// It is a hook rather than a component because the two surfaces that offer this
// file want different chrome — the Analytics tab has a page button beside a
// whole-trail button in a table header, the Decisions tab has one button in a
// header full of role filters — but must produce the SAME bytes. Everything that
// decides what is IN the file lives here; everything that decides how the button
// looks stays at the call site.
import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { downloadFile, toCsv } from "@/app/_lib/export-utils";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";
import { kindLabel, waveReasonText, type CohortProvenance } from "@/app/_lib/decision-attribution";
import { apiErrorPayload, LocalizedFailure, localizedFailureMessage } from "./analyticsFetchError";
import {
  actorDisplayName,
  formatAuditTime,
  resolveAuditTimeZone,
  type Decision,
  type DecisionPage,
} from "./analyticsDecisionLogTypes";
import {
  collectDecisionTrail,
  decisionCsvRows,
  TRAIL_FETCH_LIMIT,
  type DecisionCsvLabels,
  type DecisionCsvRender,
} from "./decisionLogCsv";

export type DecisionLogExport = {
  /** The IANA zone this surface renders audit timestamps in. Both the screen and
   *  the file must use it, or they are two different claims about one instant. */
  zone: string;
  /** Serialize a list already in hand (the page the reader is looking at). */
  csvFor: (list: Decision[], scope: { scope: string; filters: string }) => string;
  /** Page `url` to the end, then download one file. Never downloads a partial
   *  trail: a read that fails leaves `trailError` set and no file. */
  exportTrail: (opts: {
    url: (offset: number, limit: number) => string;
    filters: string;
    filename?: string;
  }) => Promise<void>;
  trailBusy: boolean;
  trailError: string | null;
};

export function useDecisionLogExport(): DecisionLogExport {
  const t = useTranslations("analytics.log");
  const tWave = useTranslations("decisions.wave");
  const locale = useLocale();
  // §1.1 — a failure is shown from its machine code, in the reader's language.
  const errMsg = useErrorMessage();
  const relayConfigured = useDeliveryCapability();

  const [trailBusy, setTrailBusy] = useState(false);
  const [trailError, setTrailError] = useState<string | null>(null);

  // UAT LUC-ANA-7 — ONE clock per surface, resolved once.
  const zone = useMemo(() => resolveAuditTimeZone(), []);

  const labels: DecisionCsvLabels = useMemo(
    () => ({
      title: t("title"),
      provExport: t("provExport"),
      provGenerated: t("provGenerated"),
      provZone: t("provZone"),
      provLocale: t("provLocale"),
      provScope: t("provScope"),
      provFilters: t("provFilters"),
      timeLocal: t("csvTimeLocal", { zone }),
      timeIso: t("csvTimeIso"),
      attribution: t("csvAttribution"),
      actor: t("csvActor"),
      kind: t("csvKind"),
      candidate: t("csvCandidate"),
      role: t("csvRole"),
      cohort: t("csvCohort"),
      detail: t("csvDetail"),
    }),
    [t, zone]
  );

  const render: DecisionCsvRender = useMemo(() => {
    const cohortText = (c: CohortProvenance): string =>
      t(c.source === "selection" ? "cohortSelection" : "cohortTop", { compared: c.compared, field: c.field });
    return {
      time: (iso) => formatAuditTime(iso, locale, zone),
      attribution: (bucket) => t(`attribution.${bucket}` as Parameters<typeof t>[0]),
      actor: (actor) => actorDisplayName(actor, t("actorNotIdentified")),
      kind: (kind) => kindLabel(t, kind, { relayConfigured }),
      cohort: cohortText,
      // Same precedence the table's cells render: the sealed structured reason,
      // else a resolved rematch counterpart, else the raw event detail. A file
      // that showed a different string than the row above it would make the
      // export unusable for exactly the reconciliation it exists for.
      detail: (d) =>
        (d.reason ? waveReasonText(tWave, d.reason) : null) ??
        (d.counterpart ? t("csvRematchCounterpart", { name: d.counterpart.label }) : d.detail),
    };
  }, [t, tWave, locale, zone, relayConfigured]);

  const csvFor = useCallback(
    (list: Decision[], scope: { scope: string; filters: string }) =>
      toCsv(
        decisionCsvRows(list, labels, render, {
          generatedAt: formatAuditTime(new Date().toISOString(), locale, zone),
          zone,
          locale,
          scope: scope.scope,
          filters: scope.filters,
        })
      ),
    [labels, render, locale, zone]
  );

  const exportTrail = useCallback(
    async ({ url, filters, filename }: { url: (offset: number, limit: number) => string; filters: string; filename?: string }) => {
      setTrailBusy(true);
      setTrailError(null);
      try {
        const { rows, total, complete } = await collectDecisionTrail(async (offset, limit) => {
          const res = await fetch(url(offset, limit));
          // The route answers TOO_MANY_REQUESTS (429, wait and retry) and
          // DECISION_LOG_LOAD_FAILED (500, the read fell over) with codes; a raw
          // status collapses both into one red line and never reaches a reader.
          if (!res.ok) throw new LocalizedFailure(errMsg(await apiErrorPayload(res), t("exportTrailFailed")));
          const body = (await res.json()) as DecisionPage & { code?: string };
          if (body.error) throw new LocalizedFailure(errMsg(body, t("exportTrailFailed")));
          return body;
        }, { limit: TRAIL_FETCH_LIMIT });
        // A run that hit the page ceiling really did stop early. The file still
        // downloads — the rows it holds are true — but it may not call itself the
        // whole trail, or the one artifact an auditor trusts starts overstating
        // its own coverage the day a workspace outgrows the ceiling.
        const scope = complete
          ? t("scopeTrail", { rows: rows.length, total })
          : t("scopeTrailCapped", { rows: rows.length, total });
        downloadFile(filename ?? "kp-decision-log-trail.csv", csvFor(rows, { scope, filters }), "text/csv");
      } catch (err) {
        // Truthful failure: a partial file silently named "whole trail" is exactly
        // the artifact an auditor must never be handed, so nothing is written and
        // WHY it failed survives the catch.
        setTrailError(localizedFailureMessage(err, t("exportTrailFailed")));
      } finally {
        setTrailBusy(false);
      }
    },
    [csvFor, errMsg, t]
  );

  return { zone, csvFor, exportTrail, trailBusy, trailError };
}
