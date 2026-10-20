"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Toggle, inputClass } from "@/app/_components/kit";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { canSavePull, interpretPullResponse, pullPatchBody } from "../../receiverPullForm";
import { SetupField, SetupResult } from "./SetupBits";
import { SetupSecretField } from "./SetupSecretField";

/**
 * A receiver's pull source (PATCH /api/channels/webhooks, the retired ReceiverPullCard's form; its
 * rules are pure in receiverPullForm.ts): the URL, the write-only bearer token (keep / replace /
 * remove), the warning that a blank URL turns pulling off and forgets the source's position, and a
 * save that is refused while nothing changed. A typed URL is never overwritten by an arriving list.
 * A refusal keeps only its code (errors.<CODE>), never the server's English.
 */
export function SetupPullForm({ receiver, onSaved }: { receiver: ChannelWebhookRecord; onSaved: () => void }) {
  const t = useTranslations("channels.pull");
  const errMsg = useErrorMessage();
  const [url, setUrl] = useState(receiver.pullUrl ?? "");
  const [secret, setSecret] = useState("");
  const [clearSecret, setClearSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saves, setSaves] = useState(0);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const touched = useRef(false);

  useEffect(() => {
    if (!touched.current) setUrl(receiver.pullUrl ?? "");
  }, [receiver.pullUrl]);

  const fields = { url, secret, clearSecret };
  const saveable = canSavePull({ pullUrl: receiver.pullUrl, hasPullSecret: receiver.hasPullSecret }, fields, busy);

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch("/api/channels/webhooks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pullPatchBody(receiver.token, fields)),
      });
      const outcome = interpretPullResponse(r.status, await r.json().catch(() => null));
      if (outcome.ok) {
        touched.current = false;
        setSecret("");
        setClearSecret(false);
        setSaves((n) => n + 1);
        setNote({ ok: true, text: t("saved") });
        onSaved();
      } else {
        setNote({ ok: false, text: errMsg(outcome, t("saveFailed")) });
      }
    } catch {
      setNote({ ok: false, text: t("saveFailed") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="cns-panel cns-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (saveable) void save();
      }}
    >
      <SetupField label={t("urlLabel")} help={url.trim() === "" && receiver.pullUrl ? t("disableWarning") : undefined}>
        {({ id, helpId }) => (
          <input
            id={id}
            className={inputClass("md")}
            value={url}
            placeholder="https://…"
            spellCheck={false}
            autoComplete="off"
            aria-describedby={helpId}
            onChange={(e) => {
              touched.current = true;
              setUrl(e.target.value);
            }}
          />
        )}
      </SetupField>
      <SetupSecretField
        key={`${saves}-${receiver.hasPullSecret}`}
        label={t("secretLabel")}
        has={receiver.hasPullSecret && !clearSecret}
        value={secret}
        onChange={(v) => {
          setSecret(v);
          if (v !== "") setClearSecret(false);
        }}
        placeholder={t("secretPlaceholder")}
        keepPlaceholder={t("secretKeepPlaceholder")}
      />
      {receiver.hasPullSecret ? (
        <span className="cns-toggle">
          <Toggle on={clearSecret} label={t("clearSecret")} disabled={secret !== ""} onChange={setClearSecret} />
          <span aria-hidden="true">{t("clearSecret")}</span>
        </span>
      ) : null}
      <div className="cns-row">
        <Button type="submit" label={t("save")} loading={busy} variant="primary" size="sm" disabled={!saveable} />
      </div>
      {note ? <SetupResult ok={note.ok}>{note.text}</SetupResult> : null}
    </form>
  );
}
