"use client";

import { useTranslations } from "next-intl";
import { labelize } from "@/app/_lib/format";

// Display name for an LLM provider id (anthropic, azure_openai, …), shared by
// the routing table and the keys panel. Falls back to a labelized id for any
// provider the catalog doesn't know yet, so a server-side addition renders
// readably instead of crashing on a missing key.
export function useProviderName(): (provider: string) => string {
  const t = useTranslations("models.providers");
  return (provider) => {
    const key = provider as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : labelize(provider);
  };
}
