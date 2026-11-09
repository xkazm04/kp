"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

/*
 * The human band's two demonstrations (prototype app.js "human gate" and "what
 * may run unattended"):
 *
 * GateTrack: when the rail comes into view, the sample candidate's card travels
 * CV arrives -> AI reads & scores -> Human gate, and stops there. Only the
 * "Sign as ..." button moves it on to Advances; "replay" walks it again. Under
 * reduced motion the walk lands on the gate at once.
 *
 * Unattended: the three stage switches. Screening and Offer may be delegated
 * (AUTO) or kept (YOU), and the line under them says what now runs unattended.
 * Rejection refuses AUTO: the row shakes and the note flashes. That is the
 * product's rule (MarketingClaims.test.ts pins that no rejection gate exists),
 * so the toggle is honest: rejection never unlocks.
 */

const REDUCE = "(prefers-reduced-motion: reduce)";

type TrackState = "idle" | "run" | "wait" | "done";

export function GateTrack({
  stations,
  fit,
  evidence,
  waiting,
  signed,
  initials,
  messages,
  signLabel,
  replayLabel
}: {
  /** The four stop names, in order. */
  stations: readonly [string, string, string, string];
  fit: string;
  evidence: string;
  waiting: string;
  signed: string;
  initials: string;
  messages: { approaching: string; arrives: string; scored: string; waiting: string; signed: string };
  signLabel: string;
  replayLabel: string;
}) {
  const [step, setStep] = useState(1);
  const [state, setState] = useState<TrackState>("idle");
  const [msg, setMsg] = useState(messages.approaching);
  const track = useRef<HTMLOListElement | null>(null);
  const timers = useRef<number[]>([]);

  const journey = useCallback(
    (instant: boolean) => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
      setState("run");
      setStep(1);
      setMsg(messages.arrives);
      const at = (ms: number, fn: () => void) => {
        timers.current.push(window.setTimeout(fn, instant ? 0 : ms));
      };
      at(1100, () => {
        setStep(2);
        setMsg(messages.scored);
      });
      at(2700, () => {
        setStep(3);
        setState("wait");
        setMsg(messages.waiting);
      });
    },
    [messages.arrives, messages.scored, messages.waiting]
  );

  useEffect(() => {
    const ol = track.current;
    const pending = timers;
    if (!ol) return;
    const reduced = window.matchMedia(REDUCE).matches;
    let io: IntersectionObserver | null = null;
    let startT = 0;
    if (typeof IntersectionObserver === "function") {
      io = new IntersectionObserver(
        (entries, o) => {
          if (entries[0]?.isIntersecting) {
            o.disconnect();
            journey(reduced);
          }
        },
        { threshold: 0.6 }
      );
      io.observe(ol);
    } else {
      startT = window.setTimeout(() => journey(true), 0);
    }
    return () => {
      io?.disconnect();
      window.clearTimeout(startT);
      pending.current.forEach((id) => window.clearTimeout(id));
      pending.current = [];
    };
  }, [journey]);

  const sign = () => {
    setStep(4);
    setState("done");
    setMsg(messages.signed);
  };

  return (
    <div className="track-card">
      <ol
        className="track"
        ref={track}
        data-state={state === "idle" ? undefined : state}
        style={{ "--s": step } as CSSProperties}
      >
        <li className="st">
          <i aria-hidden="true">1</i>
          <b>{stations[0]}</b>
          <small>{fit}</small>
        </li>
        <li className="st">
          <i aria-hidden="true">2</i>
          <b>{stations[1]}</b>
          <small>{evidence}</small>
        </li>
        <li className="st gate">
          <i aria-hidden="true">3</i>
          <b>{stations[2]}</b>
          <small className="gs">{waiting}</small>
        </li>
        <li className="st">
          <i aria-hidden="true">4</i>
          <b>{stations[3]}</b>
          <small className="as">{signed}</small>
        </li>
        <span className="tk-line" aria-hidden="true" />
        <span className="tk-fill" aria-hidden="true" />
        <span className="tk-mark" aria-hidden="true">
          <span>{initials}</span>
        </span>
      </ol>
      <div className="gate-row">
        <p className="gate-msg" role="status" aria-live="polite">
          {msg}
        </p>
        <button className="btn primary" type="button" disabled={state !== "wait"} onClick={sign}>
          {signLabel}
        </button>
        <button className="lnk" type="button" hidden={state !== "done"} onClick={() => journey(false)}>
          {replayLabel}
        </button>
      </div>
    </div>
  );
}

type RowKey = "screen" | "offer" | "reject";

/** Screening, offer and rejection are ALL locked: no workspace setting hands any of
 *  them to the machine (operator ruling 2026-11-09). Pressing AUTO on any row shakes
 *  it and flashes the note, as the rejection row always did. */
export function Unattended({
  title,
  names,
  auto,
  you,
  lockedNote,
  legendLocked,
  statusNote
}: {
  title: string;
  names: Record<RowKey, string>;
  auto: string;
  you: string;
  lockedNote: string;
  legendLocked: string;
  /** The status line: what waits for a person. */
  statusNote: string;
}) {
  const rowRefs = useRef<Record<RowKey, HTMLDivElement | null>>({ screen: null, offer: null, reject: null });
  const lockMsg = useRef<HTMLParagraphElement | null>(null);

  /** Restart a one-shot CSS animation class (the prototype's remove, reflow, add). */
  const replay = (el: HTMLElement | null, cls: string) => {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  };

  const renderToggle = (row: RowKey) => (
    <div className="tg" role="group" aria-label={names[row]}>
      {(["auto", "you"] as const).map((v) => (
        <button
          key={v}
          type="button"
          data-v={v}
          className={v === "you" ? "on" : undefined}
          aria-pressed={v === "you"}
          aria-describedby={v === "auto" ? "lockMsg" : undefined}
          style={UPPER}
          onClick={() => {
            if (v === "auto") {
              replay(rowRefs.current[row], "shake");
              replay(lockMsg.current, "flash");
            }
          }}
        >
          {v === "auto" ? <span className="padlock" aria-hidden="true" /> : null}
          {v === "auto" ? auto : you}
        </button>
      ))}
    </div>
  );

  return (
    <div className="un-card">
      <h3 className="eyebrow-s">{title}</h3>
      {(["screen", "offer", "reject"] as const).map((row) => (
        <div
          className="un-row lock"
          data-k={row}
          key={row}
          ref={(el) => {
            rowRefs.current[row] = el;
          }}
        >
          <span className="un-n">{names[row]}</span>
          {renderToggle(row)}
        </div>
      ))}
      <p className="un-msg" id="lockMsg" ref={lockMsg} role="status" aria-live="polite">
        {lockedNote}
      </p>
      <p className="un-log" role="status" aria-live="polite">
        {statusNote}
      </p>
      <p className="un-legend">
        <span className="lg-l" />
        {legendLocked}
      </p>
    </div>
  );
}

/** The legend's separator (punctuation, not copy). */
const SEP = " · ";

/** The switches read AUTO / YOU in capitals, whatever the language's own case. */
const UPPER: CSSProperties = { textTransform: "uppercase" };
