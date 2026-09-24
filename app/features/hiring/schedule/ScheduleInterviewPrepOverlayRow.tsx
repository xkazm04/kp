"use client";

// One question of the per-candidate kit overlay, and the inline form that adds one.
// Split out of ScheduleInterviewPrepOverlay.tsx to keep each view file small.
//
// A row says three things before it offers anything: WHERE the question comes from
// (the kit, this candidate's CV, or the recruiter), WHAT the recruiter did to it for
// this candidate (rewritten / removed), and WHETHER the interview will actually ask it.
// The actions follow from those: a kit or CV question can be rewritten or removed (and
// restored), a question the recruiter added can be rewritten or deleted.

import { useId, useState, type FormEvent } from "react";
import { Pencil, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import { Checkbox } from "@/app/_components/Checkbox";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_GHOST, BTN_SECONDARY, CHIP_QUIET } from "@/app/_components/ui/recipes";
import { KIT_OVERLAY_CV_PROBES_ASKED, KIT_OVERLAY_MAX_TEXT_CHARS } from "@/app/_lib/interview-kit-overlay";
import type { OverlayRow } from "./scheduleInterviewPrepOverlayModel";
import type { PrepOverlayLogic } from "./useScheduleInterviewPrepOverlay";

type OverlayT = PrepOverlayLogic["t"];

const ACTION = `${BTN_GHOST} shrink-0 px-1.5 py-0.5 text-sm`;

export function OverlayRowItem({
  row,
  canMarkMustAsk,
  onDrop,
  onRestore,
  onEdit,
  onRevert,
  onRemoveAdded,
  onPatchAdded,
  t,
}: {
  row: OverlayRow;
  /** For an added row: whether its must-ask toggle may be switched ON. */
  canMarkMustAsk: boolean;
  onDrop: () => void;
  onRestore: () => void;
  onEdit: (text: string) => void;
  onRevert: () => void;
  onRemoveAdded: () => void;
  onPatchAdded: (patch: { text?: string; mustAsk?: boolean }) => void;
  t: OverlayT;
}) {
  const textId = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.text);
  const dropped = row.state === "dropped";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (row.origin === "added") onPatchAdded({ text: value });
    else onEdit(value);
    setEditing(false);
  };

  return (
    <li className={`rounded-md border px-2.5 py-1.5 ${dropped ? "border-dashed border-stone-300" : "border-stone-200"}`}>
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <span className={`${CHIP_QUIET} shrink-0`}>
          {row.origin === "kit" ? t("originKit") : row.origin === "cv" ? t("originCv") : t("originAdded")}
        </span>
        {editing ? (
          <form onSubmit={submit} className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <TextInput
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label={t("editAria")}
              maxLength={KIT_OVERLAY_MAX_TEXT_CHARS}
              sizeVariant="sm"
              className="min-w-48 flex-1"
              autoFocus
            />
            <button type="submit" disabled={!value.trim()} className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`}>
              {t("saveEdit")}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setValue(row.text);
              }}
              className={`${BTN_GHOST} h-8 px-2 text-sm`}
            >
              {t("cancelEdit")}
            </button>
          </form>
        ) : (
          <span id={textId} className={`min-w-0 flex-1 text-sm ${dropped ? "text-steel line-through" : "text-ink"}`}>
            “{row.text}”
          </span>
        )}
        {!editing ? (
          <span className="flex shrink-0 items-center gap-0.5">
            {dropped ? (
              <button type="button" onClick={onRestore} aria-describedby={textId} className={ACTION}>
                <RotateCcw size={13} aria-hidden /> {t("restore")}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setValue(row.text);
                    setEditing(true);
                  }}
                  aria-describedby={textId}
                  className={ACTION}
                >
                  <Pencil size={13} aria-hidden /> {t("rewrite")}
                </button>
                {row.state === "edited" ? (
                  <button type="button" onClick={onRevert} aria-describedby={textId} className={ACTION}>
                    <Undo2 size={13} aria-hidden /> {t("revert")}
                  </button>
                ) : null}
                {row.origin === "added" ? (
                  <button type="button" onClick={onRemoveAdded} aria-describedby={textId} className={`${ACTION} hover:text-coral`}>
                    <Trash2 size={13} aria-hidden /> {t("removeAdded")}
                  </button>
                ) : (
                  <button type="button" onClick={onDrop} aria-describedby={textId} className={`${ACTION} hover:text-coral`}>
                    <X size={13} aria-hidden /> {t("drop")}
                  </button>
                )}
              </>
            )}
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-1 text-sm">
        {row.origin === "added" ? (
          <Checkbox
            checked={row.mustAsk}
            disabled={!row.mustAsk && !canMarkMustAsk}
            onChange={(e) => onPatchAdded({ mustAsk: e.target.checked })}
            aria-describedby={textId}
            title={!row.mustAsk && !canMarkMustAsk ? t("mustAskFull") : t("mustAskHint")}
            label={t("mustAsk")}
          />
        ) : row.mustAsk && !dropped ? (
          <span className="font-semibold text-coral">{t("mustAsk")}</span>
        ) : null}
        {row.state === "edited" ? <span className="text-moss">{t("stateEdited")}</span> : null}
        {dropped ? <span className="text-steel">{t("stateDropped")}</span> : null}
        {row.state === "edited" && row.original ? (
          <span className="min-w-0 text-steel">{t("originalWas", { text: row.original })}</span>
        ) : null}
        {!dropped && !row.asked && row.origin === "cv" ? (
          <span className="text-steel">{t("notAsked", { max: KIT_OVERLAY_CV_PROBES_ASKED })}</span>
        ) : null}
      </div>
    </li>
  );
}

/** The inline "add a question for this candidate" form. The must-ask box carries the
 *  clock rule as its hint, where the choice is made. */
export function OverlayAddForm({
  canMarkMustAsk,
  onAdd,
  onCancel,
  t,
}: {
  canMarkMustAsk: boolean;
  onAdd: (text: string, mustAsk: boolean) => void;
  onCancel: () => void;
  t: OverlayT;
}) {
  const [text, setText] = useState("");
  const [mustAsk, setMustAsk] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onAdd(text, mustAsk && canMarkMustAsk);
      }}
      className="space-y-1.5 rounded-md border border-stone-200 p-2"
    >
      <TextInput
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label={t("addAria")}
        placeholder={t("addPlaceholder")}
        maxLength={KIT_OVERLAY_MAX_TEXT_CHARS}
        sizeVariant="sm"
        autoFocus
      />
      <Checkbox
        checked={mustAsk && canMarkMustAsk}
        disabled={!canMarkMustAsk}
        onChange={(e) => setMustAsk(e.target.checked)}
        label={t("mustAsk")}
        hint={canMarkMustAsk ? t("mustAskHint") : t("mustAskFull")}
      />
      <div className="flex items-center gap-1.5">
        <button type="submit" disabled={!text.trim()} className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`}>
          {t("add")}
        </button>
        <button type="button" onClick={onCancel} className={`${BTN_GHOST} h-8 px-2 text-sm`}>
          {t("cancelEdit")}
        </button>
      </div>
    </form>
  );
}
