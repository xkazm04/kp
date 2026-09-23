"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/app/_components/Badge";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";
import type { LlmConfigRow } from "@/app/_lib/db/llm";
import { saveRoutingPin, resetRoutingPin } from "./modelsRoutingActions";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { ModelsRoutingRowActions } from "./ModelsRoutingRowActions";
import { useProviderName } from "./modelsProviderNames";
import { useTestReason, type ModelsTestVerdict } from "./modelsTestReason";
import { withModelSection, type RoutingHealth, type RoutingHealthState } from "./modelsRoutingHealth";
import { ROUTING_HEALTH_WINDOW_DAYS } from "@/app/_lib/llm-usage-ledger";

// The health chip's tone per state. Serving is the only green; a template floor or
// a provider the pin did not name is caution; a failing newest call is critical.
const HEALTH_TONE: Record<RoutingHealthState, BadgeTone> = {
  serving: "positive",
  falling_back: "caution",
  failing: "critical",
  drift: "caution",
  unproven: "info",
  idle: "neutral",
};

// One routing row: the pin editor for a single use case. Local draft state
// (provider/model) initializes from the pinned row; the parent re-keys this
// component on every saved change, so a fresh server row resets the draft.
// Split out of ModelsTab.tsx (formerly RoutingRow). The ★ best-measured-model
// hint that used to sit under the label moved to the Measured-quality panel;
// the row now carries a one-sentence description of the process step instead
// (models.useCaseDesc.<id>, threaded in by the parent).
export function ModelsRoutingRow({
  useCase,
  inert,
  label,
  description,
  row,
  health,
  pinnedProvider,
  providers,
  onRows,
}: {
  useCase: string;
  /** Catalogued for quality comparisons but not called by the production router. */
  inert?: boolean;
  label: string;
  /** One short sentence: where in the hiring process this LLM call applies. */
  description: string | null;
  row: LlmConfigRow | null;
  /** What served this use case since its effective pin (modelsRoutingHealth.ts);
   *  null for the "*" row, which is a pin and never a ledger use case. */
  health: RoutingHealth | null;
  /** The effective pin's provider (own row, else "*"), named by a drift hint. */
  pinnedProvider: string | null;
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
  // Failures resolve through the SHARED canary reason catalog, not the `errors`
  // namespace: the route classifies the provider failure into a stable code
  // (auth / rate_limit / connection / …) and every one of them used to collapse
  // to a flat "Test failed." here, because `errors` carries none of those codes.
  const reasonFor = useTestReason();
  const [provider, setProvider] = useState(row?.provider ?? "");
  const [model, setModel] = useState(row?.model ?? "");
  const [busy, setBusy] = useState<"save" | "reset" | "test" | null>(null);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const th = useTranslations("models.routing.health");

  // One sentence per state, from the ledger - never the provider's own text: the
  // reason is a closed-vocabulary code, and an unknown one reads as "unknown".
  const reasonText = (code: string | null): string => {
    const key = `reasons.${code ?? "unknown"}` as Parameters<typeof th>[0];
    return code && th.has(key) ? th(key) : th("reasons.unknown");
  };
  const when = (at: string | null) => (at ? format.dateTime(new Date(at), { dateStyle: "medium", timeStyle: "short" }) : "");
  const healthHint = (h: RoutingHealth): string => {
    switch (h.state) {
      case "serving":
        return th("hintServing", { provider: providerName(h.served?.provider ?? ""), date: when(h.lastAt) });
      case "drift":
        return th("hintDrift", {
          pinned: providerName(pinnedProvider ?? ""),
          served: providerName(h.served?.provider ?? ""),
          date: when(h.lastAt),
        });
      case "falling_back":
        return th("hintFallingBack", { date: when(h.lastAt), reason: reasonText(h.reason) });
      case "failing":
        return th("hintFailing", { date: when(h.lastAt), reason: reasonText(h.reason) });
      case "unproven":
        return th("hintUnproven");
      case "idle":
        return th("hintIdle", { days: ROUTING_HEALTH_WINDOW_DAYS });
    }
  };
  const openKeys = () => {
    // The Keys section is an address (?modelSec=keys, read by ModelsTab), so the
    // repair is the same URL move the section switcher makes.
    window.history.replaceState(null, "", withModelSection(window.location.href, "keys"));
  };

  const dirty = provider !== (row?.provider ?? "") || model.trim() !== (row?.model ?? "");

  const save = async () => {
    if (!provider || busy) return;
    setBusy("save");
    setNote(null);
    // The version this draft was composed against travels with the write. The store
    // re-asserts it, so a save that another operator (or another tab) has since
    // superseded is DROPPED with a 409 instead of quietly overwriting their pin —
    // which is exactly what the row's own "Updated <date>" line could never warn about
    // while that date only ever travelled one way.
    const result = await saveRoutingPin(
      useCase,
      provider,
      model,
      row?.params,
      row?.updatedAt ?? null,
      t("saveFailed"),
      errMsg
    );
    if (result.ok) onRows(result.rows);
    else {
      // A stale refusal answers WITH the current table: apply it, so the reload
      // affordance is the refusal itself rather than a second click. The parent
      // re-keys this component on new rows, so the draft resets to what is pinned.
      if (result.rows) onRows(result.rows);
      setNote({ text: result.message, ok: false });
    }
    setBusy(null);
  };

  const reset = async () => {
    if (busy) return;
    setBusy("reset");
    setNote(null);
    const result = await resetRoutingPin(useCase, row?.updatedAt ?? null, t("resetFailed"), errMsg);
    if (result.ok) onRows(result.rows);
    else {
      if (result.rows) onRows(result.rows);
      setNote({ text: result.message, ok: false });
    }
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
      const p = (await r.json().catch(() => ({}))) as ModelsTestVerdict;
      // A canary code first (the specific reason), then the `errors` namespace for
      // a plain envelope failure, then this row's generic fallback.
      if (!r.ok || p.ok !== true) throw new Error(reasonFor(p, errMsg(p, t("testFailed"))));
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
          {description ? <p className="mt-0.5 max-w-xs text-sm text-steel">{description}</p> : null}
          {inert ? <p className="mt-1 max-w-xs text-sm font-medium text-amber-800">{t("inertRow")}</p> : null}
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
            sizeVariant="sm"
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
          {health ? (
            <div className="mt-1.5 max-w-[15rem]">
              <Badge tone={HEALTH_TONE[health.state]} label={th(`label.${health.state}`)} muted={health.state === "idle"} />
              <p className="mt-1 text-sm text-steel">{healthHint(health)}</p>
              {health.repair === "keys" ? (
                <button type="button" onClick={openKeys} className="mt-1 text-sm font-medium text-coral underline underline-offset-2">
                  {th("openKeys")}
                </button>
              ) : null}
            </div>
          ) : null}
        </td>
        <td className="py-2.5">
          <ModelsRoutingRowActions
            useCase={useCase}
            hasRow={row !== null}
            canSave={Boolean(provider) && dirty}
            // The canary sends `{ useCase }` — the server answers about the
            // STORED pin. With an unsaved draft in the boxes, that verdict
            // (green OR red) would be read as being about the draft.
            canTest={!dirty}
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
