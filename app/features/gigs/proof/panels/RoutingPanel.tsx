"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { Gig, GigKpi } from "@/app/_lib/gigs/types";
import { sendJson } from "../../data/useGigsData";
import { routingView } from "../../logic/routing";
import type { AfterWrite, SourceRow, SpecialistRow } from "../../logic/wire";
import { Panel } from "./Panel";
import { RouteCandidates } from "./RouteCandidates";
import { RouteCards } from "./RouteCards";
import { WorkspaceSection } from "./WorkspaceSection";

// The LEGACY routing view, kept on the Pairing tab for a gig that already ran through a
// niche specialist and has no persona of its own (PairingPanel.tsx decides): who the gig
// goes to and its fit against the bar (RouteCards), the workspace folder, and every
// specialist by fit with Route here (RouteCandidates). Niche specialists are no longer
// hired (gig-mastery S2: one persona per gig); they finish their open drafts and retire.

export function RoutingPanel({
  gig,
  source,
  specialists,
  kpi,
  onChanged,
  onOpenLane,
}: {
  gig: Gig;
  source: SourceRow | null;
  specialists: readonly SpecialistRow[];
  kpi: GigKpi | null;
  onChanged: AfterWrite;
  onOpenLane: () => void;
}) {
  const t = useTranslations("gigs");
  const resolveError = useErrorMessage();
  const view = useMemo(() => routingView(gig, specialists, kpi), [gig, specialists, kpi]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const gigUrl = `/api/gigs/${encodeURIComponent(gig.id)}`;

  async function write(body: unknown, flash: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await sendJson(gigUrl, "PATCH", body);
    setBusy(false);
    if (!res.ok) {
      setError(resolveError(res.body as ApiErrorPayload | null, t("routing.failed")));
      return;
    }
    setDone(flash);
    await onChanged(null);
  }

  return (
    <Panel title={t("back.routing")} sub={t("pairing.legacySub")}>
      <RouteCards gig={gig} view={view} busy={busy} onUnroute={() => void write({ action: "unroute" }, t("routing.unroutedFlash"))} onOpenLane={onOpenLane} />

      <WorkspaceSection gig={gig} source={source} onChanged={onChanged} />

      <RouteCandidates
        arena={gig.arena}
        view={view}
        busy={busy}
        onRoute={(c) => void write({ action: "route", specialistId: c.specialistId }, t("routing.routedFlash", { name: c.specialist.name }))}
      />

      {busy ? (
        <p role="status" className="t-meta">
          {t("routing.working")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="note-line">
          {done}
        </p>
      ) : null}
    </Panel>
  );
}
