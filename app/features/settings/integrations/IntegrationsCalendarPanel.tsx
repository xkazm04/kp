"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, ExternalLink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { BTN_PRIMARY, BTN_SECONDARY, CARD_PAD, DIVIDER, META_LABEL, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { calendarScopeSlug } from "@/app/_lib/calendar/callback-status";
import type { CalendarConnection } from "@/app/_lib/calendar/token-store";
import { IntegrationsCallbackBanner } from "./IntegrationsCallbackBanner";

// connect-the-integrations — connect / inspect / disconnect the workspace's Google
// Calendar. The engine (OAuth, encrypted token store, revoke-first delete) shipped in W1
// with no caller; this is the door.
//
// Three states, and the un-configured one matters most: when the deployment has no
// GOOGLE_OAUTH_CLIENT_ID/SECRET the panel SAYS SO and shows the exact env vars plus the
// redirect URI to register — it does not render a Connect button that would bounce off a
// 503. Degrading without credentials is a product property here.
//
// Connect is a plain <a> to the start route, not a fetch: that route sets an httpOnly
// state cookie and 302s to Google, which only a top-level navigation can follow.
// Disconnect is the EXISTING DELETE (revoke at Google first, then drop the row) — its
// `revokedAtGoogle: false` is surfaced, because that is precisely the case where the
// operator must go withdraw the grant in their Google account themselves.

type Payload = { configured: boolean; connection: CalendarConnection | null; redirectUriToRegister: string };

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

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void disconnect()} disabled={busy} className={`${BTN_SECONDARY} h-9 px-4 text-sm`}>
              {busy ? t("disconnecting") : t("disconnect")}
            </button>
            <p className="text-sm text-steel">{t("disconnectHint")}</p>
          </div>
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
