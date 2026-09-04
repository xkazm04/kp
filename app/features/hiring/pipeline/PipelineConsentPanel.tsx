"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";
import type { ConsentStatus } from "@/app/_lib/consent";

type ConsentView = {
  consent: {
    givenAt: string | null;
    expiresAt: string | null;
    source: string | null;
    anonymizedAt: string | null;
    status: ConsentStatus;
  };
  events: { id: number; kind: string; detail: string | null; createdAt: string }[];
};

// GDPR "Data & consent" section in the candidate drawer (recruiter-facing). Renders
// the lifecycle status, expiry, source and history. Read-only — the lifecycle is
// driven by apply (grant), the expiry sweep (anonymize) and the candidate erasure
// page.
//
// One-call drawer (perfect-board): the consent snapshot now rides the candidate
// drawer bundle, so the drawer passes it in as `view` and this panel fires NO fetch
// of its own — the drawer opens with a single request. The self-fetch fallback (by
// entryId) is retained for any caller that renders the panel WITHOUT the bundle, so
// the component stays usable standalone.
//
// `loadFailed` closes the hole that left this panel spinning forever: when the DRAWER
// owns the load, a failed bundle fetch leaves `view` null, and null previously meant
// "still loading" — so a GDPR surface that had given up kept implying it was working.
// The drawer now reports its own failure here (it must not re-fetch: the one-call
// bundle is deliberate, and `view` staying non-undefined is what suppresses the
// standalone self-fetch below).
export function ConsentPanel({
  entryId,
  view: bundled,
  loadFailed,
}: {
  entryId: string;
  view?: ConsentView | null;
  loadFailed?: boolean;
}) {
  const t = useTranslations("pipeline.drawer.consent");
  const locale = useLocale();
  // REC-10 — "Expiry reminder sent" is only claimed when a relay can deliver
  // one; without it the reminder is a terminal local-outbox row.
  const relayConfigured = useDeliveryCapability();
  const [fetched, setFetched] = useState<ConsentView | null>(null);
  const [failed, setFailed] = useState(false);
  // Prefer the bundled snapshot; only the fallback path populates `fetched`.
  const view = bundled ?? fetched;

  // The drawer keys this panel by entryId, so it remounts (fresh state) per
  // candidate. When the bundle supplied the snapshot there is nothing to load;
  // otherwise (standalone use) fall back to the dedicated consent read.
  useEffect(() => {
    if (bundled !== undefined) return; // bundle-provided (incl. null) → never self-fetch
    let live = true;
    fetch(`/api/pipeline/${encodeURIComponent(entryId)}/consent`)
      .then((r) => r.json())
      .then((p) => {
        if (!live) return;
        if (p.error) throw new Error(p.error);
        setFetched(p as ConsentView);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [entryId, bundled]);

  const fmt = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso)) : "—";

  // Status → chip colours, through BRAND tokens (moss / dial-amber / coral) and the
  // shared CHIP_QUIET recipe rather than the raw `amber-100 / red-100 / stone-200`
  // shades this panel used to hand-roll. Those shades are mapped in dark mode, so
  // they were legal — but they were a SIXTH palette on a thread that already reads
  // through one, so "amber" here had to be learned separately from the amber the
  // rest of the drawer uses. The reading states are unchanged and deliberately
  // still coloured: "expiring" warns, "expired" is a live compliance failure, and
  // a GDPR surface is the one place a muted-outcome chip would understate.
  const statusTone: Record<ConsentStatus, string> = {
    active: "bg-moss/15 text-moss",
    expiring: "bg-dial-amber/20 text-ink",
    expired: "bg-coral/10 text-coral",
    anonymized: "bg-stone-200 text-steel",
    none: "bg-stone-100 text-steel",
  };
  // next-intl rejects template-literal keys, so resolve status + event labels
  // through explicit literal-key maps (the repo-wide pattern).
  const statusLabel: Record<ConsentStatus, string> = {
    active: t("status.active"),
    expiring: t("status.expiring"),
    expired: t("status.expired"),
    anonymized: t("status.anonymized"),
    none: t("status.none"),
  };
  const eventLabels: Record<string, string> = {
    granted: t("event.granted"),
    renewed: t("event.renewed"),
    expiring_notified: relayConfigured === false ? t("event.expiring_notified_queued") : t("event.expiring_notified"),
    expired: t("event.expired"),
    anonymized: t("event.anonymized"),
    erasure_requested: t("event.erasure_requested"),
    erased: t("event.erased"),
  };

  return (
    <div className="rounded-md border border-stone-200 bg-white p-3">
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <ShieldCheck size={13} /> {t("title")}
      </p>
      {failed || loadFailed ? (
        <p className="mt-2 text-sm text-steel">{t("loadFailed")}</p>
      ) : !view ? (
        <p className="mt-2 text-sm text-steel">{t("loading")}</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-meta font-semibold uppercase ${statusTone[view.consent.status]}`}>
              {statusLabel[view.consent.status]}
            </span>
            {view.consent.source ? (
              <span className="text-meta text-steel">{t("via", { source: view.consent.source })}</span>
            ) : null}
          </div>
          {view.consent.status === "none" ? (
            <p className="mt-2 text-sm text-steel">{t("noneNote")}</p>
          ) : (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-steel">{t("granted")}</dt>
              <dd className="text-ink">{fmt(view.consent.givenAt)}</dd>
              <dt className="text-steel">{t("expires")}</dt>
              <dd className="text-ink">{fmt(view.consent.expiresAt)}</dd>
              {view.consent.anonymizedAt ? (
                <>
                  <dt className="text-steel">{t("anonymized")}</dt>
                  <dd className="text-ink">{fmt(view.consent.anonymizedAt)}</dd>
                </>
              ) : null}
            </dl>
          )}
          {view.events.length > 0 ? (
            <ul className="mt-3 space-y-1 border-t border-stone-100 pt-2" role="list">
              {view.events.map((ev) => (
                <li key={ev.id} className="flex items-baseline justify-between gap-2 text-meta">
                  <span className="text-ink">{eventLabels[ev.kind] ?? ev.kind}</span>
                  <span className="shrink-0 text-steel">{fmt(ev.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
