"use client";

// CX S45 - one row's work-sample result on the Docket's role level, beside the fit score:
// "Work sample 72 · held", or "—" with the reason it has none ("not sent"). The number is
// the row's one emphasis here; how it was graded, what was watched and what the debrief
// found are on demand in the tip (KitTipLayer, hover and focus). Absence is never 0.
import { useTranslations } from "next-intl";
import type { RoleViewWorkSample } from "@/app/_lib/role-decision-view";
import type { RoleWorkSamples } from "./useRoleWorkSamples";

export function DocketWorkSample({ entryId, samples }: { entryId: string; samples: RoleWorkSamples }) {
  const t = useTranslations("decisions.docket.ws");
  if (samples.status === "none") return null;
  if (samples.status === "loading") return <span className="dk-ws" aria-busy="true" />;
  if (samples.status === "failed") {
    return (
      <span className="dk-ws dk-ws--none" data-tip={t("tip.failed")} tabIndex={0}>
        <span className="dk-ws__l">{t("label")}</span> — {t("failed")}
      </span>
    );
  }
  const ws: RoleViewWorkSample | undefined = samples.byEntry.get(entryId);
  // An entry the view does not list (it closed out between the two reads) shows nothing.
  if (!ws) return <span className="dk-ws" />;
  if (ws.transferScore == null) {
    const reason = ws.reason ?? "not_evaluated";
    return (
      <span className="dk-ws dk-ws--none" data-tip={t(`tip.${reason}`)} tabIndex={0}>
        <span className="dk-ws__l">{t("label")}</span> — {t(`none.${reason}`)}
      </span>
    );
  }
  const l = ws.ladder;
  const tip = [
    t("tip.score", { score: ws.transferScore }),
    ws.grading === "template" ? t("tip.template") : t("tip.graded"),
    l?.watched.acts != null ? t("tip.watched", { count: l.watched.acts }) : l?.watched.reason === "not_watched" ? t("tip.notWatched") : null,
    l?.defended.total != null ? t("tip.defended", { supported: l.defended.supported, total: l.defended.total }) : null,
    l?.hold === "held" ? t("tip.held") : l?.hold === "cleared" ? t("tip.cleared") : null,
  ]
    .filter(Boolean)
    .join(" ");
  const marks = [l?.hold === "held" ? t("held") : l?.hold === "cleared" ? t("cleared") : null, ws.grading === "template" ? t("template") : null].filter(Boolean);
  return (
    <span className="dk-ws" data-hold={l?.hold ?? "none"} data-tip={tip} tabIndex={0}>
      <span className="dk-ws__l">{t("label")}</span> <b className="nums">{ws.transferScore}</b>
      {marks.length > 0 ? <span className="dk-ws__m"> · {marks.join(" · ")}</span> : null}
    </span>
  );
}
