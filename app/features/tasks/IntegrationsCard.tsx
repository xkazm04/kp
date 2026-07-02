"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, KeyRound, Plug, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";

// P1-5 — the ATS/HRIS write-back panel. The only egress used to be a whole-DB JSON
// dump ("not an integration, that's a backup" — Marcus #12). This configures a
// signed outbound webhook + surfaces the per-candidate export endpoint. English-
// only, matching the sibling operator cards (BackupCard / SystemCard) in this tab —
// except the toast messages, which route through the shared bilingual feedback
// layer (the `integrations` catalog namespace).
//
// HONEST CEILING (stated in the UI): this is vendor-neutral egress, not a certified
// Workday/Greenhouse/Lever connector. Point your connector or an iPaaS (Merge.dev,
// Zapier) at the webhook; the payload is a stable, versioned record (kp.ats.v1).

const SUBSCRIBABLE = [
  { id: "candidate.hired", label: "Candidate hired" },
  { id: "candidate.rejected", label: "Candidate rejected" },
  { id: "offer.accepted", label: "Offer accepted" },
  { id: "offer.declined", label: "Offer declined" },
] as const;

type Config = { webhookUrl: string | null; events: string[]; hasSecret: boolean };

export function IntegrationsCard() {
  const t = useTranslations("integrations");
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
        toast.error(t("configLoadFailed"));
      });
  }, [t]);

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
      const d = (await r.json().catch(() => null)) as { config?: Config; error?: string } | null;
      if (!r.ok || !d?.config) throw new Error(d?.error || `Save failed (${r.status}).`);
      setUrl(d.config.webhookUrl ?? "");
      setEvents(d.config.events ?? []);
      setHasSecret(!!d.config.hasSecret);
      setSecret("");
      toast.success(t("saved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
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
      if (r.ok && d?.ok) setTest(`Delivered — endpoint responded ${d.status}.`);
      else setTest(`Not delivered — ${d?.reason || `HTTP ${r.status}`}.`);
    } catch (e) {
      setTest(e instanceof Error ? e.message : "Ping failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-1.5 font-serif text-h2 text-ink">
          <Plug size={16} className="text-steel" /> ATS / HRIS write-back
        </h3>
        <span className="text-meta uppercase text-steel">outbound webhook</span>
      </div>
      <p className="mt-2 text-sm text-steel">
        Mirror hiring outcomes into your system of record. Each subscribed event POSTs a normalized, versioned candidate
        record (<span className="font-mono">kp.ats.v1</span>), signed with HMAC-SHA256 (<span className="font-mono">X-Kp-Signature</span>)
        when a secret is set. This is vendor-neutral egress — point your Workday/Greenhouse/Lever connector or an iPaaS
        (Merge.dev, Zapier) at it; it is <strong>not</strong> a certified per-vendor connector.
      </p>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">Webhook URL</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-ats.example.com/hooks/kp"
            className="focus-ring w-full rounded-md border border-stone-300 px-2.5 py-1.5 font-mono text-sm"
          />
          <span className="mt-1 block text-meta text-steel">Leave empty to disable delivery.</span>
        </label>

        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
            <KeyRound size={13} className="text-steel" /> Signing secret
            <span className="font-normal text-meta text-steel">{hasSecret ? "· set (leave blank to keep)" : "· not set"}</span>
          </span>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={hasSecret ? "••••••••  (unchanged)" : "Optional — recommended"}
            autoComplete="new-password"
            className="focus-ring w-full rounded-md border border-stone-300 px-2.5 py-1.5 font-mono text-sm"
          />
        </label>

        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-ink">Events</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {SUBSCRIBABLE.map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-sm text-steel">
                <input type="checkbox" checked={events.includes(e.id)} onChange={() => toggle(e.id)} className="h-4 w-4 accent-coral" />
                {e.label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-meta text-steel">
            <span className="font-medium text-ink">candidate.hired</span> fires live on offer-accept today; the others are
            reserved for their lifecycle hooks.
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
          Save
        </button>
        <button
          type="button"
          onClick={() => void sendTest()}
          disabled={busy || !url}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-paper disabled:opacity-60"
        >
          <Send size={13} /> Send test ping
        </button>
      </div>

      {test ? <p role="status" className="mt-2 text-sm text-steel">{test}</p> : null}
      {error ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-md border border-coral/40 bg-coral/5 px-3 py-2 text-sm text-coral">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden /> {error}
        </p>
      ) : null}

      <p className="mt-4 border-t border-stone-200 pt-3 text-meta text-steel">
        Pull a single candidate on demand:{" "}
        <span className="font-mono text-ink">GET /api/ats/candidate/&lt;entryId&gt;</span> returns the same normalized record.
      </p>
    </div>
  );
}
