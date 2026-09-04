"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY, EYEBROW, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { labelize } from "@/app/_lib/format";
import type { LlmConfigRow } from "@/app/_lib/db/llm";
import { ModelsRoutingRow } from "./ModelsRoutingRow";
import { sectionizeUseCases } from "./modelsRoutingSections";

// The Routing section: pin a provider/model per use case. Rows in
// GET /api/llm/config are EXPLICIT pins; a use case without a row runs the
// built-in default (Claude CLI locally). The "*" use case is the catch-all pin
// every unpinned use case inherits before that built-in default.
//
// Split out of ModelsTab.tsx when the tab became a three-section switcher: the
// tab is now header + switcher, and each section owns its own fetch, so opening
// Models no longer pays for the key store and the bench matrix before the
// routing table it actually landed on can paint.

type ConfigPayload = { rows: LlmConfigRow[]; providers: string[]; useCases: string[] };

export function ModelsRoutingPanel() {
  const t = useTranslations("models");
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // State updates only happen in the async callbacks (never synchronously in
  // the effect body); the retry button clears the failure flag in its event
  // handler before re-firing.
  const load = useCallback(() => {
    fetch("/api/llm/config")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((p) => setConfig(p as ConfigPayload))
      .catch(() => setLoadFailed(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Display name with the app-wide has() fallback — a use case added on the
  // server before the catalog catches up renders labelized, never crashes.
  const labelFor = (useCase: string): string => {
    if (useCase === "*") return t("routing.defaultRow");
    const key = `useCases.${useCase}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : labelize(useCase);
  };

  // One-sentence "where the LLM applies" description per use case — the ★
  // best-measured hint moved to the Measured-quality panel; a routing row now
  // explains its process step instead. Absent key → no line (never a raw id).
  const descFor = (useCase: string): string | null => {
    const key = `useCaseDesc.${useCase}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : null;
  };

  const sectionTitle = (key: string): string => {
    const k = `routing.sections.${key}` as Parameters<typeof t>[0];
    return t.has(k) ? t(k) : labelize(key);
  };

  const rowFor = (useCase: string): LlmConfigRow | null => config?.rows.find((r) => r.useCase === useCase) ?? null;

  // The server list partitioned into the curated functional sections (the "*"
  // catch-all leads as its own section; unknown server ids trail under "other").
  const sections = config ? sectionizeUseCases(config.useCases) : [];

  if (loadFailed) {
    return (
      <div className={`${PANEL_SUNKEN} flex flex-wrap items-center gap-3 p-4`}>
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
    );
  }

  // Tier 2: the config fetch is in flight and there is nothing to show yet.
  // Hold the routing table's height so the page doesn't jump when it lands, and
  // stay invisible for 150ms so a warm response paints nothing at all.
  if (!config) return <div className="reveal-quiet min-h-[26rem]" aria-hidden />;

  return (
    <div className={`${PANEL} p-5`}>
      <h3 className="font-serif text-h3 text-ink">{t("routing.title")}</h3>
      <p className="mt-1 max-w-3xl text-sm text-steel">{t("routing.intro")}</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[52rem] text-base">
          <thead>
            <tr className="border-b border-stone-200 text-left text-meta uppercase text-steel">
              <th scope="col" className="pb-2 pr-3 font-semibold">{t("routing.colUseCase")}</th>
              <th scope="col" className="pb-2 pr-3 font-semibold">{t("routing.colProvider")}</th>
              <th scope="col" className="pb-2 pr-3 font-semibold">{t("routing.colModel")}</th>
              <th scope="col" className="pb-2 pr-3 font-semibold">{t("routing.colState")}</th>
              <th scope="col" className="pb-2 text-right font-semibold">{t("routing.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <Fragment key={section.key}>
                {/* The "default" section is the single "*" row — its own hint
                    explains it, so a header above it would just repeat it. */}
                {section.key !== "default" ? (
                  <tr>
                    <th colSpan={5} scope="colgroup" className="pb-1.5 pt-5 text-left">
                      <span className={EYEBROW}>{sectionTitle(section.key)}</span>
                    </th>
                  </tr>
                ) : null}
                {section.useCases.map((useCase) => {
                  const row = rowFor(useCase);
                  return (
                    <ModelsRoutingRow
                      // Re-key on the saved pin so a fresh server row resets the draft.
                      key={`${useCase}:${row ? `${row.provider}:${row.model ?? ""}:${row.updatedAt}` : "default"}`}
                      useCase={useCase}
                      label={labelFor(useCase)}
                      description={useCase === "*" ? t("routing.defaultRowHint") : descFor(useCase)}
                      row={row}
                      providers={config.providers}
                      onRows={(rows) => setConfig((c) => (c ? { ...c, rows } : c))}
                    />
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
