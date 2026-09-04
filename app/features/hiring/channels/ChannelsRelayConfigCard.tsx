"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Radio, Send, ShieldCheck } from "lucide-react";
import { Badge } from "@/app/_components/Badge";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_PRIMARY, BTN_SECONDARY, META_LABEL } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";

// Outbound delivery relay — the missing UI for what used to be env-only
// COMMS_WEBHOOK_URL (the IntegrationsCard/ATS pattern applied to comms):
// endpoint URL + write-only signing secret + an honest test ping. While the env
// var is set it wins over this form (comms-relay.ts precedence) and the editor
// says so instead of pretending the form is in charge.
//
// Render cascade: this card is almost entirely STATIC — a heading, an intro, two
// labelled fields and two buttons — and it used to render none of it until
// GET /api/comms/relay came back, behind an empty reserved-height box. Worse, a
// failed or operator-gated read left `state` null forever, so the whole editor
// silently ceased to exist. Now the shell paints on the first frame and only the
// three genuinely data-derived bits wait: the on/off badge, the secret badge and
// the env-override note. A read that never lands leaves a usable form — the POST,
// not the GET, is what configures the relay.
// `version` is the store's optimistic-concurrency counter: the save echoes the
// version this card READ, and the store refuses (409) a write built on an older one
// rather than merging it. The POST is a full replace, so two operators — or one in two
// tabs — used to overwrite each other's endpoint with no sign anything had happened,
// and the loser's outbound mail went to the wrong relay.
// `relay` is the server's health word (comms-relay.ts RelayHealth). "unreadable"
// is the one the card could never work out for itself: an endpoint IS stored, but
// its signing secret does not decrypt under this deployment's key, so nothing is
// delivered — and painting that as "Not configured" is how a rotated KP_SECRET
// stayed invisible while every letter quietly queued.
type RelayHealthWord = "env" | "configured" | "unconfigured" | "unreadable";
type RelayState = { url: string; hasSecret: boolean; envConfigured: boolean; version: number; relay: RelayHealthWord };

const HEALTH_WORDS = ["env", "configured", "unconfigured", "unreadable"] as const;
function isHealthWord(v: unknown): v is RelayHealthWord {
  return typeof v === "string" && (HEALTH_WORDS as readonly string[]).includes(v);
}

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
  // The field is live from the first frame, so the arriving config must not
  // overwrite what someone has already typed into it.
  const urlTouched = useRef(false);

  // Pure read, no state of its own, so BOTH the mount effect and a successful save
  // can adopt the same authoritative answer. Null = "still unknown" (in flight,
  // failed, or operator-denied) — never a fabricated default.
  const readConfig = useCallback(async (): Promise<RelayState | null> => {
    try {
      const r = await fetch("/api/comms/relay");
      if (!r.ok) return null;
      const d = (await r.json()) as
        | { config?: { url: string | null; hasSecret: boolean; version?: number }; envConfigured?: boolean; relay?: string }
        | null;
      if (!d?.config) return null;
      return {
        url: d.config.url ?? "",
        hasSecret: d.config.hasSecret,
        envConfigured: Boolean(d.envConfigured),
        version: d.config.version ?? 0,
        // An older server (or a shape we do not recognise) is not evidence of a
        // fault: fall back to the two states the url alone can justify.
        relay: isHealthWord(d.relay) ? d.relay : d.config.url ? "configured" : "unconfigured",
      };
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    readConfig().then((next) => {
      if (!alive || !next) return;
      setState(next);
      if (!urlTouched.current) setUrl(next.url);
    });
    return () => {
      alive = false;
    };
  }, [readConfig]);

  const save = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const body: { url: string; secret?: string; expectedVersion?: number } = { url: url.trim() };
      if (secret !== "") body.secret = secret;
      // Only when the read landed: a version we never read is not a claim we can make,
      // and omitting it means "no concurrency check" — the same behaviour as before.
      if (state) body.expectedVersion = state.version;
      const r = await fetch("/api/comms/relay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json().catch(() => null)) as
        | { config?: { url: string | null; hasSecret: boolean; version?: number }; error?: string; code?: string }
        | null;
      if (r.ok && d?.config) {
        setSecret("");
        setNote({ ok: true, text: t("saved") });
        // RE-READ rather than patch the old state. The POST echoes the stored config
        // but says nothing about `envConfigured`, and when the initial GET never
        // landed there was no state to patch at all — so `setState(s => s ? … : s)`
        // was a no-op and the card kept its pending pill and a disabled Test button
        // over a relay the operator had *just* configured.
        const next = await readConfig();
        if (next) setState(next);
      } else {
        // Includes the 409: someone else saved a newer config, so nothing was written.
        // errMsg resolves COMMS_RELAY_STALE (and COMMS_RELAY_INVALID) in the reader's
        // language, and the refusal carries the CURRENT config — adopt it so the field
        // and badges show what is actually stored before the operator tries again.
        setNote({ ok: false, text: errMsg(d, t("saveFailed")) });
        if (r.status === 409) {
          const next = await readConfig();
          if (next) {
            setState(next);
            setUrl(next.url);
          }
        }
      }
    } catch {
      setNote({ ok: false, text: t("saveFailed") });
    } finally {
      setBusy(false);
    }
  }, [url, secret, state, t, errMsg, readConfig]);

  const testPing = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch("/api/comms/relay/test", { method: "POST" });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; status?: number; reason?: string; code?: string; error?: string } | null;
      if (d?.ok) {
        setNote({ ok: true, text: t("testOk", { status: d.status ?? 200 }) });
      } else if (d?.code) {
        // The probe is now `org:manage`-gated and throttled (/perfect wave 27), so a
        // refusal arrives as a CODE with no `reason` — which the old branch painted as
        // the nonsense "HTTP ?". A refusal is about the CALLER, not the endpoint, so it
        // replaces the whole sentence rather than filling its {reason} slot.
        setNote({ ok: false, text: errMsg(d, t("testFailed", { reason: `HTTP ${d.status ?? "?"}` })) });
      } else {
        setNote({ ok: false, text: t("testFailed", { reason: d?.reason ?? `HTTP ${d?.status ?? "?"}` }) });
      }
    } catch {
      setNote({ ok: false, text: t("testFailed", { reason: "network" }) });
    } finally {
      setBusy(false);
    }
  }, [t, errMsg]);

  // Tier 2 (docs/design/loading-choreography.md) applied per-BIT rather than to the
  // whole card: the config read may still be in flight, or have failed / been denied
  // to a demo session — either way the editor renders, and only what the response
  // would have told us is held back.
  const active = state ? state.envConfigured || state.url.trim() !== "" : false;
  // A stored endpoint we cannot sign for is NOT "on": the Test button would probe a
  // relay the send path refuses to use, and the badge would claim delivery.
  const unreadable = state?.relay === "unreadable";
  // The POST is a full REPLACE: setRelayConfig treats an absent/empty `url` as "disable
  // the relay" (comms-relay-store.ts validateUrl), and there is no "keep the stored
  // one" shape. So an empty field is only a legitimate save once we KNOW the field
  // reflects what is stored. While the GET is in flight — or after it failed, which is
  // the state this card deliberately stays usable in — the field is empty because we
  // never read it, and saving it silently cleared a live relay URL: a secret rotation
  // typed on a failed read stopped ALL outbound delivery and answered "Saved". Held
  // back like the badge and Test above, whose "unknown ⇒ say nothing" rule this is.
  const blankSaveOnUnknownConfig = state === null && url.trim() === "";

  return (
    <section aria-label={t("title")} className="rounded-lg border border-stone-200 bg-paper/50 p-4">
      <div className="flex min-h-[2rem] flex-wrap items-center gap-2">
        <span aria-hidden className="inline-grid h-8 w-8 place-items-center rounded-lg border border-stone-200 bg-white text-steel">
          <Radio size={15} />
        </span>
        <h3 className="font-semibold text-ink">{t("title")}</h3>
        {/* Same pending-pill idiom the section header uses for its own status
            (ChannelsTabStage): on/off is a FACT about the deployment, so it waits
            for the read rather than guessing a default. */}
        {state ? (
          <Badge
            tone={unreadable ? "critical" : active ? "positive" : "neutral"}
            icon={unreadable ? AlertTriangle : undefined}
            label={unreadable ? t("statusUnreadable") : active ? t("statusOn") : t("statusOff")}
          />
        ) : (
          <span className="reveal-quiet inline-block h-5 w-16 rounded-full bg-stone-100" aria-hidden />
        )}
        {state?.hasSecret ? <Badge tone="info" icon={ShieldCheck} label={t("secretSet")} /> : null}
      </div>
      <p className="mt-1.5 max-w-2xl text-sm text-steel">{t("intro")}</p>

      {unreadable ? (
        <p role="status" className="mt-3 rounded-md border border-coral/40 bg-coral/5 px-3 py-2 text-sm text-ink">
          {t("unreadableNote")}
        </p>
      ) : null}

      {state?.envConfigured ? (
        <p className="mt-3 rounded-md border border-dashed border-stone-300 bg-white px-3 py-2 text-sm text-steel">{t("envNote")}</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-64">
            <label htmlFor="relay-url" className={`${META_LABEL} block`}>
              {t("urlLabel")}
            </label>
            <TextInput
              id="relay-url"
              value={url}
              onChange={(e) => {
                urlTouched.current = true;
                setUrl(e.target.value);
              }}
              placeholder="https://…"
              sizeVariant="sm"
              className="mt-1 w-full"
            />
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
              // Until the read lands we don't know whether a secret is stored, and
              // the two placeholders make opposite promises ("leave blank to keep"
              // vs "set one") — so the neutral one holds until we do.
              placeholder={state?.hasSecret ? t("secretKeepPlaceholder") : t("secretPlaceholder")}
              sizeVariant="sm"
              className="mt-1 w-full"
            />
          </div>
          <button type="button" onClick={save} disabled={busy || blankSaveOnUnknownConfig} className={`${BTN_PRIMARY} h-9 px-4 text-sm`}>
            {t("save")}
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={testPing} disabled={busy || !active || unreadable} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
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
