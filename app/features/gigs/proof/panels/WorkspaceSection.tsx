"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, KeyValueGrid, Section } from "@/app/_components/kit";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { Gig } from "@/app/_lib/gigs/types";
import { sendJson } from "../../data/useGigsData";
import { useGigsFormat } from "../../data/useGigsFormat";
import type { AfterWrite, SourceRow } from "../../logic/wire";

// The gig's workspace (the Pairing tab and the legacy routing view): its folder on disk,
// whether the Personas project is linked, the wire it came from, and Prepare workspace.

export function WorkspaceSection({ gig, source, onChanged }: { gig: Gig; source: SourceRow | null; onChanged: AfterWrite }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ws, setWs] = useState<{ workdir: string | null; linked: boolean | null; reason: string | null } | null>(null);
  const workdir = gig.workdir ?? ws?.workdir ?? null;
  const linked = gig.personasProjectId !== null || ws?.linked === true;

  async function prepare() {
    setBusy(true);
    setError(null);
    const res = await sendJson(`/api/gigs/${encodeURIComponent(gig.id)}/workspace`, "POST", {});
    setBusy(false);
    const body = res.body ?? {};
    if (!res.ok) {
      setError(resolveError(res.body as ApiErrorPayload | null, t("workspace.failed")));
      return;
    }
    const next = body.gig as Gig | undefined;
    const p = body.personas as { linked?: unknown; reason?: unknown } | undefined;
    setWs({ workdir: next?.workdir ?? null, linked: p?.linked === true, reason: typeof p?.reason === "string" ? p.reason : null });
    await onChanged(null);
  }
  const reasonKey = ws?.reason ? `workspace.reason.${ws.reason}` : null;
  const linkReason = reasonKey && t.has(reasonKey as never) ? t(reasonKey as never) : (ws?.reason ?? "").replace(/_/g, " ");

  return (
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
      {busy ? (
        <p role="status" className="t-meta">
          {t("workspace.preparing")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
    </Section>
  );
}
