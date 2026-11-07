"use client";

// letter — ONE candidate's held outreach letter + their thread (round 4), read through
// tools/reads.ts `useLetter` (GET /api/outreach-letters/by-entry/[entryId] and
// GET /api/comms?entry=). Params: entryId, label. Looks: `pane` = the reader with the
// forecast line and the act (tools/LetterTool.tsx); `insight` = a card with the subject and
// the first lines. Approve / Send arm PREVIEW consent cards; nothing is written.
import { useTranslations } from "next-intl";
import { Tag } from "@/app/_components/kit";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { LetterAct, LetterPane } from "../tools/LetterTool";
import { useLetter } from "../tools/reads";
import { PanelFrame } from "./PanelFrame";
import type { PanelProps } from "./types";

/** The first lines of a letter for the card: up to ~4 lines of the stored text. */
function firstLines(body: string | null): string {
  if (!body) return "";
  return body.split(/\n/).filter((l) => l.trim() !== "").slice(0, 4).join("\n");
}

export function LetterPanel(props: PanelProps) {
  const t = useTranslations("one.core.panels.letter");
  const { entryId = "", label = "" } = props.panel.params;
  const { letter, thread } = useLetter(entryId || null, props.epoch);
  const held = letter.state === "ready" ? letter.data : null;
  const messages = thread.state === "ready" ? thread.data.messages : null;
  return (
    <PanelFrame
      props={{ ...props, look: props.look === "insight" ? "insight" : "pane" }}
      data={{
        title: label ? t("titleFor", { label }) : t("title"),
        console: entryId ? { tab: "pipeline", params: { q: label } } : undefined,
        read: entryId ? letter : { state: "ready", data: null, retry: () => undefined },
        cols: [],
        rows: [],
        empty: t("pick"),
        body: held
          ? {
              pane: <LetterPane letter={held.letter} preview={held.preview} label={label} thread={messages} onPropose={props.onPropose} />,
              insight: held.letter ? (
                <div className="flex flex-col gap-2 p-[var(--one-pad)]" data-role="one-letter-card">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag label={t(`state.${held.letter.state}`)} />
                    <span className="k-nums text-micro text-steel">{t("revision", { revision: held.letter.revision })}</span>
                  </div>
                  <p className={META_LABEL}>{t("subject")}</p>
                  <p className="break-words text-micro font-semibold text-ink">{held.letter.subject ?? t("noSubject")}</p>
                  <p className="line-clamp-4 whitespace-pre-wrap break-words text-micro text-steel">{firstLines(held.letter.body)}</p>
                  <div>
                    <LetterAct letter={held.letter} label={label} onPropose={props.onPropose} />
                  </div>
                </div>
              ) : (
                <p className="px-[var(--one-pad)] py-6 text-body text-steel" data-role="one-empty">
                  {t("none", { label })}
                </p>
              ),
            }
          : undefined,
      }}
    />
  );
}
