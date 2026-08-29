"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { BTN_PRIMARY, BTN_SECONDARY, CARD_PAD, DIVIDER, FIELD, META_LABEL, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import type { BridgeConfigPublic } from "@/app/_lib/agent-hire/bridge-store";
import { usePersonasPairing } from "./integrationsPersonasLogic";

// Agent-candidate bridge — connect kp to the Personas desktop app (the door for
// hiring AI agents). Pairing is human-approved: kp registers a request, the
// operator approves it IN Personas, and the claim poll picks up the pk_ key
// (stored encrypted, write-only — same secret doctrine as the ATS tokens). An
// env-driven connection (PERSONAS_BRIDGE_URL/KEY) is shown but managed in the
// deployment config, not here.

export function IntegrationsPersonasPanel() {
  const t = useTranslations("integrations.personas");
  // The reader's locale, not the browser's — see IntegrationsAtsRow.
  const format = useFormatter();
  const { data, error, reload } = useJsonFetch<{ bridge: BridgeConfigPublic }>("/api/agents/bridge", t("loadFailed"));
  const pairing = usePersonasPairing(reload);
  const [baseUrl, setBaseUrl] = useState("");

  const bridge = data?.bridge ?? null;
  const connected = bridge?.paired === true;
  const envManaged = bridge?.source === "env";
  const waiting = pairing.state.phase === "waiting" || pairing.state.phase === "starting";
  const dot = pairing.state.phase === "error" ? "bg-coral" : connected ? "bg-moss" : "bg-stone-300";

  return (
    <div className={`${PANEL} ${CARD_PAD}`}>
      <h3 className="flex items-center gap-2 font-serif text-h3 text-ink">
        <Bot size={16} className="text-coral" aria-hidden /> {t("title")}
      </h3>
      <p className="mt-1 max-w-3xl text-sm text-steel">{t("intro")}</p>

      {error ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-base text-coral">{error}</p>
          <button type="button" onClick={reload} className={`${BTN_SECONDARY} h-8 px-3 text-sm`}>
            {t("retry")}
          </button>
        </div>
      ) : null}

      {!data && !error ? <div className="reveal-quiet mt-3 min-h-[6rem]" aria-hidden /> : null}

      {bridge ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} />
          <span className="text-base font-semibold text-ink">
            {connected ? t("statusConnected") : t("statusNotConnected")}
          </span>
          <span className="break-all font-mono text-sm text-steel">{bridge.baseUrl}</span>
          {connected && bridge.lastOkAt ? (
            <span className="text-sm text-steel">{t("lastOk", { time: format.dateTime(new Date(bridge.lastOkAt), { dateStyle: "medium", timeStyle: "short" }) })}</span>
          ) : null}
        </div>
      ) : null}

      {bridge && envManaged ? <p className={`${PANEL_SUNKEN} mt-3 p-3 text-sm text-steel`}>{t("envManaged")}</p> : null}

      {waiting ? (
        <div className={`${PANEL_SUNKEN} mt-3 p-4`} role="status">
          <p className="flex items-center gap-2 text-base font-semibold text-ink">
            <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-coral border-t-transparent" />
            {t("waitingTitle")}
          </p>
          <p className="mt-1 text-sm text-steel">{t("waitingBody")}</p>
          <button type="button" onClick={pairing.cancel} className={`${BTN_SECONDARY} mt-3 h-8 px-3 text-sm`}>
            {t("waitingCancel")}
          </button>
        </div>
      ) : null}

      {pairing.state.phase === "timeout" ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900" role="alert">
          <p className="text-base font-semibold">{t("timeoutTitle")}</p>
          <p className="mt-0.5 text-sm">{t("timeoutBody")}</p>
          <button type="button" onClick={() => void pairing.start(baseUrl)} className={`${BTN_SECONDARY} mt-2 h-8 px-3 text-sm`}>
            {t("retryPair")}
          </button>
        </div>
      ) : null}

      {pairing.state.phase === "error" ? (
        <div className="mt-3 flex flex-wrap items-center gap-3" role="alert">
          <p className="text-sm font-medium text-coral">{pairing.state.message}</p>
          <button type="button" onClick={() => void pairing.start(baseUrl)} className={`${BTN_SECONDARY} h-8 px-3 text-sm`}>
            {t("retryPair")}
          </button>
        </div>
      ) : null}

      {bridge && !envManaged && !waiting ? (
        <div className={`${DIVIDER} mt-4 pt-4`}>
          <div className="flex flex-wrap items-center gap-3">
            {connected ? (
              <>
                <button type="button" onClick={() => void pairing.start(baseUrl)} className={`${BTN_SECONDARY} h-9 px-4 text-sm`}>
                  {t("repair")}
                </button>
                <button type="button" onClick={() => void pairing.disconnect()} disabled={pairing.busy} className={`${BTN_SECONDARY} h-9 px-4 text-sm`}>
                  {pairing.busy ? t("disconnecting") : t("disconnect")}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => void pairing.start(baseUrl)} className={`${BTN_PRIMARY} h-9 px-4 text-sm`}>
                  {t("connect")}
                </button>
                <p className="text-sm text-steel">{t("connectHint")}</p>
              </>
            )}
          </div>
          <div className="mt-3 max-w-md">
            <label htmlFor="personas-base-url" className={META_LABEL}>
              {t("baseUrlLabel")}
            </label>
            <input
              id="personas-base-url"
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={bridge.baseUrl}
              className={`${FIELD} mt-1 w-full font-mono text-sm`}
            />
            <p className="mt-1 text-sm text-steel">{t("baseUrlHint")}</p>
          </div>
        </div>
      ) : null}

      {pairing.note ? (
        <p role="status" className={`mt-3 text-sm font-medium ${pairing.note.ok ? "text-moss" : "text-coral"}`}>
          {pairing.note.text}
        </p>
      ) : null}
    </div>
  );
}
