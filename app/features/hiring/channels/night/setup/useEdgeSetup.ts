"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { notifyDataChanged } from "@/app/features/shell/live-refresh";
import { DRAIN_FAIL_KEY } from "../channelsNightCopy";
import { readEdgeConfig, type EdgeState } from "../channelsNightReads";
import { drainOutcome, edgeSaveBody } from "./setupDelivery";
import type { SetupNote } from "./useRelaySetup";

/**
 * The edge editor's state and its three real actions (the retired ChannelsEdgeCard's logic; the
 * decisions are pure in setupDelivery.ts): save (POST /api/edge, the secret write-only), drain now
 * (POST /api/edge/drain: a refusal by STATUS first, then by the edge's failure CLASS, never the
 * machine text), enable sealing (POST /api/edge/pair). Every action re-reads GET /api/edge, and
 * announces a data change so the district's night box and the ledger follow (a drain files leads).
 */
export function useEdgeSetup() {
  const t = useTranslations("channels.edge");
  const tAll = useTranslations();
  const errMsg = useErrorMessage();
  const [state, setState] = useState<EdgeState | null>(null);
  const [url, setUrlRaw] = useState("");
  const [secret, setSecret] = useState("");
  const [nudge, setNudgeRaw] = useState("");
  const [busy, setBusy] = useState<"save" | "drain" | "seal" | null>(null);
  const [note, setNote] = useState<SetupNote | null>(null);
  // Bumped by every successful save: the secret field returns to its stored face.
  const [saves, setSaves] = useState(0);
  // The fields are live from the first frame: an arriving config never overwrites typing.
  const touched = useRef(false);

  const adopt = useCallback((next: EdgeState | null, force = false) => {
    if (!next) return;
    setState(next);
    if (force || !touched.current) {
      setUrlRaw(next.url);
      setNudgeRaw(next.nudgeTarget ?? "");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    readEdgeConfig().then((next) => {
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
  const setNudge = useCallback((v: string) => {
    touched.current = true;
    setNudgeRaw(v);
  }, []);

  const save = useCallback(async () => {
    setBusy("save");
    setNote(null);
    try {
      const r = await fetch("/api/edge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edgeSaveBody(url, secret, nudge)) });
      const d = (await r.json().catch(() => null)) as { config?: unknown; code?: string } | null;
      if (r.ok && d?.config) {
        setSecret("");
        touched.current = false;
        setSaves((n) => n + 1);
        setNote({ ok: true, text: t("saved") });
        adopt(await readEdgeConfig(), true);
        notifyDataChanged();
      } else {
        setNote({ ok: false, text: errMsg(d, t("saveFailed")) });
      }
    } catch {
      setNote({ ok: false, text: t("saveFailed") });
    } finally {
      setBusy(null);
    }
  }, [url, secret, nudge, t, errMsg, adopt]);

  const drain = useCallback(async () => {
    setBusy("drain");
    setNote(null);
    try {
      const r = await fetch("/api/edge/drain", { method: "POST" });
      const out = drainOutcome(r.ok, await r.json().catch(() => null));
      if (out.kind === "drained") setNote({ ok: true, text: t("drained", { applied: out.applied, skipped: out.skipped }) });
      else if (out.kind === "failed") setNote({ ok: false, text: tAll(DRAIN_FAIL_KEY[out.errorKind]) });
      else setNote({ ok: false, text: errMsg(out.body, t("drainFailedUnknown")) });
      adopt(await readEdgeConfig());
      notifyDataChanged();
    } catch {
      setNote({ ok: false, text: t("drainFailedUnreachable") });
    } finally {
      setBusy(null);
    }
  }, [t, tAll, errMsg, adopt]);

  const seal = useCallback(async () => {
    setBusy("seal");
    setNote(null);
    try {
      const r = await fetch("/api/edge/pair", { method: "POST" });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; code?: string } | null;
      setNote(d?.ok ? { ok: true, text: t("sealedNow") } : { ok: false, text: errMsg(d, t("sealFailed")) });
      adopt(await readEdgeConfig());
      notifyDataChanged();
    } catch {
      setNote({ ok: false, text: t("sealFailed") });
    } finally {
      setBusy(null);
    }
  }, [t, errMsg, adopt]);

  return { state, url, setUrl, secret, setSecret, nudge, setNudge, busy, note, saves, save, drain, seal };
}
