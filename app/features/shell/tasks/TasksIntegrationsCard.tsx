"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, KeyRound, Plug, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { TextInput } from "@/app/_components/TextInput";
import { Checkbox } from "@/app/_components/Checkbox";
import { useErrorMessage } from "@/app/_lib/use-error-message";

// P1-5 — the ATS/HRIS write-back panel. The only egress used to be a whole-DB JSON
// dump ("not an integration, that's a backup" — Marcus #12). This configures a
// signed outbound webhook + surfaces the per-candidate export endpoint.
//
// Copy reads from `tasks.integrations` (the toasts keep the shared `integrations`
// namespace they already used). What stays verbatim is machine surface: the event
// IDs, the payload version `kp.ats.v1`, the `X-Kp-Signature` header, the example
// URL and the pull endpoint — identifiers a reader types or matches, not copy.
//
// HONEST CEILING (stated in the UI): this is vendor-neutral egress, not a certified
// Workday/Greenhouse/Lever connector. Point your connector or an iPaaS (Merge.dev,
// Zapier) at the webhook; the payload is a stable, versioned record (kp.ats.v1).

// The wire event ids, paired with the catalog key naming each one.
const SUBSCRIBABLE = [
  { id: "candidate.hired", key: "candidateHired" },
  { id: "candidate.rejected", key: "candidateRejected" },
  { id: "offer.accepted", key: "offerAccepted" },
  { id: "offer.declined", key: "offerDeclined" },
] as const;

// Identifiers rendered in mono type: named constants, not JSX text, because they
// are the literal strings an operator matches against their own system.
const PAYLOAD_VERSION = "kp.ats.v1";
const SIGNATURE_HEADER = "X-Kp-Signature";
const HIRED_EVENT = "candidate.hired";
const EXAMPLE_WEBHOOK_URL = "https://your-ats.example.com/hooks/kp";
const PULL_ENDPOINT = "GET /api/ats/candidate/<entryId>";

type Config = { webhookUrl: string | null; events: string[]; hasSecret: boolean };

export function IntegrationsCard() {
  const tToast = useTranslations("integrations");
  const t = useTranslations("tasks");
  // A coded failure resolves through the `errors` catalog; the inline fallback is
  // this card's own copy. The server's raw `error` is never what reaches the
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
      if (!r.ok || !d?.config) throw new Error(errMsg(d, t("integrations.saveFailedStatus", { status: r.status })));
      setUrl(d.config.webhookUrl ?? "");
      setEvents(d.config.events ?? []);
      setHasSecret(!!d.config.hasSecret);
      setSecret("");
      toast.success(tToast("saved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("integrations.saveFailed"));
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
      if (r.ok && d?.ok) setTest(t("integrations.delivered", { status: d.status ?? 0 }));
      // `reason` is the endpoint's own verbatim refusal (not an { error, code }
      // envelope) — the detail IS the information, so it passes through.
      else setTest(t("integrations.notDelivered", { reason: d?.reason || `HTTP ${r.status}` }));
    } catch (e) {
      setTest(e instanceof Error ? e.message : t("integrations.pingFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-1.5 font-serif text-h2 text-ink">
          <Plug size={16} className="text-steel" /> {t("integrations.title")}
        </h3>
        <span className="text-meta uppercase text-steel">{t("integrations.meta")}</span>
      </div>
      <p className="mt-2 text-sm text-steel">
        {t.rich("integrations.intro", {
          version: PAYLOAD_VERSION,
          header: SIGNATURE_HEADER,
          code: (chunks) => <span className="font-mono">{chunks}</span>,
          b: (chunks) => <strong>{chunks}</strong>,
        })}
      </p>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">{t("integrations.webhookUrl")}</span>
          <TextInput
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={EXAMPLE_WEBHOOK_URL}
            sizeVariant="sm"
            className="font-mono"
          />
          <span className="mt-1 block text-meta text-steel">{t("integrations.leaveEmpty")}</span>
        </label>

        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
            <KeyRound size={13} className="text-steel" /> {t("integrations.signingSecret")}
            <span className="font-normal text-meta text-steel">
              {hasSecret ? t("integrations.secretSet") : t("integrations.secretNotSet")}
            </span>
          </span>
          <TextInput
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={hasSecret ? t("integrations.secretPlaceholderSet") : t("integrations.secretPlaceholderNew")}
            autoComplete="new-password"
            sizeVariant="sm"
            className="font-mono"
          />
        </label>

        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-ink">{t("integrations.events")}</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {SUBSCRIBABLE.map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-sm text-steel">
                <Checkbox checked={events.includes(e.id)} onChange={() => toggle(e.id)} />
                {t(`integrations.event.${e.key}`)}
              </label>
            ))}
          </div>
          <p className="mt-1 text-meta text-steel">
            {t.rich("integrations.eventsNote", {
              event: HIRED_EVENT,
              code: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
            })}
          </p>
        </fieldset>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-white hover:bg-steel disabled:opacity-60"
        >
          {t("integrations.save")}
        </button>
        <button
          type="button"
          onClick={() => void sendTest()}
          disabled={busy || !url}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-paper disabled:opacity-60"
        >
          <Send size={13} /> {t("integrations.sendTest")}
        </button>
      </div>

      {test ? <p role="status" className="mt-2 text-sm text-steel">{test}</p> : null}
      {error ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-md border border-coral/40 bg-coral/5 px-3 py-2 text-sm text-coral">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden /> {error}
        </p>
      ) : null}

      <p className="mt-4 border-t border-stone-200 pt-3 text-meta text-steel">
        {t.rich("integrations.pullNote", {
          endpoint: PULL_ENDPOINT,
          code: (chunks) => <span className="font-mono text-ink">{chunks}</span>,
        })}
      </p>
    </div>
  );
}
