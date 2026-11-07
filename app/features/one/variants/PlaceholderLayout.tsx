"use client";

// The PLAIN round-2 placeholder every direction starts from: it exercises the whole core
// with no visual opinion — the answer stepper (last message + the views that answer it,
// never a transcript), the composer + chips, the "what changed" line with Undo, Stop while
// a change is pending, consent cards — inside the shell's fixed-viewport body (`h-full`,
// regions scroll inside themselves, the page does not). A variant builder replaces
// `./<id>/<Id>Variant.tsx`; this file stays as the reference wiring.
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, ChipRow, TextField } from "@/app/_components/kit";
import { consoleHref } from "../panels/PanelShell";
import type { ChipId } from "../types";
import type { VariantProps } from "../variantProps";

export function PlaceholderLayout({ variant, session, submit, greeting, renderPanel, renderConsent, words, current, position, stepBack, stepForward }: VariantProps) {
  const t = useTranslations("one.core");
  const [draft, setDraft] = useState("");
  const g = words.greeting(greeting);
  const chipsFor = (ids: readonly ChipId[]) => ids.map((id) => ({ id, label: words.chip(id), onPress: () => submit({ chip: id }) }));
  const chips = current ? current.reply.chips : greeting.state === "loading" ? [] : greeting.chips;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit({ text: draft });
    setDraft("");
  };
  const askedWords = current ? (current.asked.text ?? (current.asked.chip ? words.chip(current.asked.chip) : "")) : "";
  const panels = current ? current.panels : session.panels;
  return (
    <div className="grid h-full min-h-0 gap-4 p-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]" data-one-layout={variant}>
      <section className="flex min-h-0 flex-col gap-3 overflow-y-auto" aria-label={t("meta.conversationLabel")}>
        {current ? (
          <div className="flex flex-col gap-2" data-role="one-answer">
            <p className="text-meta text-steel">
              <span className="sr-only">{t("you")}: </span>
              {askedWords}
            </p>
            <p className="text-h3 text-ink">
              <span className="sr-only">{t("one")}: </span>
              {words.say(current.reply.say)}
            </p>
            {current.reply.dropped > 0 ? <p className="text-meta text-steel">{words.dropped(current.reply.dropped)}</p> : null}
            {current.reply.links.map((l) => (
              <Link key={l.tab} className="k-btn k-btn--link k-btn--sm" href={consoleHref(l.tab, l.params)}>
                {t("meta.console")}
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2" data-role="one-greeting">
            <p className="font-serif text-h2 text-ink">{g.status}</p>
            {g.first ? <p className="text-body text-ink">{g.first}</p> : null}
            {greeting.state === "needs" ? (
              <div>
                <Button label={t("greeting.show")} variant="secondary" size="sm" onClick={() => session.show(greeting.first.panel, greeting.first.params)} />
              </div>
            ) : null}
          </div>
        )}

        {current ? current.proposals.map((p) => renderConsent(p)) : null}
        {session.proposals.filter((p) => p.turnId === null && !current?.proposals.includes(p)).map((p) => renderConsent(p))}

        {chips.length > 0 ? <ChipRow chips={chipsFor(chips)} /> : null}

        <div className="mt-auto flex flex-col gap-2">
          {position.total > 0 ? (
            <div className="flex items-center gap-2" data-role="one-stepper">
              <Button label={t("step.back")} icon="left" iconOnly variant="ghost" size="sm" disabled={!position.canBack} onClick={stepBack} />
              <span className="k-nums text-meta text-steel" role="status">
                {t("step.position", { index: position.index + 1, total: position.total })}
              </span>
              <Button label={t("step.forward")} icon="right" iconOnly variant="ghost" size="sm" disabled={!position.canForward} onClick={stepForward} />
            </div>
          ) : null}
          {session.lastChange ? (
            <div className="flex items-center gap-3 text-meta text-ink" role="status" data-role="one-change">
              <span>{words.change(session.lastChange)}</span>
              {session.canUndo ? <Button label={t("change.undo")} variant="link" size="sm" onClick={session.undo} /> : null}
            </div>
          ) : null}
          <form className="flex items-center gap-2" onSubmit={onSubmit} data-role="one-composer">
            <TextField label={t("composer.label")} placeholder={t("composer.placeholder")} value={draft} onChange={setDraft} className="flex-1" />
            {session.pending ? (
              <Button label={t("composer.stop")} variant="secondary" onClick={session.stop} />
            ) : (
              <Button label={t("composer.send")} variant="primary" type="submit" disabled={!draft.trim()} />
            )}
          </form>
          {session.pending ? (
            <p className="text-meta text-steel" role="status">
              {t("composer.working")}
            </p>
          ) : null}
        </div>
      </section>

      <section className="flex min-h-0 min-w-0 flex-col gap-4" aria-label={t("meta.regionLabel")} data-role="one-region">
        {panels.length === 0 ? <p className="text-body text-steel">{t("meta.regionEmpty")}</p> : null}
        {panels.map((p, i) =>
          i === 0
            ? renderPanel(p, { look: "table", className: "min-h-0 flex-1" })
            : renderPanel(p, { look: "summary", className: "shrink-0", onExpand: () => session.focus(p.id) })
        )}
      </section>
    </div>
  );
}
