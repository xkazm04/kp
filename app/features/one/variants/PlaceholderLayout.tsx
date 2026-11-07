"use client";

// The PLAIN round-1 placeholder every direction starts from: it exercises the whole core
// (greeting, composer + chips, the "what changed" line with Undo, Stop while a change is
// pending, the region of ≤ 3 views, consent cards) with no visual opinion. A variant
// builder replaces `./<id>/<Id>Variant.tsx`; this file stays as the reference wiring.
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, ChipRow, TextField } from "@/app/_components/kit";
import { consoleHref } from "../panels/PanelShell";
import type { ChipId } from "../types";
import type { VariantProps } from "../variantProps";

export function PlaceholderLayout({ variant, session, submit, greeting, renderPanel, renderConsent, words }: VariantProps) {
  const t = useTranslations("one.core");
  const [draft, setDraft] = useState("");
  const g = words.greeting(greeting);
  const chipsFor = (ids: readonly ChipId[]) => ids.map((id) => ({ id, label: words.chip(id), onPress: () => submit({ chip: id }) }));
  const lastOne = [...session.turns].reverse().find((x) => x.who === "one");
  const chips = lastOne && lastOne.who === "one" ? lastOne.chips : greeting.state === "loading" ? [] : greeting.chips;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit({ text: draft });
    setDraft("");
  };
  return (
    <div className="grid gap-6 px-4 pb-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" data-one-layout={variant}>
      <section className="flex flex-col gap-4" aria-label={t("meta.conversationLabel")}>
        <div className="flex flex-col gap-1" data-role="one-greeting">
          <p className="font-serif text-h2 text-ink">{g.status}</p>
          {g.first ? <p className="text-body text-ink">{g.first}</p> : null}
          {greeting.state === "needs" ? (
            <div>
              <Button
                label={t("greeting.show")}
                variant="secondary"
                size="sm"
                onClick={() => session.show(greeting.first.panel, greeting.first.params)}
              />
            </div>
          ) : null}
        </div>

        <ol className="flex flex-col gap-3" data-role="one-turns">
          {session.turns.map((turn) =>
            turn.who === "user" ? (
              <li key={turn.id} className="text-body text-ink" data-who="user">
                <span className="text-meta text-steel">{t("you")}</span> {turn.text ?? (turn.chip ? words.chip(turn.chip) : "")}
              </li>
            ) : (
              <li key={turn.id} className="flex flex-col gap-2 text-body text-ink" data-who="one" data-fallback={turn.fallback || undefined}>
                <p>
                  <span className="text-meta text-steel">{t("one")}</span> {words.say(turn.say)}
                </p>
                {turn.dropped > 0 ? <p className="text-meta text-steel">{words.dropped(turn.dropped)}</p> : null}
                {turn.links.map((l) => (
                  <Link key={l.tab} className="k-btn k-btn--link k-btn--sm" href={consoleHref(l.tab, l.params)}>
                    {t("meta.console")}
                  </Link>
                ))}
                {session.proposals.filter((p) => p.turnId === turn.id).map((p) => renderConsent(p))}
              </li>
            )
          )}
        </ol>

        {session.proposals.filter((p) => p.turnId === null).map((p) => renderConsent(p))}

        {chips.length > 0 ? <ChipRow chips={chipsFor(chips)} /> : null}

        <form className="flex items-center gap-2" onSubmit={onSubmit} data-role="one-composer">
          <TextField label={t("composer.label")} placeholder={t("composer.placeholder")} value={draft} onChange={setDraft} className="flex-1" />
          {session.pending ? (
            <Button label={t("composer.stop")} variant="secondary" onClick={session.stop} />
          ) : (
            <Button label={t("composer.send")} variant="primary" type="submit" disabled={!draft.trim()} />
          )}
        </form>
        {session.pending ? <p className="text-meta text-steel" role="status">{t("composer.working")}</p> : null}
      </section>

      <section className="flex flex-col gap-4" aria-label={t("meta.regionLabel")} data-role="one-region">
        {session.lastChange ? (
          <div className="flex items-center gap-3 text-meta text-ink" role="status" data-role="one-change">
            <span>{words.change(session.lastChange)}</span>
            {session.canUndo ? <Button label={t("change.undo")} variant="link" size="sm" onClick={session.undo} /> : null}
          </div>
        ) : null}
        {session.panels.length === 0 ? <p className="text-body text-steel">{t("meta.regionEmpty")}</p> : null}
        {session.panels.map((p) =>
          renderPanel(p, { look: session.focusId === p.id ? "spotlight" : "default" })
        )}
      </section>
    </div>
  );
}
