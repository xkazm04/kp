"use client";

import { useTranslations } from "next-intl";
import { Button, Note, Tag, inputClass } from "@/app/_components/kit";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { VerdictCounts } from "../channelsNightPlumbing";
import { relayDirty, relayTestGate, canSaveRelay, type RelayTest } from "./setupDelivery";
import { SetupField, SetupResult } from "./SetupBits";
import { SetupRelayEvidence } from "./SetupRelayEvidence";
import { SetupSecretField } from "./SetupSecretField";
import { useRelaySetup } from "./useRelaySetup";

/**
 * The delivery relay: where outbound candidate mail goes. The loudest fact first (no relay while
 * mail is queued: those messages are NOT being sent), the unreadable-secret and env-override notes,
 * the endpoint and its write-only signing secret (generated here if wanted, shown once), Save, and
 * the REAL test ping whose answer is the outcome (sent / failed / not sent) and the only thing that
 * rolls the depot's shutter up. Then what the relay has carried, from the ledger's own verdicts.
 */
export function SetupRelay({ counts, onTested, onOpenLedger }: {
  counts: VerdictCounts | null;
  onTested: (test: RelayTest | null) => void;
  onOpenLedger: (el: HTMLElement, verdict?: "queued") => void;
}) {
  const t = useTranslations("channels.relay");
  const ts = useTranslations("channelsNight.setup.relay");
  const r = useRelaySetup(onTested);
  const unreadable = r.state?.relay === "unreadable";
  const configured = r.state ? r.state.envConfigured || r.state.url.trim() !== "" : null;
  const dirty = relayDirty(r.state, r.url, r.secret);
  const gate = relayTestGate(r.state, dirty, r.busy !== null);
  const queued = counts?.queued ?? 0;

  return (
    <div className="cns-body">
      {configured === false && queued > 0 ? (
        <Note tone="critical">
          <b>{ts("notSending", { count: queued })}</b> {t("intro")}
        </Note>
      ) : (
        <p className="cns-intro">{t("intro")}</p>
      )}
      {unreadable ? <Note tone="critical">{t("unreadableNote")}</Note> : null}
      {r.state?.envConfigured ? (
        <Note tone="caution">{t("envNote")}</Note>
      ) : (
        <form
          className="cns-form cns-panel"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSaveRelay(r.state, r.url, r.busy !== null)) void r.save();
          }}
        >
          <SetupField label={t("urlLabel")}>
            {({ id }) => (
              <span className="cns-row cns-row--field">
                <input id={id} className={inputClass("md")} value={r.url} placeholder="https://…" spellCheck={false} autoComplete="off" onChange={(e) => r.setUrl(e.target.value)} />
                {r.state && r.state.url ? <Tag label={ts("version", { version: r.state.version })} /> : null}
              </span>
            )}
          </SetupField>
          <SetupSecretField
            key={`${r.state?.version ?? "unread"}-${r.state?.hasSecret ?? ""}`}
            label={t("secretLabel")}
            has={Boolean(r.state?.hasSecret)}
            value={r.secret}
            onChange={r.setSecret}
            placeholder={t("secretPlaceholder")}
            keepPlaceholder={t("secretKeepPlaceholder")}
            generate
          />
          <div className="cns-row">
            <Button type="submit" label={t("save")} loading={r.busy === "save"} variant="primary" icon="check" disabled={!canSaveRelay(r.state, r.url, r.busy !== null)} />
            <Button label={t("test")} loading={r.busy === "test"} disabled={gate !== "ok"} onClick={() => void r.runTest()} />
            <p className="cns-help">{ts(`gate.${gate}`)}</p>
          </div>
          {r.note ? <SetupResult ok={r.note.ok}>{r.note.text}</SetupResult> : null}
        </form>
      )}
      {r.state?.envConfigured ? (
        <div className="cns-row">
          <Button label={t("test")} loading={r.busy === "test"} disabled={gate !== "ok"} onClick={() => void r.runTest()} />
        </div>
      ) : null}
      {r.test ? <RelayTestLine test={r.test} /> : null}
      <SetupRelayEvidence counts={counts} relayOn={configured === true && !unreadable} onOpenLedger={onOpenLedger} />
    </div>
  );
}

function RelayTestLine({ test }: { test: RelayTest }) {
  const t = useTranslations("channels.relay");
  const ts = useTranslations("channelsNight.setup.relay.outcome");
  const errMsg = useErrorMessage();
  if (test.kind === "sent") return <SetupResult ok lead={ts("sent")}>{t("testOk", { status: test.status })}</SetupResult>;
  if (test.kind === "failed") return <SetupResult ok={false} lead={ts("failed")}>{t("testFailed", { reason: test.reason })}</SetupResult>;
  // A refusal is about the caller (org:manage, the probe's throttle), not the endpoint: its code, in the
  // reader's words; a code with no words falls back to the HTTP status (never the raw code).
  return <SetupResult ok={false} lead={ts("refused")}>{errMsg(test.body, t("testFailed", { reason: test.status ? `HTTP ${test.status}` : "" }))}</SetupResult>;
}
