"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Send, Webhook } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY, BTN_SECONDARY, CARD_PAD, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { toast } from "@/app/_components/toast-store";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { IntegrationsWebhookFields } from "./IntegrationsWebhookFields";

// P1-5 — the ATS/HRIS write-back panel. The only egress used to be a whole-DB JSON
// dump ("not an integration, that's a backup" — Marcus #12). This configures a
// signed outbound webhook + surfaces the per-candidate export endpoint.
//
// It lived on the Background-tasks tab, which is where the operator-only surfaces
// had collected; an operator asking "what can this connect to" looks at Settings →
// Integrations, so it renders here now, directly under the INBOUND ATS panel it is
// the mirror image of (that one reads applications in, this one writes outcomes
// back). Copy reads from `integrations.webhook`; the toasts keep the shared
// `integrations` namespace they already used. What stays verbatim is machine
// surface: the event IDs, the payload version `kp.ats.v1`, the `X-Kp-Signature`
// header, the example URL and the pull endpoint — identifiers a reader types or
// matches, not copy.
//
// HONEST CEILING (stated in the UI): this is vendor-neutral egress, not a certified
// Workday/Greenhouse/Lever connector. Point your connector or an iPaaS (Merge.dev,
// Zapier) at the webhook; the payload is a stable, versioned record (kp.ats.v1).

// Identifiers rendered in mono type: named constants, not JSX text, because they
// are the literal strings an operator matches against their own system. (The
// event ids and the example URL live with the fields that render them.)
const PAYLOAD_VERSION = "kp.ats.v1";
const SIGNATURE_HEADER = "X-Kp-Signature";
const PULL_ENDPOINT = "GET /api/ats/candidate/<entryId>";

type Config = { webhookUrl: string | null; events: string[]; hasSecret: boolean };

export function IntegrationsWebhookPanel() {
  const tToast = useTranslations("integrations");
  const t = useTranslations("integrations.webhook");
  // A coded failure resolves through the `errors` catalog; the inline fallback is
  // this panel's own copy. The server's raw `error` is never what reaches the
  // screen (app/_lib/use-error-message.ts).
  const errMsg = useErrorMessage();
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [hasSecret, setHasSecret] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ats/config")
      .then((r) => r.json())
      .then((d: { config?: Config }) => {
        if (d.config) {
          setUrl(d.config.webhookUrl ?? "");
          setEvents(d.config.events ?? []);
          setHasSecret(!!d.config.hasSecret);
        }
      })
      // A silently-empty form here is dangerous: saving it would overwrite the
      // stored config with blanks. Say the load failed.
      .catch(() => {
        toast.error(tToast("configLoadFailed"));
      });
  }, [tToast]);

  const toggle = (id: string) => setEvents((cur) => (cur.includes(id) ? cur.filter((e) => e !== id) : [...cur, id]));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // Only send webhookSecret when the operator typed a new one — an untouched
      // field leaves the stored secret in place (write-only; never read back).
      const body: Record<string, unknown> = { webhookUrl: url, events };
      if (secret) body.webhookSecret = secret;
      const r = await fetch("/api/ats/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json().catch(() => null)) as { config?: Config; error?: string; code?: string } | null;
      if (!r.ok || !d?.config) throw new Error(errMsg(d, t("saveFailedStatus", { status: r.status })));
      setUrl(d.config.webhookUrl ?? "");
      setEvents(d.config.events ?? []);
      setHasSecret(!!d.config.hasSecret);
      setSecret("");
      toast.success(tToast("saved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setTest(null);
    setError(null);
    try {
      const r = await fetch("/api/ats/test", { method: "POST" });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; status?: number; reason?: string } | null;
      if (r.ok && d?.ok) setTest(t("delivered", { status: d.status ?? 0 }));
      // `reason` is the endpoint's own verbatim refusal (not an { error, code }
      // envelope) — the detail IS the information, so it passes through.
      else setTest(t("notDelivered", { reason: d?.reason || `HTTP ${r.status}` }));
    } catch (e) {
      setTest(e instanceof Error ? e.message : t("pingFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${PANEL} ${CARD_PAD}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-2 font-serif text-h3 text-ink">
          <Webhook size={16} className="text-coral" aria-hidden /> {t("title")}
        </h3>
        <span className={META_LABEL}>{t("meta")}</span>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-steel">
        {t.rich("intro", {
          version: PAYLOAD_VERSION,
          header: SIGNATURE_HEADER,
          code: (chunks) => <span className="font-mono">{chunks}</span>,
          b: (chunks) => <strong>{chunks}</strong>,
        })}
      </p>

      <IntegrationsWebhookFields
        url={url}
        onUrlChange={setUrl}
        secret={secret}
        onSecretChange={setSecret}
        hasSecret={hasSecret}
        events={events}
        onToggleEvent={toggle}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void save()} disabled={busy} className={`${BTN_PRIMARY} h-8 px-3 text-sm`}>
          {t("save")}
        </button>
        <button
          type="button"
          onClick={() => void sendTest()}
          disabled={busy || !url}
          className={`${BTN_SECONDARY} h-8 gap-1.5 px-3 text-sm font-semibold`}
        >
          <Send size={13} aria-hidden /> {t("sendTest")}
        </button>
      </div>

      {test ? (
        <p role="status" className="mt-2 text-sm text-steel">
          {test}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-md border border-coral/40 bg-coral/5 px-3 py-2 text-sm text-coral">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden /> {error}
        </p>
      ) : null}

      <p className="mt-4 border-t border-stone-200 pt-3 text-meta text-steel">
        {t.rich("pullNote", {
          endpoint: PULL_ENDPOINT,
          code: (chunks) => <span className="font-mono text-ink">{chunks}</span>,
        })}
      </p>
    </div>
  );
}
