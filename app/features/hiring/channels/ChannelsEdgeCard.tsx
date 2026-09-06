"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CloudCog, Download, KeyRound, ShieldCheck } from "lucide-react";
import { Badge } from "@/app/_components/Badge";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_PRIMARY, BTN_SECONDARY, META_LABEL } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import type { EdgeErrorKind } from "@/app/_lib/edge-config";

// The edge pairing (docs/concepts/local-first-edge.md §3.2) — sibling of
// RelayConfigCard and built to the same rules, because it is the same kind of object
// (an endpoint + a write-only signing secret, with the env var winning when set) and
// an operator should only have to learn the pattern once.
//
// The honesty this card owes, and what each state actually means:
//   · NOT PAIRED   the default. Inbound webhooks and mail reach this machine only
//                  while it is running. Nothing is broken; it is a local-first app.
//   · PAIRED       the edge holds what arrives while the studio is closed, and the
//                  clock drains it on every tick.
//   · SEALED       this install published a key, so the edge cannot READ what it
//                  holds. The badge is absent when it can — never implied.
//   · SECRET MISSING  a URL with no shared secret. This USED to read as "Paired",
//                  green, while resolveEdge() returned null and the drain did nothing
//                  forever — the worst available lie, because an operator who is told
//                  it is working has no reason to look again.
//   · OFFLINE      KP_OFFLINE=1 wins over everything. The card says so instead of
//                  showing a pairing that will never be used.
//
// And what it now SHOWS, because the engine already knew it and threw it away: when
// the drain last ran, when the edge last heard from us, and how much is still queued
// there. A cursor alone cannot tell "caught up" from "500 behind".
type EdgeState = {
  url: string;
  hasSecret: boolean;
  sealed: boolean;
  cursor: number;
  lastDrainAt: string | null;
  lastHeartbeatAt: string | null;
  pending: number | null;
  lastErrorKind: EdgeErrorKind | null;
  nudgeTarget: string | null;
  envConfigured: boolean;
  offline: boolean;
};

/** One localized sentence per failure CLASS. A machine string (`HTTP 502`, `event 41
 *  could not be applied yet`) is not a sentence in any of the four languages this app
 *  ships, and interpolating it into `drainFailed: "{reason}"` shipped English to every
 *  reader. The kinds are a closed union, so a new one is a tsc error here rather than
 *  a blank line in the UI. */
const DRAIN_ERROR_KEY: Record<
  EdgeErrorKind,
  | "drainFailedUnreachable"
  | "drainFailedHeld"
  | "drainFailedAck"
  | "drainFailedSecretUnreadable"
  | "drainFailedUnknown"
> = {
  unreachable: "drainFailedUnreachable",
  held: "drainFailedHeld",
  ack: "drainFailedAck",
  secret_unreadable: "drainFailedSecretUnreadable",
  unknown: "drainFailedUnknown",
};

export function EdgeConfigCard() {
  const t = useTranslations("channels.edge");
  const errMsg = useErrorMessage();
  const rel = useRelativeTime();
  const [state, setState] = useState<EdgeState | null>(null);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [nudge, setNudge] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  // The fields are live from the first frame, so an arriving config must not
  // overwrite what someone has already typed (RelayConfigCard's rule).
  const touched = useRef(false);

  const readConfig = useCallback(async (): Promise<EdgeState | null> => {
    try {
      const r = await fetch("/api/edge");
      if (!r.ok) return null;
      const d = (await r.json()) as { config?: Partial<EdgeState> } | null;
      if (!d?.config) return null;
      const c = d.config;
      return {
        url: c.url ?? "",
        hasSecret: Boolean(c.hasSecret),
        sealed: Boolean(c.sealed),
        cursor: c.cursor ?? 0,
        lastDrainAt: c.lastDrainAt ?? null,
        lastHeartbeatAt: c.lastHeartbeatAt ?? null,
        pending: typeof c.pending === "number" ? c.pending : null,
        lastErrorKind: c.lastErrorKind ?? null,
        nudgeTarget: c.nudgeTarget ?? null,
        envConfigured: Boolean(c.envConfigured),
        offline: Boolean(c.offline),
      };
    } catch {
      return null;
    }
  }, []);

  const adopt = useCallback((next: EdgeState | null) => {
    if (!next) return;
    setState(next);
    if (!touched.current) {
      setUrl(next.url);
      setNudge(next.nudgeTarget ?? "");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    readConfig().then((next) => {
      if (alive) adopt(next);
    });
    return () => {
      alive = false;
    };
  }, [readConfig, adopt]);

  const save = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const body: { url: string; secret?: string; nudgeTarget: string } = { url: url.trim(), nudgeTarget: nudge.trim() };
      if (secret !== "") body.secret = secret;
      const r = await fetch("/api/edge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json().catch(() => null)) as { config?: Partial<EdgeState>; error?: string; code?: string } | null;
      if (r.ok && d?.config) {
        setSecret("");
        setNote({ ok: true, text: t("saved") });
        adopt(await readConfig());
      } else {
        setNote({ ok: false, text: errMsg(d, t("saveFailed")) });
      }
    } catch {
      setNote({ ok: false, text: t("saveFailed") });
    } finally {
      setBusy(false);
    }
  }, [url, secret, nudge, t, errMsg, readConfig, adopt]);

  const drainNow = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch("/api/edge/drain", { method: "POST" });
      const d = (await r.json().catch(() => null)) as {
        summary?: { applied?: number; skipped?: number; error?: string | null; errorKind?: EdgeErrorKind | null };
        config?: Partial<EdgeState>;
        error?: string;
        code?: string;
      } | null;
      // An error from the edge is reported as itself: a drain that reached nothing
      // must not read as "0 new leads", which is the same sentence a healthy quiet
      // queue produces. It is reported as a CLASS, never as the machine text.
      //
      // And a REFUSAL of the door is the same lie one layer up. This handler used to
      // read only `summary.error`, so a 403 (no `org:manage`) or a 500 — neither of
      // which carries a summary at all — rendered "Drained: 0 filed, 0 skipped" in
      // green, telling an operator who is not allowed to drain that the drain
      // succeeded. Non-ok is answered from the edge's failure CLASS when the body
      // carries one (the 409 for an unreadable secret does), otherwise from the
      // refusal CODE through the same resolver every other door uses.
      const kind = d?.summary?.errorKind;
      if (!r.ok || d?.summary?.error) {
        setNote({ ok: false, text: kind ? t(DRAIN_ERROR_KEY[kind]) : errMsg(d, t("drainFailedUnknown")) });
      } else {
        setNote({ ok: true, text: t("drained", { applied: d?.summary?.applied ?? 0, skipped: d?.summary?.skipped ?? 0 }) });
      }
      adopt(await readConfig());
    } catch {
      setNote({ ok: false, text: t("drainFailedUnreachable") });
    } finally {
      setBusy(false);
    }
  }, [t, errMsg, readConfig, adopt]);

  const enableSealing = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch("/api/edge/pair", { method: "POST" });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; code?: string } | null;
      setNote(d?.ok ? { ok: true, text: t("sealedNow") } : { ok: false, text: errMsg(d, t("sealFailed")) });
      adopt(await readConfig());
    } catch {
      setNote({ ok: false, text: t("sealFailed") });
    } finally {
      setBusy(false);
    }
  }, [t, errMsg, readConfig, adopt]);

  // PAIRED means the drain can actually RUN, which needs both halves: resolveEdge()
  // returns null without a secret ("an unsigned drain would accept events from anyone
  // who learned the edge URL"), so a URL alone drained nothing while this card showed
  // a green "Paired". The two states are now distinct and the incomplete one says
  // which half is missing.
  const hasUrl = state ? state.envConfigured || state.url.trim() !== "" : false;
  const paired = hasUrl && Boolean(state?.hasSecret);
  const secretMissing = hasUrl && !state?.hasSecret;
  // Same rule as the relay card: the POST is a full REPLACE, so an empty field is a
  // legitimate save only once we KNOW the field reflects what is stored. Saving a
  // blank on a failed read would silently UNPAIR a working edge — and unpairing
  // resets the cursor, so the next pairing would skip everything already queued.
  const blankSaveOnUnknownConfig = state === null && url.trim() === "";

  return (
    <section aria-label={t("title")} className="rounded-lg border border-stone-200 bg-paper/50 p-4">
      <div className="flex min-h-[2rem] flex-wrap items-center gap-2">
        <span aria-hidden className="inline-grid h-8 w-8 place-items-center rounded-lg border border-stone-200 bg-white text-steel">
          <CloudCog size={15} />
        </span>
        <h3 className="font-semibold text-ink">{t("title")}</h3>
        {state ? (
          <Badge
            tone={state.offline ? "neutral" : paired ? "positive" : secretMissing ? "caution" : "neutral"}
            icon={!state.offline && secretMissing ? AlertTriangle : undefined}
            label={
              state.offline
                ? t("statusOffline")
                : paired
                  ? t("statusPaired")
                  : secretMissing
                    ? t("statusSecretMissing")
                    : t("statusOff")
            }
          />
        ) : (
          <span className="reveal-quiet inline-block h-5 w-20 rounded-full bg-stone-100" aria-hidden />
        )}
        {state?.hasSecret ? <Badge tone="info" icon={KeyRound} label={t("secretSet")} /> : null}
        {state?.sealed ? <Badge tone="info" icon={ShieldCheck} label={t("sealedBadge")} /> : null}
      </div>
      <p className="mt-1.5 max-w-2xl text-sm text-steel">{t("intro")}</p>

      {state?.offline ? (
        <p className="mt-3 rounded-md border border-dashed border-stone-300 bg-white px-3 py-2 text-sm text-steel">{t("offlineNote")}</p>
      ) : state?.envConfigured ? (
        <p className="mt-3 rounded-md border border-dashed border-stone-300 bg-white px-3 py-2 text-sm text-steel">{t("envNote")}</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-64">
            <label htmlFor="edge-url" className={`${META_LABEL} block`}>
              {t("urlLabel")}
            </label>
            <TextInput
              id="edge-url"
              value={url}
              onChange={(e) => {
                touched.current = true;
                setUrl(e.target.value);
              }}
              placeholder="https://…"
              sizeVariant="sm"
              className="mt-1 w-full"
            />
          </div>
          <div className="min-w-0 flex-1 basis-52">
            <label htmlFor="edge-secret" className={`${META_LABEL} block`}>
              {t("secretLabel")}
            </label>
            <TextInput
              id="edge-secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={state?.hasSecret ? t("secretKeepPlaceholder") : t("secretPlaceholder")}
              sizeVariant="sm"
              className="mt-1 w-full"
            />
          </div>
          <div className="min-w-0 flex-1 basis-52">
            <label htmlFor="edge-nudge" className={`${META_LABEL} block`}>
              {t("nudgeLabel")}
            </label>
            <TextInput
              id="edge-nudge"
              value={nudge}
              onChange={(e) => {
                touched.current = true;
                setNudge(e.target.value);
              }}
              placeholder="https://ntfy.sh/…"
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
        <button type="button" onClick={drainNow} disabled={busy || !paired || state?.offline} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
          <Download size={14} aria-hidden /> {t("drainNow")}
        </button>
        {paired && state && !state.sealed && !state.offline ? (
          <button type="button" onClick={enableSealing} disabled={busy} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
            <ShieldCheck size={14} aria-hidden /> {t("enableSealing")}
          </button>
        ) : null}
        {note ? (
          <span role="status" aria-live="polite" className={`text-sm font-medium ${note.ok ? "text-moss" : "text-coral"}`}>
            {note.text}
          </span>
        ) : null}
      </div>

      {secretMissing && !state?.offline ? (
        <p className="mt-3 rounded-md border border-dashed border-amber-300 bg-white px-3 py-2 text-sm text-steel">
          {t("secretMissingNote")}
        </p>
      ) : null}

      {/* THE DRAIN LEDGER. Every fact here was already known to the engine and shown
          to nobody: when the drain last ran, how much is still queued at the edge,
          when the edge last heard from us. A cursor on its own cannot tell "caught
          up" from "500 behind", and that is the difference between a quiet week and a
          lost one. A cleared error is CLEARED, never sticky — a red line over a
          source that has since recovered is its own kind of lie. */}
      {paired && state ? (
        <p className="mt-2 text-xs text-steel">
          {state.lastDrainAt ? t("lastDrain", { time: rel(state.lastDrainAt) }) : t("neverDrained")}
          {` · ${t("cursor", { cursor: state.cursor })}`}
          {` · ${
            state.pending === null
              ? t("pendingUnknown")
              : state.pending > 0
                ? t("pendingWaiting", { pending: state.pending })
                : t("pendingClear")
          }`}
          {state.lastHeartbeatAt ? ` · ${t("lastHeartbeat", { time: rel(state.lastHeartbeatAt) })}` : ""}
        </p>
      ) : null}
      {paired && state?.lastErrorKind ? (
        <p className="mt-1 text-xs font-medium text-coral">{t(DRAIN_ERROR_KEY[state.lastErrorKind])}</p>
      ) : null}
    </section>
  );
}
