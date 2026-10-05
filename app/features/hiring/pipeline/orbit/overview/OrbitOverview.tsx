"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import { HandNote, LitGround } from "@/app/_components/kit/scene";
import { NO_LIT, firstUp, litNow, litStep, urgentFirst, type LitSlots, type LitVia } from "./overviewModel";
import { useDialGeo, useDialSize, type LitSet, type OverviewProps, type QueueView } from "./overviewParts";
import { OverviewDial, type OverviewDialHandle } from "./OverviewDial";
import { OverviewHead } from "./OverviewHead";
import { OverviewQueue } from "./OverviewQueue";
import { OverviewFirstUp } from "./OverviewFirstUp";
import { OverviewTotals } from "./OverviewTotals";
import { OverviewWires } from "./OverviewWires";
import "./orbitOverview.css";

/** The ring key wraps as whole items: a name never splits, and the dot stays with the name before it. */
const NBSP = String.fromCharCode(160);

/*
 * The Overview: the level ABOVE the orbit ("The Orbit, Lit", the /contest orbit-overview winner B/1,
 * 2026-09-30; it replaced the /prototype "Core"). One screen: the waiting count as the hero with what
 * it is made of; "needs you, start here" (First up and the queues waiting on you) and "in motion
 * today" (the rest) on either side of the orbit folded small, each queue wired to the ring its people
 * stand on; the totals under it. Pointing at a queue lights exactly its people (breathing halos,
 * threads from its wire); a click opens the orbit with them still lit: the same dots fly to their
 * full-size places (OrbitStage's "grow" arrival).
 */
export function OrbitOverview(p: OverviewProps) {
  const { model, groups, axis, words, queues } = p;
  const { t, n } = words;
  const tl = useTranslations("overviewLit");
  const [now] = useState(() => Date.now());
  const scene = useRef<HTMLDivElement>(null);
  const mid = useRef<HTMLDivElement>(null);
  const note = useRef<HTMLParagraphElement>(null);
  const dial = useRef<OverviewDialHandle>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  // Two slots (pointer, focus): the pointer wins while it points, leaving falls back to the focused card.
  const [slots, setSlots] = useState<LitSlots<LitSet>>(NO_LIT);
  const hot = litNow(slots);

  const size = useDialSize(mid);
  const counts = useMemo(() => model.total.st.map((x) => n(x.n)), [model, n]);
  const geo = useDialGeo(groups, model, axis.length, size, counts);
  const first = useMemo(() => firstUp(model.people, p.sla, now), [model, p.sla, now]);
  const waiting = useMemo<LitSet>(() => {
    const people = model.people.filter((x) => x.waiting);
    return { key: "__waiting", label: t("waitingOnHuman", { count: people.length }), ids: new Set(people.map((x) => x.id)), entries: urgentFirst(people.map((x) => x.entry), model), needs: true };
  }, [model, t]);

  const litOf = (q: QueueView): LitSet => ({ key: q.key, label: q.label, ids: q.ids, entries: q.people, needs: q.needs });
  const expand = (lit: LitSet | null, stage: string | null = null) => p.onExpand(dial.current?.snapshot() ?? null, { stage, lit });
  const door = (q: QueueView) => (q.stage ? expand(null, q.stage) : p.onOpenTab(q));
  const light = (set: LitSet) => (on: boolean, via: LitVia = "pointer") => setSlots((cur) => litStep(cur, via, set, on));

  const card = (q: QueueView) => (
    <li key={q.key}>
      <OverviewQueue
        q={q}
        words={words}
        hot={hot?.key === q.key}
        onHot={light(litOf(q))}
        onOpen={() => expand(litOf(q), q.stage)}
        onDoor={() => door(q)}
        onPerson={p.onPerson}
        cardRef={(el) => { if (el) cards.current.set(q.key, el); else cards.current.delete(q.key); }}
      />
    </li>
  );
  const needs = queues.filter((q) => q.needs);
  const motion = queues.filter((q) => !q.needs);
  const hotQueue = hot && queues.some((q) => q.key === hot.key) ? hot.key : null;
  const hotRing = hotQueue ? queues.find((q) => q.key === hotQueue)?.si ?? null : null;
  const fp = first.state === "ok" ? first.person : null;

  return (
    <section className="ov" aria-label={t("ovAria")} data-role="orbit-overview">
      <OverviewHead model={model} words={words} onHot={light(waiting)} onOpen={() => expand(waiting)} />
      <div ref={scene} className="ov-scene">
        <div className="ov-col ov-col--needs">
          <HandNote>{tl("needsHand")}</HandNote>
          <OverviewFirstUp
            first={first}
            axis={axis}
            words={words}
            onHot={fp ? light({ key: `p:${fp.id}`, label: fp.name, ids: new Set([fp.id]), entries: [fp.entry], needs: true }) : () => undefined}
            onPerson={(x) => p.onPerson(x.entry, [x.entry])}
          />
          {needs.length ? <ul className="ov-list" aria-label={tl("needsAria")}>{needs.map(card)}</ul> : null}
          {model.total.wait > 0 ? <HandNote pointer noteRef={note} className="ov-note">{tl("haloNote")}</HandNote> : null}
        </div>
        <LitGround ref={mid} className="ov-mid">
          {geo ? (
            <OverviewDial
              ref={dial}
              geo={geo}
              ringLabels={counts}
              focus={hot?.ids ?? null}
              needs={hot?.needs ?? true}
              hotRing={hotRing}
              label={t("ovCoreAria", { people: model.total.act, stages: axis.length })}
              onOpen={() => expand(null)}
            />
          ) : null}
          <Button label={t("ovOpen")} variant="link" size="sm" onClick={() => expand(null)} />
          <p className="ov-legend">
            <span>{t("ovRingsLegend", { stages: axis.map((s) => words.stage(s.id).replace(/ /g, NBSP)).join(`${NBSP}· `) })}</span>
            <span>{tl("slotNote")}</span>
          </p>
        </LitGround>
        <div className="ov-col ov-col--motion">
          <HandNote>{tl("motionHand")}</HandNote>
          {motion.length ? <ul className="ov-list" aria-label={tl("motionAria")}>{motion.map(card)}</ul> : null}
        </div>
        {geo ? <OverviewWires scene={scene} dial={dial} cards={cards} note={note} queues={queues} geo={geo} hot={hotQueue} /> : null}
      </div>
      {queues.length === 0 ? <p className="ob-note ov-center">{t("ovNothingToday")}</p> : null}
      <OverviewTotals model={model} words={words} jobsOk={p.jobsOk} />
    </section>
  );
}
