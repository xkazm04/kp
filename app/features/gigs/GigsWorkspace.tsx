"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FolderCog } from "lucide-react";
import { BTN_SECONDARY, META_LABEL, NOTICE, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { Gig } from "@/app/_lib/gigs/types";
import type { AfterWrite } from "./gigsLogic";
import { Absent } from "./GigsFacts";
import { sendJson } from "./useGigsData";

// The gig's workspace as one compact row (docs/features/gigs/README.md "Workspaces and
// projects"): the folder on disk the specialist's run works in (selectable, so the operator
// can copy it into a file manager), whether the Personas project rooted there is linked,
// and "Prepare workspace" (POST /api/gigs/[id]/workspace). Dispatch prepares it too; this is
// for wanting the folder before that. A reason the project is not linked is only known from
// a prepare's answer, so it shows after one and reads plain "not linked" otherwise.

type PersonasLink = { linked: true } | { linked: false; reason: string };

export function GigWorkspaceRow({ gig, onChanged }: { gig: Gig; onChanged: AfterWrite }) {
  const t = useTranslations("gigs");
  const resolveError = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The last prepare's answer, kept per gig (the page is reused across gigs by key).
  const [answer, setAnswer] = useState<{ gigId: string; workdir: string | null; link: PersonasLink } | null>(null);
  const mine = answer && answer.gigId === gig.id ? answer : null;
  const workdir = gig.workdir ?? mine?.workdir ?? null;
  const linked = gig.personasProjectId !== null || mine?.link.linked === true;
  const reason = mine && !mine.link.linked ? mine.link.reason : null;

  async function prepare() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await sendJson(`/api/gigs/${encodeURIComponent(gig.id)}/workspace`, "POST", {});
    setBusy(false);
    if (!res.ok) {
      setError(resolveError(res.body as ApiErrorPayload | null, t("workspace.failed")));
      return;
    }
    const next = res.body?.gig as Gig | undefined;
    const personas = res.body?.personas as { linked?: unknown; reason?: unknown } | undefined;
    setAnswer({
      gigId: gig.id,
      workdir: next?.workdir ?? null,
      link: personas?.linked === true ? { linked: true } : { linked: false, reason: typeof personas?.reason === "string" ? personas.reason : "" },
    });
    await onChanged(null);
  }

  const reasonKey = `workspace.reason.${reason}` as Parameters<typeof t>[0];
  const reasonText = reason ? (t.has(reasonKey) ? t(reasonKey) : reason.replace(/_/g, " ")) : null;

  return (
    <section aria-labelledby={`workspace-${gig.id}`} className="space-y-2">
      <div className={`${PANEL_SUNKEN} flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 text-sm`}>
        <h3 id={`workspace-${gig.id}`} className={META_LABEL}>
          {t("workspace.title")}
        </h3>
        <p className="min-w-0 flex-1 basis-64 text-steel">
          {t("workspace.folder")}{" "}
          {workdir ? (
            <code title={t("workspace.hint")} className="select-all break-all font-mono text-xs text-ink">
              {workdir}
            </code>
          ) : (
            <Absent>{t("workspace.notPrepared")}</Absent>
          )}
        </p>
        <p className="text-steel">
          {t("workspace.project")}:{" "}
          <span className={linked ? "font-semibold text-ink" : "text-ink"}>
            {linked ? t("workspace.linked") : reasonText ? t("workspace.notLinkedReason", { reason: reasonText }) : t("workspace.notLinked")}
          </span>
        </p>
        <button type="button" disabled={busy} onClick={() => void prepare()} className={`${BTN_SECONDARY} h-8 px-3 text-sm`}>
          <FolderCog size={14} aria-hidden className={busy ? "animate-pulse motion-reduce:animate-none" : undefined} /> {t("workspace.prepare")}
        </button>
      </div>
      {busy ? (
        <p role="status" className="text-sm text-steel">
          {t("workspace.preparing")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={`${NOTICE("critical")} px-3 py-2 text-sm`}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
