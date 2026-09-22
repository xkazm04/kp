"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, ExternalLink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { BTN_PRIMARY, BTN_SECONDARY, CARD_PAD, DIVIDER, META_LABEL, NOTICE, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { calendarScopeSlug } from "@/app/_lib/calendar/callback-status";
import type { CalendarConnection } from "@/app/_lib/calendar/token-store";
import { IntegrationsCallbackBanner } from "./IntegrationsCallbackBanner";

// connect-the-integrations — connect / inspect / disconnect the workspace's Google
// Calendar. Unconfigured deployments name the env vars instead of a Connect button
// that would 503. Connect is a top-level <a> (state cookie + 302). Disconnect is
// confirm-gated: the DELETE revokes at Google first, then drops the row, and
// `revokedAtGoogle: false` is surfaced so the operator can withdraw the grant.

type Payload = {
  configured: boolean;
  connection: CalendarConnection | null;
  redirectUriToRegister: string;
  /** Upcoming confirmed interviews whose calendar write failed — the cost of a dead grant. */
  unsyncedUpcoming?: number;
};

const START_URL = "/api/calendar/google/start";

export function IntegrationsCalendarPanel() {
  const t = useTranslations("integrations.calendar");
  // The reader's locale, not the browser's — see IntegrationsAtsRow.
  const format = useFormatter();
  const { data, error, reload } = useJsonFetch<Payload>("/api/calendar/google", t("loadFailed"));
  const params = useSearchParams();

  // The OAuth outcome arrives as ?calendar=<code>. Captured on the FIRST render (a lazy
  // initial state, not an effect — the effect only strips the URL, so nothing re-renders
  // synchronously) and then removed from the address bar, the `arm` precedent: a reload or
  // a shared link must not replay a stale "connected" banner over a connection that has
  // since been disconnected.
  const [callback] = useState<string | null>(() => params.get("calendar"));
  useEffect(() => {
    if (!callback) return;
    const next = new URLSearchParams(window.location.search);
    if (!next.has("calendar")) return;
    next.delete("calendar");
    const qs = next.toString();
    window.history.replaceState(null, "", qs ? `/?${qs}` : "/");
  }, [callback]);

  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  const connection = data?.connection ?? null;
  const connected = !!connection?.connected;
  const missing = connection?.missingScopes ?? [];

  const disconnect = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch("/api/calendar/google", { method: "DELETE" });
      const p = (await r.json().catch(() => null)) as { ok?: boolean; revokedAtGoogle?: boolean } | null;
      if (!r.ok || !p?.ok) throw new Error();
      setNote({ text: p.revokedAtGoogle ? t("disconnected") : t("disconnectedNotRevoked"), ok: !!p.revokedAtGoogle });
      setConfirming(false);
      reload();
    } catch {
      setNote({ text: t("disconnectFailed"), ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${PANEL} ${CARD_PAD}`}>
      <h3 className="flex items-center gap-2 font-serif text-h3 text-ink">
        <CalendarCheck size={16} className="text-coral" aria-hidden /> {t("title")}
      </h3>
      <p className="mt-1 max-w-3xl text-sm text-steel">{t("intro")}</p>

      {callback ? (
        <div className="mt-3">
          <IntegrationsCallbackBanner code={callback} />
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-base text-coral">{error}</p>
          <button type="button" onClick={reload} className={`${BTN_SECONDARY} h-8 px-3 text-sm`}>
            {t("retry")}
          </button>
        </div>
      ) : null}

      {!data && !error ? <div className="reveal-quiet mt-3 min-h-[7rem]" aria-hidden /> : null}

      {data && !data.configured ? (
        <div className={`${PANEL_SUNKEN} mt-3 p-4`}>
          <p className="text-base font-semibold text-ink">{t("notConfiguredTitle")}</p>
          <p className="mt-1 text-sm text-steel">{t("notConfiguredBody")}</p>
          <ul className="mt-2 space-y-0.5 font-mono text-sm text-ink">
            <li>GOOGLE_OAUTH_CLIENT_ID</li>
            <li>GOOGLE_OAUTH_CLIENT_SECRET</li>
          </ul>
          <p className={`${META_LABEL} mt-3`}>{t("redirectUriLabel")}</p>
          <p className="break-all font-mono text-sm text-ink">{data.redirectUriToRegister}</p>
        </div>
      ) : null}

      {data && data.configured && !connected ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <a href={START_URL} className={`${BTN_PRIMARY} h-9 px-4 text-sm`}>
            <ExternalLink size={14} aria-hidden /> {t("connect")}
          </a>
          <p className="text-sm text-steel">{t("connectHint")}</p>
        </div>
      ) : null}

      {data && connected && connection ? (
        <div className={`${DIVIDER} mt-4 pt-4`}>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className={META_LABEL}>{t("accountLabel")}</dt>
              <dd className="mt-0.5 break-all text-base text-ink">{connection.accountEmail ?? t("accountUnknown")}</dd>
            </div>
            <div>
              <dt className={META_LABEL}>{t("calendarLabel")}</dt>
              <dd className="mt-0.5 break-all font-mono text-sm text-ink">{connection.calendarId}</dd>
            </div>
            <div>
              <dt className={META_LABEL}>{t("connectedAtLabel")}</dt>
              <dd className="mt-0.5 text-base text-ink">
                {connection.connectedAt ? format.dateTime(new Date(connection.connectedAt), { dateStyle: "medium", timeStyle: "short" }) : "—"}
              </dd>
            </div>
          </dl>

          {/* A DEAD grant (revoked at Google, or a stored token that no longer decrypts)
              still reads as connected, so it is named here, with its cost and the one
              action that fixes it. Before this the card looked healthy while every
              lookup failed and every new interview missed the calendar. */}
          {connection.health !== "ok" ? (
            <div role="alert" className={`${NOTICE("critical")} mt-4 p-3`}>
              <p className="text-base font-semibold">
                {connection.health === "revoked" ? t("grant.revokedTitle") : t("grant.undecryptableTitle")}
              </p>
              <p className="mt-0.5 text-sm">
                {t(connection.health === "revoked" ? "grant.revokedBody" : "grant.undecryptableBody", {
                  date: connection.healthAt
                    ? format.dateTime(new Date(connection.healthAt), { dateStyle: "medium", timeStyle: "short" })
                    : "—",
                })}
              </p>
              {(data.unsyncedUpcoming ?? 0) > 0 ? (
                <p className="mt-1 text-sm font-semibold">{t("grant.unsynced", { count: data.unsyncedUpcoming ?? 0 })}</p>
              ) : null}
              <a href={START_URL} className={`${BTN_PRIMARY} mt-3 h-8 px-3 text-sm`}>
                <ExternalLink size={14} aria-hidden /> {t("grant.reconnectAction")}
              </a>
            </div>
          ) : null}

          {missing.length > 0 ? (
            <div role="alert" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
              <p className="text-base font-semibold">{t("partialTitle")}</p>
              <p className="mt-0.5 text-sm">{t("partialBody")}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {missing.map((scope) => (
                  <li key={scope}>
                    <span className="font-semibold">{t(`scopes.${calendarScopeSlug(scope)}` as Parameters<typeof t>[0])}</span>
                    <span className="ml-2 break-all font-mono opacity-80">{scope}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm">{t("partialFix")}</p>
              <a href={START_URL} className={`${BTN_SECONDARY} mt-3 h-8 px-3 text-sm`}>
                {t("reconnect")}
              </a>
            </div>
          ) : null}

          {confirming ? (
            <div className="mt-4 border-t border-stone-200 pt-4">
              <p className="text-sm text-steel">{t("disconnectConfirm")}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void disconnect()}
                  disabled={busy}
                  className={`${BTN_SECONDARY} h-9 px-4 text-sm text-coral`}
                >
                  {busy ? t("disconnecting") : t("disconnectConfirmAction")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className={`${BTN_SECONDARY} h-9 px-4 text-sm`}
                >
                  {t("disconnectCancel")}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => setConfirming(true)} disabled={busy} className={`${BTN_SECONDARY} h-9 px-4 text-sm`}>
                {t("disconnect")}
              </button>
              <p className="text-sm text-steel">{t("disconnectHint")}</p>
            </div>
          )}
        </div>
      ) : null}

      {note ? (
        // A failed disconnect, and the revoke-failed case ("the grant is still
        // live at Google, go withdraw it yourself"), are both things the operator
        // must act on — assertive, per this tab's convention.
        <p role={note.ok ? "status" : "alert"} className={`mt-3 text-sm font-medium ${note.ok ? "text-moss" : "text-coral"}`}>
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
