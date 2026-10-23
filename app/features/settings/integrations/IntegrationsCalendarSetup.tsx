"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY, META_LABEL, NOTICE, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { IconAction } from "@/app/_components/IconAction";
import { TextInput } from "@/app/_components/TextInput";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { calendarSetupLoad } from "./calendarSetupState";

// T8 — the guided Google Calendar setup. Walks the owner through creating an OAuth client
// in the Google Cloud console (numbered steps, the exact redirect URI with a copy control,
// the two scopes), takes the client id and secret, saves them through
// /api/calendar/google/client (sealed at rest; no env edit, no restart) and goes straight
// on to the existing Connect door. The secret field is write-only: nothing ever reads it
// back, and a blank secret on a re-save keeps the stored one.

type ClientStatus = {
  configured: boolean;
  source: "stored" | "env" | null;
  clientId: string | null;
  savedUnreadable: boolean;
  redirectUriToRegister: string;
  scopes: string[];
};

const CLIENT_URL = "/api/calendar/google/client";
const START_URL = "/api/calendar/google/start";
/** Shown as text the owner opens, never fetched or framed by kp. */
const CONSOLE_URL = "https://console.cloud.google.com/apis/credentials";
const FAIL_REASONS = ["client_id_invalid", "client_secret_invalid", "client_secret_required", "key_unavailable"] as const;
type FailReason = (typeof FAIL_REASONS)[number] | "save_failed";

function CopyValue({ value, label }: { value: string; label: string }) {
  const t = useTranslations("integrations.calendar.setup");
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false)
    );
  };
  return (
    <div className="mt-1 flex items-center gap-2">
      <code className="min-w-0 break-all font-mono text-meta text-ink">{value}</code>
      <IconAction icon={copied ? Check : Copy} label={copied ? t("copied") : label} onClick={copy} size={15} />
    </div>
  );
}

export function IntegrationsCalendarSetup() {
  const t = useTranslations("integrations.calendar.setup");
  const { data, error, reload } = useJsonFetch<ClientStatus>(CLIENT_URL, t("loadFailed"));
  const [clientId, setClientId] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<FailReason | null>(null);

  const idValue = clientId ?? data?.clientId ?? "";
  const keepsSecret = !!data?.clientId && data.source === "stored" && !data.savedUnreadable;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setFailure(null);
    try {
      const r = await fetch(CLIENT_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: idValue, clientSecret: secret }),
      });
      const p = (await r.json().catch(() => null)) as { ok?: boolean; reason?: string } | null;
      if (r.ok && p?.ok) {
        setSecret("");
        // Straight on to Google's consent screen: the same top-level door Connect uses.
        // A full navigation, not router.push: the start door is a route handler that sets
        // the state cookie and answers with a redirect into Google.
        window.location.assign(new URL(START_URL, window.location.origin).toString());
        return;
      }
      const reason = (FAIL_REASONS as readonly string[]).includes(p?.reason ?? "") ? (p?.reason as FailReason) : "save_failed";
      setFailure(reason);
    } catch {
      setFailure("save_failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${PANEL_SUNKEN} mt-3 p-4`}>
      <p className="text-body font-semibold text-ink">{t("title")}</p>
      <p className="mt-1 text-meta text-steel">{t("intro")}</p>

      {calendarSetupLoad(data, error) === "failed" ? (
        <div role="alert" className={`${NOTICE("critical")} mt-3 flex flex-wrap items-center gap-3 p-3`}>
          <p className="text-meta">{error}</p>
          <button type="button" onClick={reload} className="text-meta font-medium underline">
            {t("retry")}
          </button>
        </div>
      ) : null}

      {data?.savedUnreadable ? (
        <div role="alert" className={`${NOTICE("critical")} mt-3 p-3`}>
          <p className="text-meta">{t("unreadable")}</p>
        </div>
      ) : null}

      <ol className="mt-3 list-decimal space-y-3 pl-5 text-meta text-ink">
        <li>
          {t("step1")}
          <CopyValue value={CONSOLE_URL} label={t("copyConsole")} />
        </li>
        <li>{t("step2")}</li>
        <li>
          {t("step3")}
          {(data?.scopes ?? []).map((scope) => (
            <CopyValue key={scope} value={scope} label={t("copyScope")} />
          ))}
        </li>
        <li>
          {t("step4")}
          {data ? <CopyValue value={data.redirectUriToRegister} label={t("copyRedirect")} /> : null}
          <span className="mt-1 block text-steel">{t("step4Exact")}</span>
        </li>
        <li>{t("step5")}</li>
      </ol>

      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={`${META_LABEL} block`} htmlFor="gcal-client-id">
            {t("clientIdLabel")}
          </label>
          <TextInput
            id="gcal-client-id"
            value={idValue}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="1234567890-abc.apps.googleusercontent.com"
            autoComplete="off"
            spellCheck={false}
            sizeVariant="sm"
            className="mt-1 font-mono"
          />
        </div>
        <div>
          <label className={`${META_LABEL} block`} htmlFor="gcal-client-secret">
            {t("clientSecretLabel")}
          </label>
          <TextInput
            id="gcal-client-secret"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={keepsSecret ? t("clientSecretKeep") : ""}
            autoComplete="new-password"
            spellCheck={false}
            sizeVariant="sm"
            className="mt-1 font-mono"
          />
        </div>
        <p className="text-meta text-steel sm:col-span-2">{t("secretNote")}</p>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="submit" disabled={saving || !idValue.trim() || (!secret.trim() && !keepsSecret)} className={`${BTN_PRIMARY} h-9 px-4`}>
            {saving ? t("saving") : t("saveAndConnect")}
          </button>
          {failure ? (
            <span role="alert" className="text-meta font-medium text-coral-ink">
              {t(`fail.${failure}`)}
            </span>
          ) : null}
        </div>
      </form>

      <p className="mt-4 text-meta text-steel">{t("envAlternative")}</p>
    </div>
  );
}
