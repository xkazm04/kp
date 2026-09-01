"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { BTN_GHOST, BTN_SECONDARY, CHIP_QUIET, FIELD, META_LABEL } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
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

  const fade = {
    initial: { opacity: reduced ? 1 : 0 },
    animate: { opacity: 1 },
    exit: { opacity: reduced ? 1 : 0 },
    transition: { duration: reduced ? 0 : 0.18, ease: "easeOut" as const },
  };

  return (
    <div className="space-y-3">
      {showTitle ? <div className={META_LABEL}>{t("title")}</div> : null}
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
                <span className="text-body font-medium text-ink">{a.title}</span>
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
            <motion.div key="pick" {...fade} className="flex flex-wrap gap-2">
              <button type="button" className={`${BTN_SECONDARY} h-9 px-3 text-sm`} onClick={() => setMode("note")}>
                {t("addNote")}
              </button>
              <button type="button" className={`${BTN_SECONDARY} h-9 px-3 text-sm`} onClick={() => setMode("jd")}>
                {t("addJd")}
              </button>
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
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`${BTN_SECONDARY} h-9 px-3 text-sm`}
                  disabled={saving || !text.trim()}
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
