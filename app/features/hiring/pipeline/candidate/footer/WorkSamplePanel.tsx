"use client";

// The footer tray's "Send work sample" (CX S43): send this role's approved assignment to
// THIS candidate — the same send a homework column makes on arrival — for a board that
// has no homework column. The click is the human gate. Every answer is rendered as what
// happened (workSample.ts); a queued letter shows the link to copy, never a green "sent".

import { useState } from "react";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY, NOTICE } from "@/app/_components/ui/recipes";
import { copyText } from "@/app/_lib/export-utils";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { TokenLinkPanel } from "../../PipelineTokenLink";
import { workSampleView, type WorkSampleResponse, type WorkSampleView } from "./workSample";

export function WorkSamplePanel({ entry }: { entry: Entry }) {
  const t = useTranslations("pipeline.candidate.footer.workSample");
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<WorkSampleView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const send = async () => {
    setBusy(true);
    setError(null);
    setView(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/pipeline/${encodeURIComponent(entry.id)}/work-sample`, { method: "POST" });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok || !body) setError(errorMessage(body as ApiErrorPayload | null, t("sendFailed")));
      else setView(workSampleView(body as WorkSampleResponse));
    } catch {
      // best-effort: the line below says nothing was sent and the button stays to retry
      setError(t("sendFailed"));
    } finally {
      setBusy(false);
    }
  };

  const fullUrl = view?.url ? publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "") + view.url : "";
  const link = {
    data: view?.url ? { url: view.url } : null,
    fullUrl,
    copied,
    copy: async () => {
      if (await copyText(fullUrl)) setCopied(true);
    },
  };

  return (
    <section aria-label={t("aria")} aria-busy={busy} className="space-y-2.5">
      <p className="text-meta text-steel">{t("intro", { name: entry.candidateLabel })}</p>
      {view === null ? (
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy}
          aria-busy={busy}
          className={`${BTN_PRIMARY} h-9 cursor-pointer gap-1.5 px-4 text-meta disabled:cursor-wait`}
        >
          <ClipboardCheck size={14} aria-hidden />
          {busy ? t("sending") : t("send")}
        </button>
      ) : null}
      {error ? (
        <p role="alert" className={`${NOTICE("critical")} px-2.5 py-1.5 text-meta`}>
          {error}
        </p>
      ) : null}
      {view ? (
        <>
          <p
            role={view.tone === "ok" ? "status" : "alert"}
            className={view.tone === "ok" ? "text-meta text-moss" : `${NOTICE(view.tone)} px-2.5 py-1.5 text-meta`}
          >
            {t(`outcome.${view.line}`)}
            {view.assignmentsHref ? (
              <>
                {" "}
                <Link href={view.assignmentsHref} className="focus-ring rounded-md font-semibold underline">
                  {view.assignmentsAction === "reopen" ? t("reopenAssignment") : t("createAssignment")}
                </Link>
              </>
            ) : null}
          </p>
          <TokenLinkPanel link={link} />
        </>
      ) : null}
    </section>
  );
}
