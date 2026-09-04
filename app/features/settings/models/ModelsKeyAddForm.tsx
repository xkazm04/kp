"use client";

import { useTranslations } from "next-intl";
import { BTN_PRIMARY, META_LABEL } from "@/app/_components/ui/recipes";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";
import type { ProviderKeyMeta } from "@/app/_lib/llm-config";

// The add/replace key form inside the Models keys panel. Split out of
// ModelsKeysPanel.tsx.
export function ModelsKeyAddForm({
  provider,
  onProviderChange,
  scope,
  onScopeChange,
  apiKey,
  onApiKeyChange,
  endpoint,
  onEndpointChange,
  apiVersion,
  onApiVersionChange,
  baseUrl,
  onBaseUrlChange,
  acceptsBaseUrl,
  canSubmit,
  formProviders,
  providerName,
  scopeLabel,
  isAzure,
  existingKey,
  saving,
  note,
  onSubmit,
}: {
  provider: string;
  onProviderChange: (v: string) => void;
  scope: "byom" | "platform";
  onScopeChange: (v: "byom" | "platform") => void;
  apiKey: string;
  onApiKeyChange: (v: string) => void;
  endpoint: string;
  onEndpointChange: (v: string) => void;
  apiVersion: string;
  onApiVersionChange: (v: string) => void;
  baseUrl: string;
  onBaseUrlChange: (v: string) => void;
  /** This provider speaks the OpenAI wire format, so it can be pointed at a
   *  local/self-hosted server (BASE_URL_PROVIDERS in llm-model-defaults.ts). */
  acceptsBaseUrl: boolean;
  /** Precomputed by the panel from the SAME rule the PUT enforces, so the button
   *  and the route never disagree about what a valid row is. */
  canSubmit: boolean;
  formProviders: string[];
  providerName: (provider: string) => string;
  scopeLabel: (value: string) => string;
  isAzure: boolean;
  existingKey: ProviderKeyMeta | undefined;
  saving: boolean;
  note: { text: string; ok: boolean; kpSecret?: boolean } | null;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const t = useTranslations("models.keys");

  return (
    <form onSubmit={onSubmit} className="mt-4 border-t border-stone-200 pt-4">
      <p className="text-base font-medium text-ink">{t("addTitle")}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className={`${META_LABEL} block`} htmlFor="key-provider">
            {t("provider")}
          </label>
          <Select
            id="key-provider"
            value={provider}
            onChange={onProviderChange}
            sizeVariant="sm"
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
            onChange={(v) => onScopeChange(v === "platform" ? "platform" : "byom")}
            sizeVariant="sm"
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
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder={t("apiKeyPlaceholder")}
            autoComplete="new-password"
            sizeVariant="sm"
            className="mt-1"
          />
        </div>
        {acceptsBaseUrl ? (
          <div className="sm:col-span-2 lg:col-span-4">
            <label className={`${META_LABEL} block`} htmlFor="key-baseurl">
              {t("baseUrl")}
            </label>
            <TextInput
              id="key-baseurl"
              type="url"
              value={baseUrl}
              onChange={(e) => onBaseUrlChange(e.target.value)}
              placeholder={t("baseUrlPlaceholder")}
              sizeVariant="sm"
              className="mt-1"
            />
            <span className="mt-1 block text-meta text-steel">{t("baseUrlHelp")}</span>
          </div>
        ) : null}
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
                onChange={(e) => onEndpointChange(e.target.value)}
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
                onChange={(e) => onApiVersionChange(e.target.value)}
                placeholder={t("apiVersionPlaceholder")}
                sizeVariant="sm"
                className="mt-1"
              />
            </div>
          </>
        ) : null}
      </div>
      {existingKey ? (
        <p
          role="note"
          className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900"
        >
          {t("replaceWarning", { provider: providerName(provider), scope: scopeLabel(scope) })}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving || !canSubmit} className={`${BTN_PRIMARY} h-9 px-4 text-sm`}>
          {saving ? t("saving") : existingKey ? t("replace") : t("save")}
        </button>
        {note ? (
          <span role={note.ok ? "status" : "alert"} className={`text-sm font-medium ${note.ok ? "text-moss" : "text-coral"}`}>
            {note.text}
            {note.kpSecret ? <span className="block font-normal text-steel">{t("kpSecretHint")}</span> : null}
          </span>
        ) : null}
      </div>
    </form>
  );
}
