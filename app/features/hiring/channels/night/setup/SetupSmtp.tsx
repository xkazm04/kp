"use client";

import { useTranslations } from "next-intl";
import { Button, Note, Segmented, Tag, inputClass } from "@/app/_components/kit";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { SetupField, SetupLinkBase, SetupResult } from "./SetupBits";
import { SetupSecretField } from "./SetupSecretField";
import { useSmtpSetup } from "./useSmtpSetup";
import {
  SMTP_PRESET_IDS,
  SMTP_RECENT_SHOWN,
  canSaveSmtp,
  smtpDirty,
  smtpPasswordRequired,
  smtpStageLabel,
  smtpTestGate,
  type SmtpTest,
} from "./smtpSetup";

/**
 * Send from your own mailbox (T6): the built-in SMTP sender, beside the relay. The loudest fact
 * first: whether letters actually leave through this mailbox, or through the relay (which keeps
 * precedence when both are set), or not at all. Then the provider (a preset fills the server, the
 * port and the encryption; the owner types only the address and the password), the write-only
 * password, Save, and Send test whose answer is the server's own reply code. Under it, the last
 * few attempts with what the server said, and the addresses it refused for good.
 */
export function SetupSmtp() {
  const t = useTranslations("channelsNight.setup.smtp");
  const s = useSmtpSetup();
  const dirty = smtpDirty(s.state, s.form);
  const gate = smtpTestGate(s.state, dirty, s.busy !== null);
  const canSave = canSaveSmtp(s.state, s.form, s.busy !== null);
  const status = !s.state ? null : s.state.health === "unreadable" ? "unreadable" : s.state.active === "smtp" ? "active" : s.state.active === "relay" && s.state.health === "configured" ? "precedence" : s.state.active === "relay" ? "relayOnly" : "off";

  return (
    <section className="cns-body" aria-labelledby="cns-smtp-title">
      <h3 className="cns-card__title" id="cns-smtp-title">
        {t("title")}
      </h3>
      <p className="cns-intro">{t("intro")}</p>
      {status === "unreadable" ? (
        <Note tone="critical">{t("status.unreadable")}</Note>
      ) : status === "precedence" ? (
        <Note tone="caution">{t("status.precedence")}</Note>
      ) : status ? (
        <p className="cns-help">{t(`status.${status}`)}</p>
      ) : null}
      {/* the relay's own note covers the relay-active case, so this one speaks only when the mailbox is what sends */}
      <SetupLinkBase senderOn={s.state?.active === "smtp"} problem={s.state?.linkBase ?? null} />
      <form
        className="cns-form cns-panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void s.save();
        }}
      >
        <Segmented
          label={t("preset")}
          lead={t("preset")}
          value={s.form.preset}
          onChange={(v) => s.setForm({ preset: v as (typeof SMTP_PRESET_IDS)[number] })}
          items={SMTP_PRESET_IDS.map((id) => ({ value: id, label: t(`presets.${id}`) }))}
        />
        <p className="cns-help">{t(`presetHelp.${s.form.preset}`)}</p>
        {s.form.preset === "custom" ? (
          <div className="cns-row">
            <SetupField label={t("host")}>
              {({ id }) => <input id={id} className={inputClass("md")} value={s.form.host} placeholder="smtp.example.com" spellCheck={false} autoComplete="off" onChange={(e) => s.setForm({ host: e.target.value })} />}
            </SetupField>
            <SetupField label={t("port")}>
              {({ id }) => <input id={id} className={inputClass("md")} value={s.form.port} inputMode="numeric" autoComplete="off" onChange={(e) => s.setForm({ port: e.target.value })} />}
            </SetupField>
            <SetupField label={t("security")}>
              {({ id }) => (
                <select id={id} className={inputClass("md")} value={s.form.security} onChange={(e) => s.setForm({ security: e.target.value === "tls" ? "tls" : "starttls" })}>
                  <option value="tls">{t("securityTls")}</option>
                  <option value="starttls">{t("securityStarttls")}</option>
                </select>
              )}
            </SetupField>
          </div>
        ) : null}
        <SetupField label={t("address")} help={t("addressHelp")}>
          {({ id, helpId }) => (
            <span className="cns-row cns-row--field">
              <input id={id} aria-describedby={helpId} className={inputClass("md")} type="email" value={s.form.address} placeholder="you@example.com" spellCheck={false} autoComplete="off" onChange={(e) => s.setForm({ address: e.target.value })} />
              {s.state && s.state.address ? <Tag label={t("version", { version: s.state.version })} /> : null}
            </span>
          )}
        </SetupField>
        <SetupField label={t("fromName")}>
          {({ id }) => <input id={id} className={inputClass("md")} value={s.form.fromName} autoComplete="off" onChange={(e) => s.setForm({ fromName: e.target.value })} />}
        </SetupField>
        <SetupSecretField
          key={`${s.state?.version ?? "unread"}-${s.state?.hasPassword ?? ""}`}
          label={t("password")}
          has={Boolean(s.state?.hasPassword) && !smtpPasswordRequired(s.state, s.form)}
          value={s.form.password}
          onChange={(v) => s.setForm({ password: v })}
          placeholder={t("passwordPlaceholder")}
          keepPlaceholder={t("passwordKeep")}
        />
        <div className="cns-row">
          <Button type="submit" label={t("save")} loading={s.busy === "save"} variant="primary" icon="check" disabled={!canSave} />
          <Button label={t("test")} loading={s.busy === "test"} disabled={gate !== "ok"} onClick={() => void s.runTest()} />
          <p className="cns-help">{gate === "ok" && s.state ? t("testHint", { address: s.state.address }) : t(`gate.${gate}`)}</p>
        </div>
        {s.note ? <SetupResult ok={s.note.ok}>{s.note.text}</SetupResult> : null}
        {s.test ? <SmtpTestLine test={s.test} /> : null}
      </form>
      <SmtpRecent attempts={s.state?.attempts ?? []} />
      {s.state && s.state.suppressed.length > 0 ? (
        <div className="cns-panel">
          <p className="cns-field__label">{t("suppressed", { count: s.state.suppressed.length })}</p>
          <p className="cns-help">{t("suppressedHelp")}</p>
          <ul className="cns-form">
            {s.state.suppressed.map((row) => (
              <li key={row.address} className="cns-row cns-row--split">
                <span className="cns-help">
                  <b>{row.address}</b> {row.code ?? ""} {row.text}
                </span>
                <Button label={t("unsuppress")} size="sm" variant="link" disabled={s.busy !== null} onClick={() => void s.unsuppress(row.address)} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function SmtpTestLine({ test }: { test: SmtpTest }) {
  const t = useTranslations("channelsNight.setup.smtp");
  const errMsg = useErrorMessage();
  if (test.kind === "sent") return <SetupResult ok lead={t("outcome.sent")}>{t("testOk", { code: test.code, address: test.to })}</SetupResult>;
  if (test.kind === "failed") {
    const stage = smtpStageLabel(test.stage);
    return (
      <SetupResult ok={false} lead={t("outcome.failed")}>
        {test.code === null ? t("testNoReply", { stage, text: test.text }) : t("testFailed", { code: test.code, stage, text: test.text })}
      </SetupResult>
    );
  }
  if (test.kind === "sealed") return <SetupResult ok={false} lead={t("outcome.failed")}>{t("testSealed")}</SetupResult>;
  if (test.kind === "unconfigured") return <SetupResult ok={false} lead={t("outcome.failed")}>{t("gate.noSender")}</SetupResult>;
  if (test.kind === "unreadable") return <SetupResult ok={false} lead={t("outcome.failed")}>{t("status.unreadable")}</SetupResult>;
  return <SetupResult ok={false} lead={t("outcome.refused")}>{errMsg(test.body, t("saveFailed"))}</SetupResult>;
}

function SmtpRecent({ attempts }: { attempts: { at: string; kind: string; to: string; outcome: "sent" | "retry" | "failed" | "refused"; stage: string | null; code: number | null; text: string }[] }) {
  const t = useTranslations("channelsNight.setup.smtp");
  return (
    <div className="cns-panel">
      <p className="cns-field__label">{t("recent")}</p>
      {attempts.length === 0 ? (
        <p className="cns-help">{t("recentEmpty")}</p>
      ) : (
        <ul className="cns-form">
          {attempts.slice(0, SMTP_RECENT_SHOWN).map((a, i) => (
            <li key={`${a.at}-${i}`} className="cns-row">
              <Tag label={t(`attempt.${a.outcome}`)} />
              <span className="cns-help">
                <b>{a.kind === "test" ? t("attemptTest") : a.kind}</b> {a.to} {a.code ?? ""} {smtpStageLabel(a.stage)} {a.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
