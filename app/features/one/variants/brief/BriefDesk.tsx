"use client";

// The Brief's conversation DOCK — "Ask the desk". A side column on wide screens, a
// sticky dock at the bottom of the page on narrow ones. It holds, in reading order:
// the "what changed" line with Undo (always first, so a screen change is never silent),
// the latest answer with the acts it proposed, its follow-up chips, the composer, and
// the earlier conversation folded behind one toggle.
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, ChipRow, TextField } from "@/app/_components/kit";
import { EYEBROW, PANEL } from "@/app/_components/ui/recipes";
import { consoleHref } from "../../panels/PanelShell";
import type { ChipId, Turn } from "../../types";
import type { VariantProps } from "../../variantProps";

type Props = Pick<VariantProps, "session" | "submit" | "words" | "renderConsent">;

export function BriefDesk({ session, submit, words, renderConsent }: Props) {
  const core = useTranslations("one.core");
  const t = useTranslations("one.brief.desk");
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);

  const turns = session.turns;
  const lastOneIndex = turns.findLastIndex((x) => x.who === "one");
  const last = lastOneIndex >= 0 ? (turns[lastOneIndex] as Extract<Turn, { who: "one" }>) : null;
  const asked = lastOneIndex > 0 ? turns[lastOneIndex - 1] : null;
  const earlier = lastOneIndex > 0 ? turns.slice(0, lastOneIndex - 1) : [];
  // Acts proposed by any reply stay in the dock until the user answers them: a folded
  // transcript never hides a card that waits for a yes.
  const waiting = session.proposals.filter((p) => p.turnId !== null);

  const chipsFor = (ids: readonly ChipId[]) => ids.map((id) => ({ id, label: words.chip(id), onPress: () => submit({ chip: id }) }));
  const userWords = (turn: Extract<Turn, { who: "user" }>) => turn.text ?? (turn.chip ? words.chip(turn.chip) : "");
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit({ text: draft });
    setDraft("");
  };

  return (
    <div className={`${PANEL} flex flex-col gap-4 p-4 dark:border-2 dark:border-ink dark:shadow-sticker-sm`}>
      <p className={EYEBROW}>{t("kicker")}</p>

      <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink" role="status" data-role="one-change">
        {session.lastChange ? (
          <>
            <span>
              <span className="font-semibold">{t("changed")}</span> {words.change(session.lastChange)}
            </span>
            {session.canUndo ? <Button label={core("change.undo")} variant="link" size="sm" onClick={session.undo} /> : null}
          </>
        ) : (
          <span className="text-steel">{t("unchanged")}</span>
        )}
      </div>

      {last ? (
        <div className="flex flex-col gap-2 border-t border-stone-200 pt-3 dark:border-t-2 dark:border-dashed" data-role="one-latest" data-fallback={last.fallback || undefined}>
          {asked && asked.who === "user" ? (
            <p className="text-meta text-steel">
              <span className="font-semibold">{core("you")}</span> {userWords(asked)}
            </p>
          ) : null}
          <p className="font-serif text-h3 text-ink">{words.say(last.say)}</p>
          {last.fallback ? <p className="text-meta text-steel">{t("fallback")}</p> : null}
          {last.dropped > 0 ? <p className="text-meta text-steel">{words.dropped(last.dropped)}</p> : null}
          {last.links.map((l) => (
            <Link key={l.tab} className="k-btn k-btn--link k-btn--sm self-start" href={consoleHref(l.tab, l.params)}>
              {core("meta.console")}
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-body text-steel">{t("none")}</p>
      )}

      {waiting.length > 0 ? (
        <div className="flex flex-col gap-3" data-role="one-desk-proposals">
          <p className="text-meta font-semibold text-ink">{t("waiting")}</p>
          {waiting.map((p) => renderConsent(p))}
        </div>
      ) : null}

      {last && last.chips.length > 0 ? <ChipRow chips={chipsFor(last.chips)} /> : null}

      <form className="flex items-center gap-2" onSubmit={onSubmit} data-role="one-composer">
        <TextField label={core("composer.label")} placeholder={core("composer.placeholder")} value={draft} onChange={setDraft} className="flex-1" />
        {session.pending ? (
          <Button label={core("composer.stop")} variant="secondary" onClick={session.stop} />
        ) : (
          <Button label={core("composer.send")} variant="primary" type="submit" disabled={!draft.trim()} />
        )}
      </form>
      {session.pending ? (
        <p className="text-meta text-steel" role="status">
          {core("composer.working")}
        </p>
      ) : null}

      {earlier.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Button
            label={open ? t("hide") : t("show", { count: earlier.filter((x) => x.who === "user").length })}
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls="one-brief-transcript"
            onClick={() => setOpen((v) => !v)}
            className="self-start"
          />
          {open ? (
            <ol id="one-brief-transcript" className="flex flex-col gap-2" data-role="one-turns">
              {earlier.map((turn) =>
                turn.who === "user" ? (
                  <li key={turn.id} className="text-meta text-steel" data-who="user">
                    <span className="font-semibold">{core("you")}</span> {userWords(turn)}
                  </li>
                ) : (
                  <li key={turn.id} className="text-body text-ink" data-who="one" data-fallback={turn.fallback || undefined}>
                    {words.say(turn.say)}
                  </li>
                )
              )}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
