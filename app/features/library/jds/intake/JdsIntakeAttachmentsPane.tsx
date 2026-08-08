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
}: {
  attachments: IntakeAttachment[];
  frozen: boolean;
  saving: boolean;
  onAdd: (input: { kind: "note"; title: string; text: string } | { kind: "jd"; jdSlug: string }) => void;
  onRemove: (index: number) => void;
}) {
  const t = useTranslations("library.tab.intake.attachments");
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<"none" | "note" | "jd">("none");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [jds, setJds] = useState<JdOption[] | null>(null);
  const [jdSlug, setJdSlug] = useState("");

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
      <div className={META_LABEL}>{t("title")}</div>
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
              <input
                className={`${FIELD} w-full`}
                value={title}
                placeholder={t("noteTitlePlaceholder")}
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                className={`${FIELD} min-h-[8rem] w-full resize-y`}
                value={text}
                placeholder={t("notePlaceholder")}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`${BTN_SECONDARY} h-9 px-3 text-sm`}
                  disabled={saving || !text.trim()}
                  onClick={() => {
                    onAdd({ kind: "note", title: title.trim(), text: text.trim() });
                    setTitle("");
                    setText("");
                    setMode("none");
                  }}
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
              <select className={`${FIELD} w-full`} value={jdSlug} onChange={(e) => setJdSlug(e.target.value)}>
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
                  onClick={() => {
                    onAdd({ kind: "jd", jdSlug });
                    setJdSlug("");
                    setMode("none");
                  }}
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
