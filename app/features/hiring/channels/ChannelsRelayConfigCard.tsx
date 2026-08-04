"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Radio, Send, ShieldCheck } from "lucide-react";
import { Badge } from "@/app/_components/Badge";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_PRIMARY, BTN_SECONDARY, META_LABEL } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";

// Outbound delivery relay — the missing UI for what used to be env-only
// COMMS_WEBHOOK_URL (the IntegrationsCard/ATS pattern applied to comms):
// endpoint URL + write-only signing secret + an honest test ping. While the env
// var is set it wins over this form (comms-relay.ts precedence) and the editor
// says so instead of pretending the form is in charge.
type RelayState = { url: string; hasSecret: boolean; envConfigured: boolean };

export function RelayConfigCard() {
  const t = useTranslations("channels.relay");
  // Save failures resolve from the machine `code`, never the server's English
  // `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const [state, setState] = useState<RelayState | null>(null);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/comms/relay")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { config?: { url: string | null; hasSecret: boolean }; envConfigured?: boolean } | null) => {
        if (!alive || !d?.config) return;
        setState({ url: d.config.url ?? "", hasSecret: d.config.hasSecret, envConfigured: Boolean(d.envConfigured) });
        setUrl(d.config.url ?? "");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const body: { url: string; secret?: string } = { url: url.trim() };
      if (secret !== "") body.secret = secret;
      const r = await fetch("/api/comms/relay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json().catch(() => null)) as { config?: { url: string | null; hasSecret: boolean }; error?: string; code?: string } | null;
      if (r.ok && d?.config) {
        setState((s) => (s ? { ...s, url: d.config?.url ?? "", hasSecret: Boolean(d.config?.hasSecret) } : s));
        setSecret("");
        setNote({ ok: true, text: t("saved") });
      } else {
        setNote({ ok: false, text: errMsg(d, t("saveFailed")) });
      }
    } catch {
      setNote({ ok: false, text: t("saveFailed") });
    } finally {
      setBusy(false);
    }
  }, [url, secret, t, errMsg]);

  const testPing = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch("/api/comms/relay/test", { method: "POST" });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; status?: number; reason?: string } | null;
      if (d?.ok) {
        setNote({ ok: true, text: t("testOk", { status: d.status ?? 200 }) });
      } else {
        setNote({ ok: false, text: t("testFailed", { reason: d?.reason ?? `HTTP ${d?.status ?? "?"}` }) });
      }
    } catch {
      setNote({ ok: false, text: t("testFailed", { reason: "network" }) });
    } finally {
      setBusy(false);
    }
  }, [t]);

  // Tier 2 (docs/design/loading-choreography.md): the config fetch is in flight (or an
  // operator-gated read failed — demo session / restricted member, same shape as
  // "no data" here). Hold the card's height so the ledger below doesn't jump when
  // it lands, and stay invisible for 150ms so a fast response paints nothing.
  if (!state) return <div className="reveal-quiet min-h-[7rem]" aria-hidden />;

  const active = state.envConfigured || state.url.trim() !== "";

  return (
    <section aria-label={t("title")} className="animate-arrive-in rounded-lg border border-stone-200 bg-paper/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden className="inline-grid h-8 w-8 place-items-center rounded-lg border border-stone-200 bg-white text-steel">
          <Radio size={15} />
        </span>
        <h3 className="font-semibold text-ink">{t("title")}</h3>
        <Badge tone={active ? "positive" : "neutral"} label={active ? t("statusOn") : t("statusOff")} />
        {state.hasSecret ? <Badge tone="info" icon={ShieldCheck} label={t("secretSet")} /> : null}
      </div>
      <p className="mt-1.5 max-w-2xl text-sm text-steel">{t("intro")}</p>

      {state.envConfigured ? (
        <p className="mt-3 rounded-md border border-dashed border-stone-300 bg-white px-3 py-2 text-sm text-steel">{t("envNote")}</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-64">
            <label htmlFor="relay-url" className={`${META_LABEL} block`}>
              {t("urlLabel")}
            </label>
            <TextInput id="relay-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" sizeVariant="sm" className="mt-1 w-full" />
          </div>
          <div className="min-w-0 flex-1 basis-52">
            <label htmlFor="relay-secret" className={`${META_LABEL} block`}>
              {t("secretLabel")}
            </label>
            <TextInput
              id="relay-secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={state.hasSecret ? t("secretKeepPlaceholder") : t("secretPlaceholder")}
              sizeVariant="sm"
              className="mt-1 w-full"
            />
          </div>
          <button type="button" onClick={save} disabled={busy} className={`${BTN_PRIMARY} h-9 px-4 text-sm`}>
            {t("save")}
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={testPing} disabled={busy || !active} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
          <Send size={14} aria-hidden /> {t("test")}
        </button>
        {note ? (
          <span role="status" aria-live="polite" className={`text-sm font-medium ${note.ok ? "text-moss" : "text-coral"}`}>
            {note.text}
          </span>
        ) : null}
      </div>
    </section>
  );
}
