"use client";

import { useTranslations } from "next-intl";
import { PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import type { ProviderKeyMeta } from "@/app/_lib/llm-config";
import { ModelsKeyRow } from "./ModelsKeyRow";

// The stored-keys list (or its empty state) inside the Models keys panel.
// Split out of ModelsKeysPanel.tsx; the row itself (and its Test affordance)
// lives in ModelsKeyRow.tsx, which owns per-row state.
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

  if (keys.length === 0) {
    return <p className={`${PANEL_SUNKEN} mt-3 p-3 text-base text-steel`}>{t("empty")}</p>;
  }

  return (
    <div className="mt-3 space-y-2">
      {keys.map((k) => (
        <ModelsKeyRow
          key={`${k.provider}:${k.scope}`}
          entry={k}
          deleting={deleting}
          providerName={providerName}
          scopeLabel={scopeLabel}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}
