"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/app/_components/Badge";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";
import { providerNeedsExplicitModel } from "@/app/_lib/llm-model-defaults";
import type { ProviderKeyMeta } from "@/app/_lib/llm-config";
import { useTestReason, type ModelsTestVerdict } from "./modelsTestReason";

// One stored provider key, with the affordance the panel was missing: PROVE IT.
//
// Saving a key used to end in "Saved" and nothing else — the first evidence that
// a pasted key actually worked arrived later, from a real hiring action failing
// over to its deterministic fallback, which is exactly where a credential
// problem is hardest to recognise. Test fires a hello-world completion through
// the real adapter with this row's key only (POST /api/llm/keys/test, which
// builds a provider-scoped KP_LLM_CONFIG so a platform row can never be answered
// by the BYOM key that outranks it) and reports the verdict here.
//
// Providers whose model is customer-named (Azure deployments) or slug-addressed
// (OpenRouter, Qwen) have nothing to guess, so the row asks for one before it
// will call. The server refuses those up front with a `model_required` verdict,
// which is also what reveals the field if the operator presses Test first.

export function ModelsKeyRow({
  entry,
  deleting,
  providerName,
  scopeLabel,
  onRemove,
}: {
  entry: ProviderKeyMeta;
  deleting: string | null;
  providerName: (provider: string) => string;
  scopeLabel: (value: string) => string;
  onRemove: (provider: string, scope: string) => void;
}) {
  const t = useTranslations("models.keys");
  const format = useFormatter();
  const reasonFor = useTestReason();
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  // Revealed either by the provider needing a model up front, or by the server
  // saying so — never a field that appears for a provider that has a default.
  const [askModel, setAskModel] = useState(() => providerNeedsExplicitModel(entry.provider));
  const [model, setModel] = useState("");

  const id = `${entry.provider}:${entry.scope}`;
  const label = providerName(entry.provider);
  const scope = scopeLabel(entry.scope);

  const runTest = async () => {
    if (testing) return;
    setTesting(true);
    setNote(null);
    try {
      const r = await fetch("/api/llm/keys/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: entry.provider, scope: entry.scope, ...(model.trim() ? { model: model.trim() } : {}) }),
      });
      const verdict = (await r.json().catch(() => null)) as ModelsTestVerdict | null;
      if (r.ok && verdict?.ok === true) {
        const tested = verdict.model ?? label;
        setNote({
          ok: true,
          text:
            verdict.latencyMs != null
              ? t("testOk", { model: tested, latency: verdict.latencyMs })
              : t("testOkNoLatency", { model: tested }),
        });
        return;
      }
      // The server's own `error` text is never rendered: the reason comes from
      // the machine code it classified (modelsTestReason.ts).
      if (verdict?.code === "model_required") setAskModel(true);
      setNote({ ok: false, text: reasonFor(verdict, t("testFailed")) });
    } catch {
      setNote({ ok: false, text: t("testFailed") });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-md border border-stone-200 bg-paper/50 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{label}</span>
        <Badge tone={entry.scope === "byom" ? "info" : "neutral"} label={scope} />
        {entry.endpoint ? <span className="break-all text-steel">{entry.endpoint}</span> : null}
        {/* The configured OpenAI-compatible server (Ollama / LM Studio / a gateway).
            It is not a secret and it decides WHERE this key is sent, so the row that
            lists what is stored has to show it — it was the one stored field the
            list dropped, which is how it could also be wiped unnoticed on a save. */}
        {entry.baseUrl ? <span className="break-all text-steel">{entry.baseUrl}</span> : null}
        {entry.apiVersion ? <span className="text-steel">{t("apiVersionValue", { version: entry.apiVersion })}</span> : null}
        <span className="ml-auto flex items-center gap-2">
          <span className="text-steel">
            {t("updated", { date: format.dateTime(new Date(entry.updatedAt), { dateStyle: "medium" }) })}
          </span>
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={testing || deleting === id}
            aria-label={t("testAria", { provider: label, scope })}
            className={`${BTN_SECONDARY} h-7 px-2.5 text-sm`}
          >
            {testing ? t("testing") : t("test")}
          </button>
          <button
            type="button"
            onClick={() => onRemove(entry.provider, entry.scope)}
            disabled={deleting === id}
            title={t("delete")}
            aria-label={t("deleteAria", { provider: label, scope })}
            className="focus-ring inline-flex items-center rounded-md border border-stone-200 bg-white p-1 text-steel hover:border-coral/40 hover:text-coral disabled:opacity-50"
          >
            <Trash2 size={13} aria-hidden />
          </button>
        </span>
      </div>

      {askModel ? (
        <label className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-sm text-steel">{t("testModelLabel")}</span>
          <TextInput
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t("testModelPlaceholder")}
            sizeVariant="sm"
            className="min-w-48 flex-1 font-mono"
          />
        </label>
      ) : null}

      {note ? (
        <p role={note.ok ? "status" : "alert"} className={`mt-2 text-sm font-medium ${note.ok ? "text-moss" : "text-coral"}`}>
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
