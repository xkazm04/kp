"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY, PANEL } from "@/app/_components/ui/recipes";
import { labelize } from "@/app/_lib/format";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { ProviderKeyMeta } from "@/app/_lib/llm-config";
import { KEYLESS_PROVIDERS, providerAcceptsBaseUrl } from "@/app/_lib/llm-model-defaults";
import { buildKeyRequestBody, canSubmitKeyForm, findExistingKey } from "./modelsKeysPanelLogic";
import { useProviderName } from "./modelsProviderNames";
import { ModelsKeysList } from "./ModelsKeysList";
import { ModelsKeyAddForm } from "./ModelsKeyAddForm";

// Provider key store panel. Secrets are write-only by contract: the GET surface
// is metadata (provider, scope, endpoint, updated date) and key material never
// renders anywhere — not even masked. Saving needs the server-side KP_SECRET
// (keys are encrypted at rest); that 400's message IS the operator fix, so it
// is surfaced verbatim alongside the catalog hint.

type KeysPayload = { keys: ProviderKeyMeta[]; providers: string[] };

export function KeysPanel() {
  const t = useTranslations("models.keys");
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
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
  // OpenAI-compatible server (Ollama, LM Studio, llama.cpp, vLLM, LiteLLM) — the
  // local-model path. Retained across a provider flip like the Azure fields, and
  // stripped from the body by buildKeyRequestBody for providers that ignore it.
  const [baseUrl, setBaseUrl] = useState("");
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
    if (saving || !canSubmitKeyForm({ provider, apiKey, baseUrl, keylessProviders: KEYLESS_PROVIDERS })) return;
    if (provider === "azure_openai" && !endpoint.trim()) {
      setNote({ text: t("endpointRequired"), ok: false });
      return;
    }
    setSaving(true);
    setNote(null);
    // The encryption-secret-missing 400 is detected on the SERVER's raw `error`
    // (a machine signal, never rendered) so the localized `kpSecretHint` still
    // shows under the localized message.
    let kpSecret = false;
    try {
      const r = await fetch("/api/llm/keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // bug-ui-scan-2026-07-09 (model-api-key-management #2): buildKeyRequestBody
        // includes endpoint/apiVersion ONLY for azure_openai, so a stale (hidden but
        // retained) Azure endpoint never rides along on a non-Azure key.
        body: JSON.stringify(buildKeyRequestBody({ provider, scope, apiKey, endpoint, apiVersion, baseUrl })),
      });
      const p = (await r.json().catch(() => ({}))) as { keys?: ProviderKeyMeta[]; error?: string; code?: string };
      if (!r.ok || !p.keys) {
        kpSecret = p.error?.includes("KP_SECRET") === true;
        throw new Error(errMsg(p, t("saveFailed")));
      }
      setData((d) => (d ? { ...d, keys: p.keys! } : d));
      setApiKey("");
      setNote({ text: t("saved"), ok: true });
    } catch (e) {
      const text = e instanceof Error && e.message ? e.message : t("saveFailed");
      setNote({ text, ok: false, kpSecret });
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
      const p = (await r.json().catch(() => ({}))) as { keys?: ProviderKeyMeta[]; error?: string; code?: string };
      if (!r.ok || !p.keys) throw new Error(errMsg(p, t("deleteFailed")));
      setData((d) => (d ? { ...d, keys: p.keys! } : d));
    } catch (e) {
      setNote({ text: e instanceof Error && e.message ? e.message : t("deleteFailed"), ok: false });
    } finally {
      setDeleting(null);
    }
  };

  const formProviders = data ? data.providers : [];
  const isAzure = provider === "azure_openai";
  const acceptsBaseUrl = providerAcceptsBaseUrl(provider);
  // bug-ui-scan-2026-07-09 (model-api-key-management #4): saving an upsert onto an
  // existing (provider, scope) pair silently REPLACES a live, unrecoverable key.
  // Surface it before the destructive overwrite — relabel the button + warn inline.
  const existingKey = provider ? findExistingKey(data?.keys, provider, scope) : undefined;

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

      {/* Loading choreography tier 2: hold the key rows' height, show nothing
          (invisible for 150ms, so a warm response never flashes). */}
      {!data && !loadFailed ? <div className="reveal-quiet mt-3 min-h-[6rem]" aria-hidden /> : null}

      {data ? (
        <>
          <ModelsKeysList keys={data.keys} deleting={deleting} providerName={providerName} scopeLabel={scopeLabel} onRemove={remove} />
          <ModelsKeyAddForm
            provider={provider}
            onProviderChange={setProvider}
            scope={scope}
            onScopeChange={setScope}
            apiKey={apiKey}
            onApiKeyChange={setApiKey}
            endpoint={endpoint}
            onEndpointChange={setEndpoint}
            apiVersion={apiVersion}
            onApiVersionChange={setApiVersion}
            baseUrl={baseUrl}
            onBaseUrlChange={setBaseUrl}
            acceptsBaseUrl={acceptsBaseUrl}
            canSubmit={canSubmitKeyForm({ provider, apiKey, baseUrl, keylessProviders: KEYLESS_PROVIDERS })}
            formProviders={formProviders}
            providerName={providerName}
            scopeLabel={scopeLabel}
            isAzure={isAzure}
            existingKey={existingKey}
            saving={saving}
            note={note}
            onSubmit={save}
          />
        </>
      ) : null}
    </div>
  );
}
