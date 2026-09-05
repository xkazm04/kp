"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { BTN_GHOST, BTN_SECONDARY, CHIP_QUIET, FIELD, META_LABEL } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useErrorMessage } from "@/app/_lib/use-error-message";
// BOTH caps are the ROUTE's — imported, never re-typed, so the composer's
// disclosure and the server's refusal can never drift apart. The pane used to
// import the text cap only, so a sixth attachment looked addable: the click
// spent a round trip and came back as one generic red line.
import { ATTACHMENT_LIMIT, ATTACHMENT_TEXT_MAX } from "@/app/api/intake/[id]/attachments/attachment-limits";
import type { IntakeAttachment } from "./jdsIntakeLogic";

// Reference material ("podklady"): a colleague's note pasted as text, or a
// saved JD picked from the library. The agent mines these as third-party
// context — values proposed from them wear the `inferred` chip until the
// requestor confirms them, which is why this pane sits beside the brief.

type JdOption = { slug: string; title: string };

export function JdsIntakeAttachmentsPane({
  attachments,
  frozen,
  saving,
  onAdd,
  onRemove,
  // Prototype layouts carry their own column header — suppress the inner title.
  showTitle = true,
}: {
  attachments: IntakeAttachment[];
  frozen: boolean;
  saving: boolean;
  /** Resolves false when the server refused the attachment (the route caps a
   *  session at 5, refuses a frozen session, and 404s an unknown JD) — the form
   *  then KEEPS the pasted note instead of clearing it under a one-line error. */
  onAdd: (input: { kind: "note"; title: string; text: string } | { kind: "jd"; jdSlug: string }) => void | Promise<boolean>;
  onRemove: (index: number) => void;
  showTitle?: boolean;
}) {
  const t = useTranslations("library.tab.intake.attachments");
  // The refusal is shown from the route's machine CODE, never from its English
  // `error` string (app/_lib/use-error-message.ts).
  const resolveError = useErrorMessage();
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<"none" | "note" | "jd">("none");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [jds, setJds] = useState<JdOption[] | null>(null);
  const [jdSlug, setJdSlug] = useState("");

  // Clear the form only once the server has CONFIRMED the attachment.
  const commit = async (input: { kind: "note"; title: string; text: string } | { kind: "jd"; jdSlug: string }) => {
    const ok = await onAdd(input);
    if (ok === false) return;
    if (input.kind === "note") {
      setTitle("");
      setText("");
    } else {
      setJdSlug("");
    }
    setMode("none");
  };

  useEffect(() => {
    if (mode !== "jd" || jds !== null) return;
    // Deferred a tick (the jdsHooks.ts pattern) — no synchronous setState in an effect.
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/jds");
        const data = (await res.json()) as { jds?: { slug: string; title: string }[] };
        setJds((data.jds ?? []).map((j) => ({ slug: j.slug, title: j.title })));
      } catch {
        setJds([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [mode, jds]);

  const tooLong = text.trim().length > ATTACHMENT_TEXT_MAX;
  const atLimit = attachments.length >= ATTACHMENT_LIMIT;

  const fade = {
    initial: { opacity: reduced ? 1 : 0 },
    animate: { opacity: 1 },
    exit: { opacity: reduced ? 1 : 0 },
    transition: { duration: reduced ? 0 : 0.18, ease: "easeOut" as const },
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {showTitle ? <div className={META_LABEL}>{t("title")}</div> : null}
        {/* How much room is left, said BEFORE the send. The cap is a real
            refusal on the route (INTAKE_ATTACHMENT_LIMIT), and a cap nobody
            can see is only discoverable by hitting it. */}
        <span className={`${CHIP_QUIET} nums`}>{t("countOfMax", { used: attachments.length, max: ATTACHMENT_LIMIT })}</span>
      </div>
      {attachments.length === 0 ? <p className="text-body text-steel">{t("empty")}</p> : null}
      <AnimatePresence initial={false}>
        {attachments.map((a, i) => (
          <motion.div
            key={`${a.kind}-${a.title}-${i}`}
            {...fade}
            className="flex items-start justify-between gap-2 rounded-lg border border-stone-200 bg-white p-3 dark:rounded-2xl"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {/* An untitled note is stored untitled (the route no longer
                    stamps the English word "Note" into everyone's data) — the
                    reader's own language supplies the stand-in, at render time,
                    so existing rows and new ones read the same. */}
                <span className="text-body font-medium text-ink">{a.title || t("noteFallbackTitle")}</span>
                <span className={CHIP_QUIET}>{a.kind === "jd" ? t("kindJd") : t("kindNote")}</span>
              </div>
              <p className="mt-1 line-clamp-3 whitespace-pre-line text-meta text-steel">{a.text.slice(0, 280)}</p>
            </div>
            {!frozen ? (
              <button type="button" className={`${BTN_GHOST} h-8 shrink-0 px-2 text-sm`} disabled={saving} onClick={() => onRemove(i)}>
                {t("remove")}
              </button>
            ) : null}
          </motion.div>
        ))}
      </AnimatePresence>

      {frozen ? null : (
        <AnimatePresence mode="wait" initial={false}>
          {mode === "none" ? (
            <motion.div key="pick" {...fade} className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`${BTN_SECONDARY} h-9 px-3 text-sm`}
                  disabled={atLimit}
                  onClick={() => setMode("note")}
                >
                  {t("addNote")}
                </button>
                <button
                  type="button"
                  className={`${BTN_SECONDARY} h-9 px-3 text-sm`}
                  disabled={atLimit}
                  onClick={() => setMode("jd")}
                >
                  {t("addJd")}
                </button>
              </div>
              {/* The sentence under a stopped control is the ROUTE's own refusal,
                  resolved in the reader's language, so the pane can never say
                  something the server would contradict. */}
              {atLimit ? (
                <p className="text-meta text-steel">
                  {resolveError({ code: "INTAKE_ATTACHMENT_LIMIT" }, t("countOfMax", { used: attachments.length, max: ATTACHMENT_LIMIT }), {
                    max: ATTACHMENT_LIMIT,
                  })}
                </p>
              ) : null}
            </motion.div>
          ) : mode === "note" ? (
            <motion.div key="note" {...fade} className="space-y-2">
              {/* A placeholder is not an accessible name: it is not exposed as one by
                  every AT, and it disappears the moment the field has content — so a
                  screen-reader user re-entering the note title hears "edit text" and
                  nothing else. These three controls carry no visible <label> by design
                  (the pane is a compact rail), so they name themselves. The same
                  strings, through the same keys: no catalog entry is added, and the
                  spoken name matches the visible hint exactly. Idiom borrowed from
                  JdsIntakeBriefTitle's inline title field one directory over. */}
              <input
                className={`${FIELD} w-full`}
                value={title}
                aria-label={t("noteTitlePlaceholder")}
                placeholder={t("noteTitlePlaceholder")}
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                className={`${FIELD} min-h-[8rem] w-full resize-y`}
                value={text}
                aria-label={t("notePlaceholder")}
                placeholder={t("notePlaceholder")}
                onChange={(e) => setText(e.target.value)}
              />
              {/* The cap is disclosed BEFORE the send, not discovered after it:
                  the server refuses past it (INTAKE_ATTACHMENT_TOO_LONG) and
                  used to silently truncate. */}
              {tooLong ? <p className="text-meta text-red-700">{t("textCap", { max: ATTACHMENT_TEXT_MAX })}</p> : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`${BTN_SECONDARY} h-9 px-3 text-sm`}
                  disabled={saving || !text.trim() || tooLong}
                  onClick={() => void commit({ kind: "note", title: title.trim(), text: text.trim() })}
                >
                  {t("add")}
                </button>
                <button type="button" className={`${BTN_GHOST} h-9 px-3 text-sm`} onClick={() => setMode("none")}>
                  {t("cancel")}
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="jd" {...fade} className="space-y-2">
              <select className={`${FIELD} w-full`} aria-label={t("jdPick")} value={jdSlug} onChange={(e) => setJdSlug(e.target.value)}>
                <option value="">{t("jdPick")}</option>
                {(jds ?? []).map((j) => (
                  <option key={j.slug} value={j.slug}>
                    {j.title}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`${BTN_SECONDARY} h-9 px-3 text-sm`}
                  disabled={saving || !jdSlug}
                  onClick={() => void commit({ kind: "jd", jdSlug })}
                >
                  {t("add")}
                </button>
                <button type="button" className={`${BTN_GHOST} h-9 px-3 text-sm`} onClick={() => setMode("none")}>
                  {t("cancel")}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
