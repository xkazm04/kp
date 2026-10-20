"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { SV_BTN_SM_GHOST, SV_BTN_SM_PRIMARY, SV_WANT_VIEW } from "./sieveRecipes";

// One Step 4 card in two layers.
//
// VIEW - the card states its value, large (a place, a floor, a title, a mode, a level),
// or "—" with the reason it is empty. The whole card is one button: a click (or Enter)
// opens it.
//
// EDIT - the card's controls, working on a DRAFT copied from the stored value when it
// opened. Nothing the seeker taps here is saved until Done, and nothing a save elsewhere
// brings back can reset it (the defect the draft exists for: wantModel.ts). Done asks
// `commit` for the value; a draft the store cannot hold comes back as a sentence and
// the card stays open. Cancel or Escape drops the draft. Focus moves into the editor on
// open and back to the card on close.

export type WantCardCommit = { ok: true } | { ok: false; message: string };

export function WantCard<D>({
  title,
  hint,
  icon,
  wide = false,
  filling,
  value,
  valueText,
  sub,
  empty,
  rule,
  draftOf,
  editor,
  commit,
}: {
  title: string;
  hint: string;
  /** A line icon beside the title (decoration, aria-hidden by the caller's icon). */
  icon?: ReactNode;
  /** Spans two columns of the bento (the cards whose values run long). */
  wide?: boolean;
  /** The first-view highlight (the answers arriving). */
  filling: boolean;
  /** The dominant value, or "—" when nothing is set. */
  value: ReactNode;
  /** The value as plain text, for the button's accessible name. */
  valueText: string;
  /** One quieter line under the value (the reason for an empty one, a count, a period). */
  sub?: ReactNode;
  empty: boolean;
  /** The card's standing rule, shown in both layers. */
  rule: ReactNode;
  /** The draft the editor starts from - read from what is stored, at the moment it opens. */
  draftOf(): D;
  editor(draft: D, setDraft: (next: D) => void): ReactNode;
  /** Done: store the draft, or say why it cannot be stored. */
  commit(draft: D): WantCardCommit;
}) {
  const t = useTranslations("me.sieve.want");
  // Boxed: a draft may itself be null (the level card's "any level").
  const [box, setBox] = useState<{ draft: D } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const viewRef = useRef<HTMLButtonElement | null>(null);
  const editRef = useRef<HTMLDivElement | null>(null);
  const returnFocus = useRef(false);
  const problemId = useId();
  const open = box !== null;

  useEffect(() => {
    if (open) {
      editRef.current?.querySelector<HTMLElement>("input, select, button:not([data-want-close])")?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      viewRef.current?.focus();
    }
  }, [open]);

  const close = () => {
    returnFocus.current = true;
    setProblem(null);
    setBox(null);
  };
  const done = () => {
    if (box === null) return;
    const out = commit(box.draft);
    if (out.ok) close();
    else setProblem(out.message);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };

  return (
    <div className={`wcard${open ? " editing" : " viewing"}${filling ? " filling" : ""}${wide ? " wide" : ""}`}>
      <div className="wh">
        {icon ? <span className="wicon">{icon}</span> : null}
        <h3>{title}</h3>
        <span className="small muted">{hint}</span>
      </div>
      {box ? (
        <div className="wedit" ref={editRef} onKeyDown={onKeyDown} role="group" aria-label={title} aria-describedby={problem ? problemId : undefined}>
          {editor(box.draft, (next) => {
            setProblem(null);
            setBox({ draft: next });
          })}
          {problem ? (
            <div id={problemId} className="rule warn" role="alert">
              {problem}
            </div>
          ) : null}
          <div className="wdone">
            <button type="button" className={SV_BTN_SM_GHOST} data-want-close onClick={close}>
              {t("cancel")}
            </button>
            <button type="button" className={SV_BTN_SM_PRIMARY} data-want-close onClick={done}>
              {t("done")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          ref={viewRef}
          className={SV_WANT_VIEW}
          aria-expanded={false}
          aria-label={t("change", { card: title, value: valueText })}
          onClick={() => {
            setProblem(null);
            setBox({ draft: draftOf() });
          }}
        >
          <span className={`wval${empty ? " none" : ""}`}>{value}</span>
          {sub ? <span className="wsub">{sub}</span> : null}
          <span className="wgo" aria-hidden>
            {t("changeShort")}
          </span>
        </button>
      )}
      <div className="said">{rule}</div>
    </div>
  );
}
