"use client";

import { useState } from "react";
import { Plug } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY, CARD_PAD, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { labelOr } from "@/app/_lib/use-enum-label";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { AtsConnectionPublic } from "@/app/_lib/ats/connections-store";
import { IntegrationsAtsForm } from "./IntegrationsAtsForm";
import { IntegrationsAtsRow } from "./IntegrationsAtsRow";

// connect-the-integrations — add / park / remove an INBOUND ATS connection.
//
// The store, its 30 tests and the operator-gated route all shipped in W1; nothing ever
// called them, so a credential that reads every candidate in a customer's ATS could only
// be installed with curl. This is the door, and it inherits the store's contracts rather
// than restating them: the provider list comes from the route's own ATS_PROVIDERS (never
// re-listed here), the token is write-only, and removal asks the links question out loud
// instead of picking a default that either duplicates the pipeline or silently adopts
// stale bindings.

type Payload = { providers: string[]; connections: AtsConnectionPublic[] };

export function IntegrationsAtsPanel() {
  const t = useTranslations("integrations.ats");
  const { data, error, reload } = useJsonFetch<Payload>("/api/ats/connections", t("loadFailed"));
  // API failures render from the machine `code`, never from the server's English
  // `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();

  const [provider, setProvider] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  // The selected provider is DERIVED, not synced: `provider` is empty until the operator
  // picks one, and until then the form shows the first offered provider. Syncing it from
  // the payload in an effect would be a second source of truth (and a cascading render).
  const active = provider || data?.providers[0] || "";
  const existing = data?.connections.find((c) => c.provider === active);

  // Prefill the editable fields from the selected connection, adjusted DURING render when
  // the selection changes rather than in an effect — React's documented pattern for
  // derived-from-props state, and the one the `set-state-in-effect` rule points at. The
  // base URL starts from the stored value so the operator can EDIT it in place, and so
  // `save` below can tell an edit from an untouched field. The token deliberately starts
  // blank every time (blank = keep).
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  if (data && active && prefilledFor !== active) {
    setPrefilledFor(active);
    setBaseUrl(existing?.baseUrl ?? "");
    setEnabled(existing?.enabled ?? true);
    setApiToken("");
  }

  const providerLabel = (p: string) => labelOr(t, `providers.${p}`, p);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !active) return;
    setSaving(true);
    setNote(null);
    try {
      // EVERY field is a PARTIAL update (setAtsConnection: omitted = keep), so send only
      // what the operator actually touched.
      //   • apiToken blank    → omitted. The store reads "" as CLEAR, so submitting the
      //                         untouched field would wipe a working credential on an edit.
      //   • baseUrl unchanged → omitted. This panel used to resend the prefilled value
      //                         because the store wrote base_url unconditionally; it no
      //                         longer does, and resending made every save a blind write of
      //                         a snapshot taken when the tab loaded — a base URL another
      //                         operator had changed since was silently reverted by a save
      //                         that only meant to park the connection, and a park re-ran
      //                         the SSRF check on a URL the store had already vetted.
      //   • baseUrl blanked   → an explicit null, so clearing it still works.
      const trimmedUrl = baseUrl.trim();
      const body: Record<string, unknown> = { provider: active, enabled };
      if (trimmedUrl !== (existing?.baseUrl ?? "")) body.baseUrl = trimmedUrl || null;
      if (apiToken.trim()) body.apiToken = apiToken.trim();
      const r = await fetch("/api/ats/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const p = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        code?: string;
        connection?: AtsConnectionPublic;
      };
      // The route's 400s (bad provider, non-public base URL, missing KP_SECRET) used to be
      // surfaced verbatim — but `error` is canonical English, so every non-en operator got
      // an English string. The detail stays in the server log; the operator gets a message
      // in their language, from the code when the route ships one.
      if (!r.ok || !p.ok) throw new Error(errMsg(p, t("saveFailed")));
      setApiToken("");
      // Adopt the store's parse-normalized URL — "https://x.example.com" comes back as
      // "https://x.example.com/" — so the next save compares the field against what is
      // really stored instead of seeing a spurious edit and resending it.
      if (p.connection) setBaseUrl(p.connection.baseUrl ?? "");
      setNote({ text: t("saved"), ok: true });
      reload();
    } catch (err) {
      setNote({ text: err instanceof Error && err.message ? err.message : t("saveFailed"), ok: false });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (target: string, forgetLinks: boolean) => {
    if (removing) return;
    setRemoving(target);
    setNote(null);
    try {
      const r = await fetch(`/api/ats/connections?provider=${encodeURIComponent(target)}&forgetLinks=${forgetLinks ? "1" : "0"}`, {
        method: "DELETE",
      });
      const p = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; code?: string; linksDropped?: number };
      if (!r.ok || !p.ok) throw new Error(errMsg(p, t("removeFailed")));
      setNote({
        text: forgetLinks ? t("removedForget", { count: p.linksDropped ?? 0 }) : t("removedKeep"),
        ok: true,
      });
      reload();
    } catch (err) {
      setNote({ text: err instanceof Error && err.message ? err.message : t("removeFailed"), ok: false });
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className={`${PANEL} ${CARD_PAD}`}>
      <h3 className="flex items-center gap-2 font-serif text-h3 text-ink">
        <Plug size={16} className="text-coral" aria-hidden /> {t("title")}
      </h3>
      <p className="mt-1 max-w-3xl text-sm text-steel">{t("intro")}</p>

      {error ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-base text-coral">{error}</p>
          <button type="button" onClick={reload} className={`${BTN_SECONDARY} h-8 px-3 text-sm`}>
            {t("retry")}
          </button>
        </div>
      ) : null}

      {!data && !error ? <div className="reveal-quiet mt-3 min-h-[8rem]" aria-hidden /> : null}

      {data ? (
        <>
          {data.connections.length === 0 ? (
            <p className={`${PANEL_SUNKEN} mt-3 p-4 text-sm text-steel`}>{t("empty")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.connections.map((c) => (
                <IntegrationsAtsRow
                  key={c.provider}
                  connection={c}
                  label={providerLabel(c.provider)}
                  busy={removing === c.provider}
                  onRemove={(forgetLinks) => void remove(c.provider, forgetLinks)}
                />
              ))}
            </ul>
          )}

          <IntegrationsAtsForm
            providers={data.providers}
            provider={active}
            onProviderChange={setProvider}
            providerLabel={providerLabel}
            baseUrl={baseUrl}
            onBaseUrlChange={setBaseUrl}
            apiToken={apiToken}
            onApiTokenChange={setApiToken}
            enabled={enabled}
            onEnabledChange={setEnabled}
            existingHasToken={!!existing?.hasToken}
            saving={saving}
            note={note}
            onSubmit={save}
          />
        </>
      ) : null}
    </div>
  );
}
