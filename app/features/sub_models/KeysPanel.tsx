"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/app/_components/Badge";
import { Skeleton } from "@/app/_components/Skeleton";
import { BTN_PRIMARY, BTN_SECONDARY, META_LABEL, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";
import { labelize } from "@/app/_lib/format";
import type { ProviderKeyMeta } from "@/app/_lib/llm-config";
import { useProviderName } from "./provider-names";

// Provider key store panel. Secrets are write-only by contract: the GET surface
// is metadata (provider, scope, endpoint, updated date) and key material never
// renders anywhere — not even masked. Saving needs the server-side KP_SECRET
// (keys are encrypted at rest); that 400's message IS the operator fix, so it
// is surfaced verbatim alongside the catalog hint.

type KeysPayload = { keys: ProviderKeyMeta[]; providers: string[] };

export function KeysPanel() {
  const t = useTranslations("models.keys");
  const format = useFormatter();
  const providerName = useProviderName();
  const [data, setData] = useState<KeysPayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // Add/replace form. The secret field clears after a successful save; the
  // provider/scope selection stays for a quick follow-up edit.
  const [provider, setProvider] = useState("");
  const [scope, setScope] = useState<"byom" | "platform">("byom");
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [apiVersion, setApiVersion] = useState("");
  const [saving, setSaving] = useState(false);
  // `kpSecret` flags the encryption-secret-missing 400 so the fix hint renders
  // under the verbatim server message.
  const [note, setNote] = useState<{ text: string; ok: boolean; kpSecret?: boolean } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // State updates only happen in the async callbacks (never synchronously in
  // the effect body); the retry button clears the failure flag in its event
  // handler before re-firing.
  const load = useCallback(() => {
    fetch("/api/llm/keys")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((p) => {
        const payload = p as KeysPayload;
        setData(payload);
        // The GET surface already excludes keyless providers (claude_cli), so
        // the first offered provider is just the head of the list.
        setProvider((cur) => cur || payload.providers[0] || "");
      })
      .catch(() => setLoadFailed(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const scopeLabel = (value: string): string =>
    value === "platform" ? t("scopePlatform") : value === "byom" ? t("scopeByom") : labelize(value);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !provider || !apiKey.trim()) return;
    if (provider === "azure_openai" && !endpoint.trim()) {
      setNote({ text: t("endpointRequired"), ok: false });
      return;
    }
    setSaving(true);
    setNote(null);
    try {
      const r = await fetch("/api/llm/keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          scope,
          apiKey: apiKey.trim(),
          ...(endpoint.trim() ? { endpoint: endpoint.trim() } : {}),
          ...(apiVersion.trim() ? { apiVersion: apiVersion.trim() } : {}),
        }),
      });
      const p = (await r.json().catch(() => ({}))) as { keys?: ProviderKeyMeta[]; error?: string };
      if (!r.ok || !p.keys) throw new Error(p.error || t("saveFailed"));
      setData((d) => (d ? { ...d, keys: p.keys! } : d));
      setApiKey("");
      setNote({ text: t("saved"), ok: true });
    } catch (e) {
      const text = e instanceof Error && e.message ? e.message : t("saveFailed");
      setNote({ text, ok: false, kpSecret: text.includes("KP_SECRET") });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (keyProvider: string, keyScope: string) => {
    const id = `${keyProvider}:${keyScope}`;
    if (deleting) return;
    setDeleting(id);
    setNote(null);
    try {
      const r = await fetch("/api/llm/keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: keyProvider, scope: keyScope }),
      });
      const p = (await r.json().catch(() => ({}))) as { keys?: ProviderKeyMeta[]; error?: string };
      if (!r.ok || !p.keys) throw new Error(p.error || t("deleteFailed"));
      setData((d) => (d ? { ...d, keys: p.keys! } : d));
    } catch (e) {
      setNote({ text: e instanceof Error && e.message ? e.message : t("deleteFailed"), ok: false });
    } finally {
      setDeleting(null);
    }
  };

  const formProviders = data ? data.providers : [];
  const isAzure = provider === "azure_openai";

  return (
    <div className={`${PANEL} p-5`}>
      <h3 className="flex items-center gap-2 font-serif text-h3 text-ink">
        <KeyRound size={16} className="text-coral" aria-hidden /> {t("title")}
      </h3>
      <p className="mt-1 max-w-3xl text-sm text-steel">{t("intro")}</p>

      {loadFailed ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-base text-coral">{t("loadFailed")}</p>
          <button
            type="button"
            onClick={() => {
              setLoadFailed(false);
              load();
            }}
            className={`${BTN_SECONDARY} h-8 px-3 text-sm`}
          >
            {t("retry")}
          </button>
        </div>
      ) : null}

      {!data && !loadFailed ? (
        <div role="status" aria-label={t("loading")} className="mt-3 space-y-2">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-2/3 rounded-md" />
        </div>
      ) : null}

      {data ? (
        <>
          {data.keys.length === 0 ? (
            <p className={`${PANEL_SUNKEN} mt-3 p-3 text-base text-steel`}>{t("empty")}</p>
          ) : (
            <div className="mt-3 space-y-2">
              {data.keys.map((k) => {
                const id = `${k.provider}:${k.scope}`;
                return (
                  <div
                    key={id}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-stone-200 bg-paper/50 px-3 py-2 text-sm"
                  >
                    <span className="font-semibold text-ink">{providerName(k.provider)}</span>
                    <Badge tone={k.scope === "byom" ? "info" : "neutral"} label={scopeLabel(k.scope)} />
                    {k.endpoint ? <span className="break-all text-steel">{k.endpoint}</span> : null}
                    {k.apiVersion ? <span className="text-steel">{t("apiVersionValue", { version: k.apiVersion })}</span> : null}
                    <span className="ml-auto flex items-center gap-2">
                      <span className="text-steel">
                        {t("updated", { date: format.dateTime(new Date(k.updatedAt), { dateStyle: "medium" }) })}
                      </span>
                      <button
                        type="button"
                        onClick={() => remove(k.provider, k.scope)}
                        disabled={deleting === id}
                        title={t("delete")}
                        aria-label={t("deleteAria", { provider: providerName(k.provider), scope: scopeLabel(k.scope) })}
                        className="focus-ring inline-flex items-center rounded-md border border-stone-200 bg-white p-1 text-steel hover:border-coral/40 hover:text-coral disabled:opacity-50"
                      >
                        <Trash2 size={13} aria-hidden />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <form onSubmit={save} className="mt-4 border-t border-stone-200 pt-4">
            <p className="text-base font-medium text-ink">{t("addTitle")}</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className={`${META_LABEL} block`} htmlFor="key-provider">
                  {t("provider")}
                </label>
                <Select
                  id="key-provider"
                  value={provider}
                  onChange={setProvider}
                  size="sm"
                  className="mt-1 w-full"
                  options={formProviders.map((p) => ({ value: p, label: providerName(p) }))}
                />
              </div>
              <div>
                <label className={`${META_LABEL} block`} htmlFor="key-scope">
                  {t("scope")}
                </label>
                <Select
                  id="key-scope"
                  value={scope}
                  onChange={(v) => setScope(v === "platform" ? "platform" : "byom")}
                  size="sm"
                  className="mt-1 w-full"
                  options={[
                    { value: "byom", label: t("scopeByom") },
                    { value: "platform", label: t("scopePlatform") },
                  ]}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={`${META_LABEL} block`} htmlFor="key-secret">
                  {t("apiKey")}
                </label>
                <TextInput
                  id="key-secret"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t("apiKeyPlaceholder")}
                  autoComplete="new-password"
                  sizeVariant="sm"
                  className="mt-1"
                />
              </div>
              {isAzure ? (
                <>
                  <div className="sm:col-span-2">
                    <label className={`${META_LABEL} block`} htmlFor="key-endpoint">
                      {t("endpoint")}
                    </label>
                    <TextInput
                      id="key-endpoint"
                      type="url"
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                      placeholder={t("endpointPlaceholder")}
                      sizeVariant="sm"
                      className="mt-1"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={`${META_LABEL} block`} htmlFor="key-apiversion">
                      {t("apiVersion")}
                    </label>
                    <TextInput
                      id="key-apiversion"
                      type="text"
                      value={apiVersion}
                      onChange={(e) => setApiVersion(e.target.value)}
                      placeholder={t("apiVersionPlaceholder")}
                      sizeVariant="sm"
                      className="mt-1"
                    />
                  </div>
                </>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={saving || !provider || !apiKey.trim()}
                className={`${BTN_PRIMARY} h-9 px-4 text-sm`}
              >
                {saving ? t("saving") : t("save")}
              </button>
              {note ? (
                <span role={note.ok ? "status" : "alert"} className={`text-sm font-medium ${note.ok ? "text-moss" : "text-coral"}`}>
                  {note.text}
                  {note.kpSecret ? <span className="block font-normal text-steel">{t("kpSecretHint")}</span> : null}
                </span>
              ) : null}
            </div>
          </form>
        </>
      ) : null}
    </div>
  );
}
