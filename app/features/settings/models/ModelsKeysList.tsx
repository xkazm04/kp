"use client";

import { Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/app/_components/Badge";
import { PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import type { ProviderKeyMeta } from "@/app/_lib/llm-config";

// The stored-keys list (or its empty state) inside the Models keys panel.
// Split out of ModelsKeysPanel.tsx.
export function ModelsKeysList({
  keys,
  deleting,
  providerName,
  scopeLabel,
  onRemove,
}: {
  keys: ProviderKeyMeta[];
  deleting: string | null;
  providerName: (provider: string) => string;
  scopeLabel: (value: string) => string;
  onRemove: (provider: string, scope: string) => void;
}) {
  const t = useTranslations("models.keys");
  const format = useFormatter();

  if (keys.length === 0) {
    return <p className={`${PANEL_SUNKEN} mt-3 p-3 text-base text-steel`}>{t("empty")}</p>;
  }

  return (
    <div className="mt-3 space-y-2">
      {keys.map((k) => {
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
                onClick={() => onRemove(k.provider, k.scope)}
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
  );
}
