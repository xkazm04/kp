"use client";

import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import type { Flash } from "./useGigsNav";

// The tab's lines above the page: the one flash (a write's sentence, or its failure), the
// load failure with Retry, and the empty front page that points at the wires.

export function TabNotices({ flash, loadError, onDismiss, onRetry }: { flash: Flash | null; loadError: string | null; onDismiss: () => void; onRetry: () => void }) {
  const t = useTranslations("gigs");
  return (
    <>
      {flash ? (
        <div role={flash.tone === "critical" ? "alert" : "status"} className={`flash${flash.tone === "critical" ? " critical" : ""}`}>
          <span>{flash.text}</span>
          <button type="button" className="btn ghost iconbtn quiet" aria-label={t("detail.dismiss")} onClick={onDismiss}>
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}
      {loadError ? (
        <div className="flash critical" role="alert">
          <span>{loadError}</span>
          <button type="button" className="btn quiet" onClick={onRetry}>
            {t("retry")}
          </button>
        </div>
      ) : null}
    </>
  );
}

export function EmptyFront({ noSources, onToWires }: { noSources: boolean; onToWires: () => void }) {
  const t = useTranslations("gigs");
  return (
    <div className="stamp-wrap">
      <div className="stamp calm" role="note">
        <span className="s1">{t("empty.title")}</span>
        <span className="s2">{noSources ? t("empty.noSources") : t("empty.noGigs")}</span>
      </div>
      <button type="button" className="btn" onClick={onToWires}>
        {t("empty.toSources")}
      </button>
    </div>
  );
}
