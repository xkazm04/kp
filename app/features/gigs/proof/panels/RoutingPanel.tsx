"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, KeyValueGrid, Section } from "@/app/_components/kit";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { Gig, GigKpi } from "@/app/_lib/gigs/types";
import { sendJson } from "../../data/useGigsData";
import { useGigsFormat } from "../../data/useGigsFormat";
import { routingView } from "../../logic/routing";
import type { AfterWrite, SourceRow, SpecialistRow } from "../../logic/wire";
import { Panel } from "./Panel";
import { RouteCandidates } from "./RouteCandidates";
import { RouteCards } from "./RouteCards";

// Routing & folder: who the gig goes to and its fit against the bar (RouteCards), the
// workspace folder with Prepare workspace, every specialist by fit with Route here
// (RouteCandidates), and a hire form when nobody fits.

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
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const view = useMemo(() => routingView(gig, specialists, kpi), [gig, specialists, kpi]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [niche, setNiche] = useState(view.suggestedNiche ?? "");
  const [ws, setWs] = useState<{ workdir: string | null; linked: boolean | null; reason: string | null } | null>(null);
  const workdir = gig.workdir ?? ws?.workdir ?? null;
  const linked = gig.personasProjectId !== null || ws?.linked === true;
  const gigUrl = `/api/gigs/${encodeURIComponent(gig.id)}`;

  async function write(url: string, method: "POST" | "PATCH", body: unknown, flash: string | null, fallback: string) {
    if (busy) return null;
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await sendJson(url, method, body);
    setBusy(false);
    if (!res.ok) {
      setError(resolveError(res.body as ApiErrorPayload | null, fallback));
      return null;
    }
    if (flash) setDone(flash);
    await onChanged(null);
    return res.body;
  }
  async function prepare() {
    const body = await write(`${gigUrl}/workspace`, "POST", {}, null, t("workspace.failed"));
    if (!body) return;
    const next = body.gig as Gig | undefined;
    const p = body.personas as { linked?: unknown; reason?: unknown } | undefined;
    setWs({ workdir: next?.workdir ?? null, linked: p?.linked === true, reason: typeof p?.reason === "string" ? p.reason : null });
  }
  const reasonKey = ws?.reason ? `workspace.reason.${ws.reason}` : null;
  const linkReason = reasonKey && t.has(reasonKey as never) ? t(reasonKey as never) : (ws?.reason ?? "").replace(/_/g, " ");

  return (
    <Panel title={t("back.routing")}>
      <RouteCards
        gig={gig}
        view={view}
        busy={busy}
        onUnroute={() => void write(gigUrl, "PATCH", { action: "unroute" }, t("routing.unroutedFlash"), t("routing.failed"))}
        onOpenLane={onOpenLane}
      />

      <Section title={t("workspace.title")} actions={<Button label={t("workspace.prepare")} size="sm" variant="secondary" disabled={busy} onClick={() => void prepare()} />}>
        <KeyValueGrid
          cols={3}
          items={[
            { label: t("workspace.folder"), value: workdir ? <code className="select-all">{workdir}</code> : null, absent: t("workspace.notPrepared") },
            {
              label: t("workspace.project"),
              value: linked ? t("workspace.linked") : ws?.reason ? t("workspace.notLinkedReason", { reason: linkReason }) : t("workspace.notLinked"),
            },
            { label: t("back.wire"), value: source ? `${source.host}${source.pausedReason ? ` · ${fmt.paused(source.pausedReason)}` : ""}` : t("facts.forwarded") },
          ]}
        />
      </Section>

      <RouteCandidates
        arena={gig.arena}
        view={view}
        busy={busy}
        onRoute={(c) => void write(gigUrl, "PATCH", { action: "route", specialistId: c.specialistId }, t("routing.routedFlash", { name: c.specialist.name }), t("routing.failed"))}
      />

      {view.noFit && !view.lock ? (
        <form
          className="hire-inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (!niche.trim()) {
              setError(t("routing.nicheRequired"));
              return;
            }
            void write("/api/gigs/specialists", "POST", { arena: gig.arena, niche: niche.trim() }, t("routing.hired"), t("routing.hireFailed"));
          }}
        >
          <p>
            <b>{t("routing.noFitTitle")}</b> {t("routing.noFitBody")}
          </p>
          <label>
            <span>{t("routing.nicheLabel")}</span>
            <input className="field" value={niche} maxLength={80} onChange={(e) => setNiche(e.target.value)} />
          </label>
          <Button label={t("routing.hire")} variant="primary" disabled={busy} type="submit" />
        </form>
      ) : null}

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
