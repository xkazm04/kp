"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_GHOST, BTN_SECONDARY, CHIP_QUIET, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { Badge } from "@/app/_components/Badge";
import { Checkbox } from "@/app/_components/Checkbox";
import type { AtsConnectionPublic } from "@/app/_lib/ats/connections-store";

// connect-the-integrations — one stored ATS connection, plus its removal confirmation.
//
// The confirm step exists for the links question, not for ceremony: dropping the
// external-id links re-imports every application as new on the next connect (duplicating
// the pipeline), keeping them re-adopts bindings to entries that may since have been
// erased. The route refuses to default that, so the UI asks it — unchecked, matching the
// route's own `forgetLinks` opt-in.

export function IntegrationsAtsRow({
  connection,
  label,
  busy,
  onRemove,
}: {
  connection: AtsConnectionPublic;
  label: string;
  busy: boolean;
  onRemove: (forgetLinks: boolean) => void;
}) {
  const t = useTranslations("integrations.ats");
  const [confirming, setConfirming] = useState(false);
  const [forgetLinks, setForgetLinks] = useState(false);

  return (
    <li className={`${PANEL_SUNKEN} p-3`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-base font-semibold text-ink">{label}</span>
        <Badge
          tone={connection.enabled ? "positive" : "neutral"}
          label={connection.enabled ? t("statusEnabled") : t("statusParked")}
        />
        <Badge
          tone={connection.hasToken ? "positive" : "caution"}
          label={connection.hasToken ? t("tokenSet") : t("tokenMissing")}
        />
        {connection.baseUrl ? <span className="break-all font-mono text-sm text-steel">{connection.baseUrl}</span> : null}
        {connection.updatedAt ? (
          <span className={CHIP_QUIET}>{t("updatedAt", { date: new Date(connection.updatedAt).toLocaleDateString() })}</span>
        ) : null}
        <button
          type="button"
          onClick={() => setConfirming((v) => !v)}
          disabled={busy}
          className={`${BTN_GHOST} ml-auto h-8 px-2 text-sm`}
        >
          {confirming ? t("cancel") : t("remove")}
        </button>
      </div>

      {confirming ? (
        <div className="mt-3 border-t border-stone-200 pt-3">
          <p className="text-sm text-steel">{t("removeConfirm", { provider: label })}</p>
          <label className="mt-2 flex w-fit cursor-pointer items-start gap-2 text-sm text-steel">
            <Checkbox checked={forgetLinks} onChange={(e) => setForgetLinks(e.target.checked)} />
            <span>
              <span className="block text-ink">{t("forgetLinksLabel")}</span>
              <span className="block text-meta text-steel">{t("forgetLinksHelp")}</span>
            </span>
          </label>
          <button
            type="button"
            onClick={() => onRemove(forgetLinks)}
            disabled={busy}
            className={`${BTN_SECONDARY} mt-3 h-8 px-3 text-sm text-coral`}
          >
            {busy ? t("removing") : t("removeConfirmAction")}
          </button>
        </div>
      ) : null}
    </li>
  );
}
