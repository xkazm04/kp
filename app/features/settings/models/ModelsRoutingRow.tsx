"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/app/_components/Badge";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";
import type { LlmConfigRow } from "@/app/_lib/db";
import { bestModelForUseCase } from "@/app/_lib/llm-quality";
import { QUALITY_SCORES, hasQualityScores } from "@/app/_lib/llm-quality-scores";
import { saveRoutingPin, resetRoutingPin } from "./modelsRoutingActions";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { ModelsRoutingRowActions } from "./ModelsRoutingRowActions";
import { useProviderName } from "./modelsProviderNames";

const shortModel = (slug: string) => slug.split("/").pop() ?? slug;
const STAR = "★"; // decorative marker for the measured-best-model hint (not translatable copy)

// One routing row: the pin editor for a single use case. Local draft state
// (provider/model) initializes from the pinned row; the parent re-keys this
// component on every saved change, so a fresh server row resets the draft.
// Split out of ModelsTab.tsx (formerly RoutingRow).
export function ModelsRoutingRow({
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
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts. Threaded into the plain
  // action helpers, which can't call the hook themselves.
  const errMsg = useErrorMessage();
  const format = useFormatter();
  const providerName = useProviderName();
  const [provider, setProvider] = useState(row?.provider ?? "");
  const [model, setModel] = useState(row?.model ?? "");
  const [busy, setBusy] = useState<"save" | "reset" | "test" | null>(null);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  const dirty = provider !== (row?.provider ?? "") || model.trim() !== (row?.model ?? "");
  // Best measured model for this use case (across its bench ops) — an evidence
  // hint the operator can pin. Null for the "*" catch-all and unmeasured cases.
  const rec = hasQualityScores() ? bestModelForUseCase(QUALITY_SCORES, useCase) : null;

  const save = async () => {
    if (!provider || busy) return;
    setBusy("save");
    setNote(null);
    const result = await saveRoutingPin(useCase, provider, model, row?.params, t("saveFailed"), errMsg);
    if (result.ok) onRows(result.rows);
    else setNote({ text: result.message, ok: false });
    setBusy(null);
  };

  const reset = async () => {
    if (busy) return;
    setBusy("reset");
    setNote(null);
    const result = await resetRoutingPin(useCase, t("resetFailed"), errMsg);
    if (result.ok) onRows(result.rows);
    else setNote({ text: result.message, ok: false });
    setBusy(null);
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
        code?: string;
      };
      if (!r.ok || p.ok !== true) throw new Error(errMsg(p, t("testFailed")));
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
          {rec ? (
            <p
              className="mt-0.5 text-sm font-medium text-moss"
              title={t("recTitle", { model: rec.model, score: rec.composite.toFixed(1) })}
            >
              {STAR} {shortModel(rec.model)} {rec.composite.toFixed(1)}
            </p>
          ) : null}
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
          <ModelsRoutingRowActions
            useCase={useCase}
            hasRow={row !== null}
            canSave={Boolean(provider) && dirty}
            busy={busy}
            onSave={save}
            onTest={test}
            onReset={reset}
          />
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
