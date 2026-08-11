"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { Defer } from "@/app/_components/ui/Defer";
import { BTN_SECONDARY, EYEBROW, INTRO, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";
import { labelize } from "@/app/_lib/format";
import type { LlmConfigRow } from "@/app/_lib/db/llm";
import { ModelsRoutingRow } from "./ModelsRoutingRow";

// Tier 3 (docs/design/loading-choreography.md): the three panels below the routing
// table are secondary — nobody opens Models to read the usage ledger first. They
// get their own chunks so the tab's first paint carries the routing table alone,
// and each mounts an idle beat later via <Defer> instead of piling onto the same
// frame. The chunk gap is a quiet reserved box, never a skeleton.
const chunkGap = (minHeight: string) => {
  const Gap = () => <div className={`reveal-quiet ${minHeight}`} aria-hidden />;
  Gap.displayName = "ModelsPanelGap";
  return Gap;
};
const QualityOverview = dynamic(() => import("./ModelsQualityOverview").then((m) => ({ default: m.QualityOverview })), {
  loading: chunkGap("min-h-[14rem]"),
});
const KeysPanel = dynamic(() => import("./ModelsKeysPanel").then((m) => ({ default: m.KeysPanel })), {
  loading: chunkGap("min-h-[16rem]"),
});
const UsagePanel = dynamic(() => import("./ModelsUsagePanel").then((m) => ({ default: m.UsagePanel })), {
  loading: chunkGap("min-h-[12rem]"),
});

// Models tab — the LLM provider layer's admin surface (docs/architecture/llm-provider-layer.md):
// pin a provider/model per use case (rows in GET /api/llm/config are EXPLICIT
// pins; a use case without a row runs the built-in default, Claude CLI locally)
// and manage the write-only provider key store. The "*" use case is the
// catch-all pin every unpinned use case inherits before the built-in default.

type ConfigPayload = { rows: LlmConfigRow[]; providers: string[]; useCases: string[] };


export function ModelsTab() {
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

  const rowFor = (useCase: string): LlmConfigRow | null =>
    config?.rows.find((r) => r.useCase === useCase) ?? null;

  // The catch-all "*" leads the table (LLM_USE_CASES already orders it first;
  // re-sorting here keeps that true even if the server list changes).
  const useCases = config ? [...config.useCases].sort((a, b) => (a === "*" ? -1 : b === "*" ? 1 : 0)) : [];

  return (
    // Tier 1: the header + whatever has arrived cascade in as this section's
    // direct children (stagger-children, globals.css). aria-busy covers the
    // first load only — a later refresh never blanks what is already here.
    <section className="stagger-children space-y-6" aria-busy={!config && !loadFailed}>
      <header>
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <SectionTitle className="mt-1">{t("title")}</SectionTitle>
        <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("intro")}</p>
      </header>

      {loadFailed ? (
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
      ) : null}

      {/* Tier 2: the config fetch is in flight and there is nothing to show yet.
          Hold the routing table's height so the page doesn't jump when it lands,
          and stay invisible for 150ms so a warm response paints nothing at all.
          (Was two pulsing skeleton slabs that drew a table nobody was getting.) */}
      {!config && !loadFailed ? <div className="reveal-quiet min-h-[26rem]" aria-hidden /> : null}

      {config ? (
        <div className={`${PANEL} p-5`}>
          <h3 className="font-serif text-h3 text-ink">{t("routing.title")}</h3>
          <p className="mt-1 max-w-3xl text-sm text-steel">{t("routing.intro")}</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[52rem] text-base">
              <thead>
                <tr className="border-b border-stone-200 text-left text-meta uppercase text-steel">
                  <th className="pb-2 pr-3 font-semibold">{t("routing.colUseCase")}</th>
                  <th className="pb-2 pr-3 font-semibold">{t("routing.colProvider")}</th>
                  <th className="pb-2 pr-3 font-semibold">{t("routing.colModel")}</th>
                  <th className="pb-2 pr-3 font-semibold">{t("routing.colState")}</th>
                  <th className="pb-2 text-right font-semibold">{t("routing.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {useCases.map((useCase) => {
                  const row = rowFor(useCase);
                  return (
                    <ModelsRoutingRow
                      // Re-key on the saved pin so a fresh server row resets the draft.
                      key={`${useCase}:${row ? `${row.provider}:${row.model ?? ""}:${row.updatedAt}` : "default"}`}
                      useCase={useCase}
                      label={labelFor(useCase)}
                      hint={useCase === "*" ? t("routing.defaultRowHint") : null}
                      row={row}
                      providers={config.providers}
                      onRows={(rows) => setConfig((c) => (c ? { ...c, rows } : c))}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Tier 3: secondary panels, one idle beat after the routing table paints.
          Each is its own chunk, so this tab's entry payload is the table only.
          NOT gated on `config`: these panels own their own data (keys, usage) and
          are otherwise hardcoded chrome, so waiting for /api/llm/config made the
          tab a serial waterfall — config round-trip, THEN chunk download, THEN
          their own fetches. <Defer> already keeps them off the first frame, which
          is the only thing the gate was actually buying. */}
      <Defer strategy="next-frame">
        <QualityOverview />
      </Defer>

      <Defer strategy="idle">
        <KeysPanel />
      </Defer>

      <Defer strategy="idle">
        <UsagePanel />
      </Defer>
    </section>
  );
}
