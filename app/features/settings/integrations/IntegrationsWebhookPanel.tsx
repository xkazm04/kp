"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RotateCcw, Send, Webhook } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY, BTN_SECONDARY, CARD_PAD, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { toast } from "@/app/_components/toast-store";
import { useErrorMessage } from "@/app/_lib/use-error-message";
// The payload version comes FROM its authority: ats-record.ts is pure and
// dependency-free by design, its own comment says "bump on any breaking change",
// and a copy here would keep naming the old contract after that bump.
import { ATS_SCHEMA_VERSION } from "@/app/_lib/ats-record";
import { IntegrationsWebhookFields } from "./IntegrationsWebhookFields";
import { PULL_ENDPOINT, SIGNATURE_HEADER_DISPLAY } from "./integrationsWebhookIdentifiers";

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

// Identifiers rendered in mono type are named constants rather than JSX text
// because they are the literal strings an operator matches against their own
// system — and they now come from integrationsWebhookIdentifiers.ts, which ties
// each one to its authority instead of restating it. Naming them as constants
// while pointing them at literals was the half-measure this replaces.

type Config = { webhookUrl: string | null; events: string[]; hasSecret: boolean; version: number };

export function IntegrationsWebhookPanel() {
  const tToast = useTranslations("integrations");
  const t = useTranslations("integrations.webhook");
  // A coded failure resolves through the `errors` catalog; the inline fallback is
  // this panel's own copy. The server's raw `error` is never what reaches the
  // screen (app/_lib/use-error-message.ts).
  const errMsg = useErrorMessage();
  const [url, setUrl] = useState("");
  // The version the form was composed against — echoed on save so the store can drop a
  // write built on a config someone else has since replaced (409 ATS_CONFIG_STALE)
  // instead of clobbering theirs. `null` until the config has been read back.
  const [version, setVersion] = useState<number | null>(null);
  // A stale save leaves an offer, not just a message: the server sends the CURRENT
  // config with its 409, so "reload" is a local re-seed of the form rather than a
  // second fetch (and a second chance to race).
  const [stale, setStale] = useState<Config | null>(null);
  // What the server last CONFIRMED is stored. `url` is the edit buffer; the test ping
  // pings whatever is stored, so it is only meaningful while the two agree.
  const [savedUrl, setSavedUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [hasSecret, setHasSecret] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  // What the server last confirmed for the SUBSCRIPTIONS, so the save can send only
  // what actually changed (IntegrationsAtsPanel's contract on the inbound half).
  const [savedEvents, setSavedEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The ping RESULT, with its verdict. It used to be a bare string rendered in
  // neutral grey under role="status" — so "Not delivered: connection refused"
  // and "Delivered: endpoint responded 200" looked and announced identically,
  // on the one panel whose whole design is about never reporting proof a ping
  // did not earn. `role={ok ? "status" : "alert"}` is this tab's own convention
  // (IntegrationsAtsForm, IntegrationsCallbackBanner).
  const [test, setTest] = useState<{ text: string; ok: boolean } | null>(null);
  // Has the stored config actually been read back? The save is a partial now, but the
  // diff it sends is computed against `savedUrl`/`savedEvents` — which a form that never
  // loaded holds as blanks, so every field would read as "the operator cleared it", and
  // an empty URL is a legitimate "disable delivery". Until this is true there is nothing
  // on screen worth writing, and the button says so instead of offering the destructive
  // click. (It also gates the `expectedVersion` echo: there is no version to echo yet.)
  const [loaded, setLoaded] = useState(false);

  // Seed every "what the server confirmed" mirror from one config object. Used by the
  // initial load, by an accepted save, and by the reload affordance a 409 offers.
  const adopt = (config: Config) => {
    setUrl(config.webhookUrl ?? "");
    setSavedUrl(config.webhookUrl ?? "");
    setEvents(config.events ?? []);
    setSavedEvents(config.events ?? []);
    setHasSecret(!!config.hasSecret);
    setVersion(config.version ?? 0);
    setSecret("");
  };

  useEffect(() => {
    fetch("/api/ats/config")
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as { config?: Config } | null;
        // The status has to be read: a non-2xx here (an expired or non-operator session
        // answers 401 with a perfectly parseable JSON body) never reaches `.catch`, so the
        // old `if (d.config)` shape swallowed it — leaving a blank endpoint field and a
        // "· not set" signing-secret badge over a deployment that has both configured.
        if (!r.ok || !d?.config) throw new Error("ats config load failed");
        adopt(d.config);
        setLoaded(true);
      })
      // A silently-empty form here is dangerous: saving it would overwrite the
      // stored config with blanks. Saying the load failed was only half of that —
      // the toast scrolls away and the Save button stayed live over a blank form,
      // one click from wiping a working endpoint and its subscriptions. Now the
      // refusal is structural (`loaded` gates the button) and the reason stays on
      // screen next to it.
      .catch(() => {
        toast.error(tToast("configLoadFailed"));
        setError(t("loadBlockedSave"));
      });
  }, [tToast, t]);

  const toggle = (id: string) => setEvents((cur) => (cur.includes(id) ? cur.filter((e) => e !== id) : [...cur, id]));

  // Editing the endpoint retires the last ping result with it — a "Delivered: endpoint
  // responded 200" line left sitting under a URL the ping never touched reads as proof
  // about the new address.
  const editUrl = (value: string) => {
    setUrl(value);
    setTest(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setStale(null);
    try {
      // EVERY field is a PARTIAL update (setAtsConfig: omitted = keep), so send only what
      // the operator actually touched. This panel used to resend `webhookUrl` AND `events`
      // on every submit, which made each save a blind write of a snapshot taken when the
      // tab loaded — a second operator's event subscriptions were silently dropped by a
      // save that only meant to change the endpoint. The inbound ATS panel next to it
      // already sent partials; this is the same contract on the outbound half.
      //   • secret blank        → omitted. The store reads "" as CLEAR, so submitting the
      //                           untouched field would unsign a working integration.
      //   • url unchanged       → omitted. A blanked url is still sent (as ""), because
      //                           clearing it is the documented "disable delivery".
      //   • events unchanged    → omitted.
      const body: Record<string, unknown> = {};
      if (url !== savedUrl) body.webhookUrl = url;
      if (events.length !== savedEvents.length || events.some((e) => !savedEvents.includes(e))) body.events = events;
      if (secret) body.webhookSecret = secret;
      // The version the form was composed against. Sent even on a no-op save: the point
      // is to be told the config moved, not to win the write.
      if (version !== null) body.expectedVersion = version;
      const r = await fetch("/api/ats/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json().catch(() => null)) as { config?: Config; error?: string; code?: string } | null;
      // 409: somebody saved first and NOTHING was written. The remedy is to reload what is
      // stored and re-apply — never to retry the same body, which would just clobber them
      // one round later. The current config rides with the refusal, so the offer is local.
      if (r.status === 409 && d?.config) {
        setStale(d.config);
        setError(errMsg(d, t("saveFailed")));
        return;
      }
      if (!r.ok || !d?.config) throw new Error(errMsg(d, t("saveFailedStatus", { status: r.status })));
      adopt(d.config);
      toast.success(tToast("saved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  // `/api/ats/test` pings the STORED endpoint with the STORED secret — it has no idea what
  // is in this form. So the button stays disabled until the field matches what the server
  // confirmed: on a typed-but-unsaved URL it would ping the previous endpoint and report
  // "Delivered: endpoint responded 200", which the operator reads as proof of the address
  // on screen. Save first, then test what was saved.
  const testable = !!savedUrl && url === savedUrl;

  const sendTest = async () => {
    setBusy(true);
    setTest(null);
    setError(null);
    try {
      const r = await fetch("/api/ats/test", { method: "POST" });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; status?: number; reason?: string } | null;
      if (r.ok && d?.ok) setTest({ text: t("delivered", { status: d.status ?? 0 }), ok: true });
      // `reason` is the endpoint's own verbatim refusal (not an { error, code }
      // envelope) — the detail IS the information, so it passes through.
      else setTest({ text: t("notDelivered", { reason: d?.reason || `HTTP ${r.status}` }), ok: false });
    } catch (e) {
      setTest({ text: e instanceof Error ? e.message : t("pingFailed"), ok: false });
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
          version: ATS_SCHEMA_VERSION,
          header: SIGNATURE_HEADER_DISPLAY,
          code: (chunks) => <span className="font-mono">{chunks}</span>,
          b: (chunks) => <strong>{chunks}</strong>,
        })}
      </p>

      <IntegrationsWebhookFields
        url={url}
        onUrlChange={editUrl}
        secret={secret}
        onSecretChange={setSecret}
        hasSecret={hasSecret}
        events={events}
        onToggleEvent={toggle}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void save()} disabled={busy || !loaded} className={`${BTN_PRIMARY} h-8 px-3 text-sm`}>
          {t("save")}
        </button>
        <button
          type="button"
          onClick={() => void sendTest()}
          disabled={busy || !testable}
          className={`${BTN_SECONDARY} h-8 gap-1.5 px-3 text-sm font-semibold`}
        >
          <Send size={13} aria-hidden /> {t("sendTest")}
        </button>
      </div>

      {test ? (
        <p role={test.ok ? "status" : "alert"} className={`mt-2 text-sm ${test.ok ? "text-steel" : "text-coral"}`}>
          {test.text}
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="mt-2 rounded-md border border-coral/40 bg-coral/5 px-3 py-2 text-sm text-coral">
          <p className="flex items-start gap-1.5">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden /> {error}
          </p>
          {stale ? (
            <button
              type="button"
              onClick={() => {
                adopt(stale);
                setStale(null);
                setError(null);
                setTest(null);
              }}
              className={`${BTN_SECONDARY} mt-2 h-8 gap-1.5 px-3 text-sm font-semibold`}
            >
              <RotateCcw size={13} aria-hidden /> {t("reloadStored")}
            </button>
          ) : null}
        </div>
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
