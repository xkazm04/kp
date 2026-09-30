"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { gigNeedsResearch } from "@/app/_lib/gigs/loop";
import type { Gig } from "@/app/_lib/gigs/types";
import { useGigLoops, useLoopAction } from "../../front/loopWatch";
import { loopState } from "../../logic/loop";
import type { AfterWrite } from "../../logic/wire";

// The accept loop on the sign-off (WP14). A New listing is accepted INTO the loop - kp
// researches it, then writes its plans, and the operator chooses one before any dispatch - or
// declined. A qualified gig shows where its loop stands while this session watches it, and a
// qualified gig with no current research is offered the loop alone ("process").

function useLoopMove(gig: Gig, action: "accept" | "process", onChanged: AfterWrite) {
  const loopAction = useLoopAction();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const out = await loopAction(gig, action);
    setBusy(false);
    if ("error" in out) setError(out.error);
    else await onChanged(out.flash);
  }
  return { busy, error, go };
}

export function AcceptNew({ gig, onChanged, onDecline }: { gig: Gig; onChanged: AfterWrite; onDecline: () => void }) {
  const t = useTranslations("gigs");
  const { busy, error, go } = useLoopMove(gig, "accept", onChanged);
  return (
    <div className="acts">
      <p className="hint">{t("loop.acceptHint")}</p>
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className="btn primary block wrap" disabled={busy} onClick={() => void go()}>
        {t("loop.accept")}
      </button>
      <button type="button" className="btn ghost danger block" disabled={busy} onClick={onDecline}>
        {t("triageView.decline")}
      </button>
    </div>
  );
}

export function LoopOffer({ gig, onChanged }: { gig: Gig; onChanged: AfterWrite }) {
  const t = useTranslations("gigs");
  const watch = useGigLoops().find((w) => w.gigId === gig.id);
  const state = watch ? loopState(watch) : null;
  const { busy, error, go } = useLoopMove(gig, "process", onChanged);
  if (state) {
    return (
      <p className="hint" role="status">
        <b>{t("loop.title")}.</b> {t(`loop.state.${state}`)}
      </p>
    );
  }
  if (!gigNeedsResearch(gig)) return null;
  return (
    <div className="acts">
      <p className="hint">{t("loop.processHint")}</p>
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className="btn block wrap" disabled={busy} onClick={() => void go()}>
        {t("loop.process")}
      </button>
    </div>
  );
}
