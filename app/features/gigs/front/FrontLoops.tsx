"use client";

import { useTranslations } from "next-intl";
import { loopSettled, loopState } from "../logic/loop";
import type { ProofList } from "../proof/GigsProof";
import { useGigLoops } from "./loopWatch";

// The front page's "Being processed" strip (WP14): the gigs accepted (or sent to be processed)
// in this session, each with where its loop stands - research queued or being written, plans
// being written, plans written and waiting for the operator's choice, or stopped. Read from
// the task rows (front/loopWatch.ts); a row opens the gig's proof.

export function FrontLoops({ lastOpened, onOpen }: { lastOpened: string | null; onOpen: (gigId: string, list: ProofList) => void }) {
  const t = useTranslations("gigs");
  const loops = useGigLoops().filter((w) => loopState(w) !== null);
  if (loops.length === 0) return null;
  const busy = loops.filter((w) => !loopSettled(w)).length;
  const list: ProofList = { ids: loops.map((w) => w.gigId), label: t("loop.title") };

  return (
    <section className="newstrip" aria-labelledby="gd-col-loop">
      <div className="zone-head">
        <span className={`n${busy ? " coral" : ""}`}>{loops.length}</span>
        <h3 className="caps" id="gd-col-loop">
          {t("loop.title")}
        </h3>
        <span className="who">{t("loop.who")}</span>
      </div>
      <ul className="contents" aria-live="polite">
        {loops.map((w) => {
          const state = loopState(w)!;
          return (
            <li key={w.gigId} className={`nrow${w.gigId === lastOpened ? " current" : ""}`}>
              <button type="button" className="nopen" onClick={() => onOpen(w.gigId, list)}>
                <span className="t">{w.title}</span>
              </button>
              <span className="t-meta">
                {state === "ready" ? <b>{t(`loop.state.${state}`)}</b> : t(`loop.state.${state}`)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
