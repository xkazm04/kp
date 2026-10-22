"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { notifyDataChanged } from "@/app/features/shell/live-refresh";
import { invalidateCommsCapability } from "@/app/features/shell/useDeliveryCapability";
import { parseSmtpBody, smtpFormFrom, smtpSaveBody, smtpTestOutcome, type SmtpForm, type SmtpState, type SmtpTest } from "./smtpSetup";
import type { SetupNote } from "./useRelaySetup";

async function readSmtp(): Promise<SmtpState | null> {
  try {
    const r = await fetch("/api/comms/smtp");
    if (!r.ok) return null;
    return parseSmtpBody(await r.json());
  } catch {
    return null;
  }
}

/**
 * The SMTP sender's state and its three real actions (decisions pure in smtpSetup.ts): Save
 * (version-checked; a 409 adopts what is stored), Send test (the server's own outcome), and
 * Remove an address from the suppression list. A save changes the outbound capability, so it
 * tells every "sent"/"queued" surface (invalidateCommsCapability) and the live-refresh bus. A
 * typed form is never overwritten by an arriving read.
 */
export function useSmtpSetup() {
  const t = useTranslations("channelsNight.setup.smtp");
  const errMsg = useErrorMessage();
  const [state, setState] = useState<SmtpState | null>(null);
  const [form, setFormRaw] = useState<SmtpForm>(() => smtpFormFrom(null));
  const [busy, setBusy] = useState<"save" | "test" | "unsuppress" | null>(null);
  const [note, setNote] = useState<SetupNote | null>(null);
  const [test, setTest] = useState<SmtpTest | null>(null);
  const touched = useRef(false);

  const adopt = useCallback((next: SmtpState | null, force = false) => {
    if (!next) return;
    setState(next);
    if (force || !touched.current) setFormRaw(smtpFormFrom(next));
  }, []);

  useEffect(() => {
    let alive = true;
    readSmtp().then((next) => {
      if (alive) adopt(next);
    });
    return () => {
      alive = false;
    };
  }, [adopt]);

  const setForm = useCallback((patch: Partial<SmtpForm>) => {
    touched.current = true;
    setFormRaw((f) => ({ ...f, ...patch }));
  }, []);

  const changed = useCallback(() => {
    invalidateCommsCapability();
    notifyDataChanged();
  }, []);

  const save = useCallback(async () => {
    setBusy("save");
    setNote(null);
    try {
      const r = await fetch("/api/comms/smtp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(smtpSaveBody(state, form)) });
      const body = (await r.json().catch(() => null)) as { code?: string } | null;
      if (r.ok) {
        touched.current = false;
        setNote({ ok: true, text: t("saved") });
        setTest(null);
        adopt(await readSmtp(), true);
        changed();
      } else {
        setNote({ ok: false, text: errMsg(body, t("saveFailed")) });
        if (r.status === 409) {
          adopt(await readSmtp(), true);
          changed();
        }
      }
    } catch {
      setNote({ ok: false, text: t("saveFailed") });
    } finally {
      setBusy(null);
    }
  }, [state, form, t, errMsg, adopt, changed]);

  const runTest = useCallback(async () => {
    setBusy("test");
    setNote(null);
    setTest(null);
    try {
      const r = await fetch("/api/comms/smtp/test", { method: "POST" });
      setTest(smtpTestOutcome(await r.json().catch(() => ({ code: undefined })), r.status));
      adopt(await readSmtp());
    } catch {
      setTest(smtpTestOutcome(null));
    } finally {
      setBusy(null);
    }
  }, [adopt]);

  const unsuppress = useCallback(
    async (address: string) => {
      setBusy("unsuppress");
      setNote(null);
      try {
        const r = await fetch("/api/comms/smtp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unsuppress: address }) });
        if (!r.ok) setNote({ ok: false, text: errMsg(await r.json().catch(() => null), t("saveFailed")) });
        adopt(await readSmtp());
      } catch {
        setNote({ ok: false, text: t("saveFailed") });
      } finally {
        setBusy(null);
      }
    },
    [adopt, errMsg, t]
  );

  return { state, form, setForm, busy, note, test, save, runTest, unsuppress };
}
