"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { notifyDataChanged } from "@/app/features/shell/live-refresh";
import { invalidateCommsCapability } from "@/app/features/shell/useDeliveryCapability";
import { readRelayConfig, type RelayState } from "../channelsNightReads";
import { relaySaveBody, relaySaveOutcome, relayTestOutcome, type RelayTest } from "./setupDelivery";

export type SetupNote = { ok: boolean; text: string };

/**
 * The relay editor's state and its two real actions (the retired RelayConfigCard's logic; the
 * decisions are pure in setupDelivery.ts). The editor paints on the first frame: only the facts the
 * GET returns wait for it, and a read that never lands leaves a usable form. A typed URL is never
 * overwritten by an arriving read.
 *
 * Save: `expectedVersion` is the version READ (the store refuses a write built on an older one, 409).
 * A save and a 409 both CHANGE the outbound capability, so both tell every "sent"/"queued" surface
 * (invalidateCommsCapability) and the live-refresh bus (notifyDataChanged); the plumbing re-reads
 * the relay from that. Test: POST /api/comms/relay/test; its answer is the outcome (`onTested`), and a
 * save forgets the last answer (it was about the endpoint that was stored then).
 */
export function useRelaySetup(onTested: (test: RelayTest | null) => void) {
  const t = useTranslations("channels.relay");
  const errMsg = useErrorMessage();
  const [state, setState] = useState<RelayState | null>(null);
  const [url, setUrlRaw] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [note, setNote] = useState<SetupNote | null>(null);
  const [test, setTest] = useState<RelayTest | null>(null);
  const touched = useRef(false);
  const tested = useRef(onTested);
  useEffect(() => {
    tested.current = onTested;
  });

  const adopt = useCallback((next: RelayState | null, force = false) => {
    if (!next) return;
    setState(next);
    if (force || !touched.current) setUrlRaw(next.url);
  }, []);

  useEffect(() => {
    let alive = true;
    readRelayConfig().then((next) => {
      if (alive) adopt(next);
    });
    return () => {
      alive = false;
    };
  }, [adopt]);

  const setUrl = useCallback((v: string) => {
    touched.current = true;
    setUrlRaw(v);
  }, []);

  const answer = useCallback((next: RelayTest | null) => {
    setTest(next);
    tested.current(next);
  }, []);

  const save = useCallback(async () => {
    setBusy("save");
    setNote(null);
    try {
      const r = await fetch("/api/comms/relay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(relaySaveBody(state, url, secret)) });
      const outcome = relaySaveOutcome(r.status, await r.json().catch(() => null));
      if (outcome.kind === "saved") {
        setSecret("");
        touched.current = false;
        setNote({ ok: true, text: t("saved") });
        answer(null);
        adopt(await readRelayConfig(), true);
        invalidateCommsCapability();
        notifyDataChanged();
      } else {
        // COMMS_RELAY_STALE / COMMS_RELAY_INVALID resolve in the reader's language.
        setNote({ ok: false, text: errMsg(outcome.body, t("saveFailed")) });
        if (outcome.kind === "stale") {
          // Someone stored a newer config: show what is actually stored before the next try.
          adopt(await readRelayConfig(), true);
          invalidateCommsCapability();
          notifyDataChanged();
        }
      }
    } catch {
      setNote({ ok: false, text: t("saveFailed") });
    } finally {
      setBusy(null);
    }
  }, [state, url, secret, t, errMsg, adopt, answer]);

  const runTest = useCallback(async () => {
    setBusy("test");
    setNote(null);
    answer(null);
    try {
      const r = await fetch("/api/comms/relay/test", { method: "POST" });
      answer(relayTestOutcome(await r.json().catch(() => ({ ok: false, status: r.status })), r.status));
    } catch {
      answer(relayTestOutcome(null));
    } finally {
      setBusy(null);
    }
  }, [answer]);

  return { state, url, setUrl, secret, setSecret, busy, note, test, save, runTest };
}
