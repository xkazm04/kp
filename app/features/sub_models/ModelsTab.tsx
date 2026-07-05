"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/app/_components/Badge";
import { Skeleton } from "@/app/_components/Skeleton";
import { BTN_SECONDARY, EYEBROW, INTRO, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";
import { labelize } from "@/app/_lib/format";
import type { LlmConfigRow } from "@/app/_lib/db";
import { KeysPanel } from "./KeysPanel";
import { UsagePanel } from "./UsagePanel";
import { useProviderName } from "./provider-names";

// Models tab — the LLM provider layer's admin surface (docs/LLM_PROVIDER_LAYER.md):
// pin a provider/model per use case (rows in GET /api/llm/config are EXPLICIT
// pins; a use case without a row runs the built-in default, Claude CLI locally)
// and manage the write-only provider key store. The "*" use case is the
// catch-all pin every unpinned use case inherits before the built-in default.

type ConfigPayload = { rows: LlmConfigRow[]; providers: string[]; useCases: string[] };

// One routing row: the pin editor for a single use case. Local draft state
// (provider/model) initializes from the pinned row; the parent re-keys this
// component on every saved change, so a fresh server row resets the draft.
function RoutingRow({
  useCase,
  label,
  hint,
  row,
  providers,
  onRows,
}: {
  useCase: string;
  label: string;
  hint: string | null;
  row: LlmConfigRow | null;
  providers: string[];
  onRows: (rows: LlmConfigRow[]) => void;
}) {
  const t = useTranslations("models.routing");
  const format = useFormatter();
  const providerName = useProviderName();
  const [provider, setProvider] = useState(row?.provider ?? "");
  const [model, setModel] = useState(row?.model ?? "");
  const [busy, setBusy] = useState<"save" | "reset" | "test" | null>(null);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  const dirty = provider !== (row?.provider ?? "") || model.trim() !== (row?.model ?? "");

  const save = async () => {
    if (!provider || busy) return;
    setBusy("save");
    setNote(null);
    try {
      const r = await fetch("/api/llm/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Params aren't editable here yet — pass the pinned row's through so a
        // save never silently drops maxTokens/timeoutS set headlessly.
        body: JSON.stringify({ useCase, provider, model: model.trim() || null, params: row?.params ?? {} }),
      });
      const p = (await r.json().catch(() => ({}))) as { rows?: LlmConfigRow[]; error?: string };
      if (!r.ok || !p.rows) throw new Error(p.error || t("saveFailed"));
      onRows(p.rows);
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : t("saveFailed"), ok: false });
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    if (busy) return;
    setBusy("reset");
    setNote(null);
    try {
      const r = await fetch("/api/llm/config", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useCase }),
      });
      const p = (await r.json().catch(() => ({}))) as { rows?: LlmConfigRow[]; error?: string };
      if (!r.ok || !p.rows) throw new Error(p.error || t("resetFailed"));
      onRows(p.rows);
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : t("resetFailed"), ok: false });
    } finally {
      setBusy(null);
    }
  };

  // Canary call through the real registry; the verdict is the payload and
  // errors render inline. The 404 guard below is defensive only (the route is
  // live and returns a 200 verdict / 400 / 500 — it does not 404 in practice).
  const test = async () => {
    if (busy) return;
    setBusy("test");
    setNote(null);
    try {
      const r = await fetch("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useCase }),
      });
      if (r.status === 404) throw new Error(t("testUnavailable"));
      const p = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        provider?: string;
        model?: string;
        latencyMs?: number;
        error?: string;
      };
      if (!r.ok || p.ok !== true) throw new Error(p.error || t("testFailed"));
      const testedModel = p.model ?? "—";
      setNote({
        ok: true,
        text:
          p.latencyMs != null
            ? t("testOk", { provider: p.provider ?? "", model: testedModel, latency: p.latencyMs })
            : t("testOkNoLatency", { provider: p.provider ?? "", model: testedModel }),
      });
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : t("testFailed"), ok: false });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <tr className="border-b border-stone-100 align-top">
        <td className="py-2.5 pr-3">
          <p className="text-base font-medium text-ink">{label}</p>
          {hint ? <p className="mt-0.5 text-sm text-steel">{hint}</p> : null}
          {row ? (
            <p className="mt-0.5 text-sm text-steel">
              {t("updated", { date: format.dateTime(new Date(row.updatedAt), { dateStyle: "medium" }) })}
            </p>
          ) : null}
        </td>
        <td className="py-2.5 pr-3">
          <Select
            value={provider}
            onChange={setProvider}
            ariaLabel={t("providerAria", { useCase: label })}
            size="sm"
            className="w-full min-w-36"
            options={[
              { value: "", label: t("providerDefault") },
              ...providers.map((p) => ({ value: p, label: providerName(p) })),
            ]}
          />
        </td>
        <td className="py-2.5 pr-3">
          <TextInput
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={!provider}
            placeholder={t("modelPlaceholder")}
            aria-label={t("modelAria", { useCase: label })}
            sizeVariant="sm"
            className="w-full min-w-40 disabled:opacity-50"
          />
        </td>
        <td className="py-2.5 pr-3">
          {row ? (
            <Badge tone="info" label={t("statePinned")} className="mt-1.5" />
          ) : (
            <Badge tone="neutral" label={t("stateDefault")} muted className="mt-1.5" />
          )}
        </td>
        <td className="py-2.5">
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={save}
              disabled={!provider || !dirty || busy !== null}
              className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`}
            >
              {busy === "save" ? t("saving") : t("save")}
            </button>
            {/* The canary route refuses the catch-all (a "*" test would prove
                nothing specific), so the button only renders on real use cases. */}
            {row && useCase !== "*" ? (
              <button
                type="button"
                onClick={test}
                disabled={busy !== null}
                className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`}
              >
                {busy === "test" ? t("testing") : t("test")}
              </button>
            ) : null}
            {row ? (
              <button
                type="button"
                onClick={reset}
                disabled={busy !== null}
                title={t("resetTitle")}
                className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`}
              >
                {busy === "reset" ? t("resetting") : t("reset")}
              </button>
            ) : null}
          </div>
        </td>
      </tr>
      {note ? (
        <tr className="border-b border-stone-100">
          <td colSpan={5} className="pb-2.5 pt-0">
            <p role={note.ok ? "status" : "alert"} className={`text-sm font-medium ${note.ok ? "text-moss" : "text-coral"}`}>
              {note.text}
            </p>
          </td>
        </tr>
      ) : null}
    </>
  );
}

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
    <section className="space-y-6">
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

      {!config && !loadFailed ? (
        <div role="status" aria-label={t("loading")} className="space-y-4">
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      ) : null}

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
                    <RoutingRow
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

      {config ? <KeysPanel /> : null}

      {config ? <UsagePanel /> : null}
    </section>
  );
}
