"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { BTN_GHOST, BTN_SECONDARY, CHIP_QUIET, META_LABEL, NOTICE } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { BillingAlertResolution, BillingAlertView } from "@/app/_lib/billing/alerts";

// Billing tab — the org's open billing alerts (docs/features/billing/README.md →
// "Billing alerts"). Renders nothing when there are none: an empty worklist is not a
// section. Each alert is a coded sentence from the catalog (never the server's text);
// the provider detail and the operator-only kinds arrive ONLY for the home-org
// operator, because the server's projection (app/_lib/billing/alerts.ts) decided so —
// this component shows what it was given and adds no audience rule of its own.
//
// Closing is two honest outcomes: "Mark fixed" (the cause was repaired) and "Dismiss"
// (noise). Neither changes the plan or any allowance — the POST writes only the alert.
export function BillingAlertsPanel({ alerts, onResolved }: { alerts: BillingAlertView[]; onResolved: () => void }) {
  const t = useTranslations("billing.alerts");
  const format = useFormatter();
  const errMsg = useErrorMessage();
  const [busy, setBusy] = useState<number | null>(null);
  const [failure, setFailure] = useState<{ id: number; text: string } | null>(null);

  if (alerts.length === 0) return null;

  const resolve = async (id: number, resolution: BillingAlertResolution) => {
    if (busy !== null) return;
    setBusy(id);
    setFailure(null);
    try {
      const r = await fetch(`/api/billing/alerts/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { code?: string; error?: string };
        // Already closed elsewhere: the worklist is stale, not broken — re-read it.
        if (body.code === "BILLING_ALERT_NOT_OPEN") onResolved();
        else setFailure({ id, text: errMsg(body, t("failed")) });
        return;
      }
      onResolved();
    } catch {
      setFailure({ id, text: t("failed") });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="billing-alerts-title" className={`${NOTICE("amber")} p-4`}>
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="shrink-0" aria-hidden />
        <h3 id="billing-alerts-title" className="text-sm font-semibold">
          {t("title", { count: alerts.length })}
        </h3>
      </div>
      <ul className="mt-3 space-y-3">
        {alerts.map((alert) => (
          <li key={alert.id} className="border-t border-amber-300 pt-3 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm">{t(`code.${alert.code}`)}</p>
                <p className={`mt-1 ${META_LABEL}`}>
                  {t("raised", { date: format.dateTime(new Date(alert.createdAt), { dateStyle: "long" }) })}
                  {alert.audience === "operator" ? <span className={`ml-2 ${CHIP_QUIET}`}>{t("operatorOnly")}</span> : null}
                </p>
                {alert.detail ? <p className="mt-1 break-words font-mono text-xs">{alert.detail}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => resolve(alert.id, "fixed")}
                  disabled={busy !== null}
                  className={`${BTN_SECONDARY} h-8 px-3 text-sm`}
                >
                  {busy === alert.id ? t("working") : t("fixed")}
                </button>
                <button
                  type="button"
                  onClick={() => resolve(alert.id, "dismissed")}
                  disabled={busy !== null}
                  className={`${BTN_GHOST} h-8 px-3 text-sm`}
                >
                  {t("dismiss")}
                </button>
              </div>
            </div>
            {failure?.id === alert.id ? (
              <p role="alert" className="mt-2 text-sm text-coral">
                {failure.text}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
