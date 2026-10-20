"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import { ConditionMark } from "@/app/_components/kit/scene";
import { KBD } from "@/app/_components/ui/recipes";
import { needsYou as needsEntries, type AgentRosterEntry, type NeedsYouEntry, type NextAction, type NextActionKind } from "./agentsWorkforceLogic";
import { ControlButton, HireNoteView, NeedsMark, type Speak } from "./WorkforceBits";
import { nameOf, needing, type BridgeView, type Drawer, type Moves } from "./workforceModel";

const KBD_CLS = `${KBD} text-micro`;
// Scene parts painted by workforce.css (a queue card is not a recipe button); named so the ratchet reads them as delegated.
const TOP_CLS = "k-queue__top";
const NAME_CLS = "k-queue__name";
const FIRST_NAME_CLS = "first__name";

export type NeedsFilter = { need: NextActionKind | null };

/** The sentence under the numeral: each kind's chip words, joined as the reader's language joins a list. */
function useList() {
  const locale = useLocale();
  return (items: string[]) => new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);
}

/**
 * Level 0's left column, "who needs you": the one numeral and sentence (or the empty state that says its own true
 * thing, or the bridge alarm), then the first-up hire with its ONE control, then a queue card per kind in the
 * product's priority order. A queue's top press filters the wheel to that kind (digits 1-6); its door opens the rack.
 */
export function WorkforceNeeds({ agents, moves, bridge, lastOkAgo, drawers, filter, onFilter, onOpenCard, onShowInRack, onIntegrations, onBrowseRoles, speak, now }: {
  agents: readonly AgentRosterEntry[];
  moves: Moves;
  bridge: BridgeView;
  /** "3 hours ago" for the bridge's last answer, or null. */
  lastOkAgo: string | null;
  drawers: readonly Drawer[];
  filter: NeedsFilter;
  onFilter: (kind: NextActionKind | null) => void;
  onOpenCard: (id: string, kind: NextActionKind, el: HTMLElement) => void;
  onShowInRack: (kind: NextActionKind) => void;
  onIntegrations: () => void;
  onBrowseRoles: () => void;
  speak: Speak;
  now: Date;
}) {
  const t = useTranslations("agentsWorkforce");
  const list = useList();
  const n = agents.length;

  if (n === 0) {
    const never = bridge.state !== "paired";
    return (
      <>
        <div className="hero hero--empty">
          <div className="hero__copy">
            <p className="hero__kicker">
              <ConditionMark
                condition={bridge.condition}
                label={bridge.state === "paired" ? t("wk.bridge.pairedAgo", { when: lastOkAgo ?? "—" }) : bridge.state === "down" ? t("wk.bridge.down") : t("wk.bridge.notPaired")}
              />
            </p>
            <h2 className="hero__title">{never ? t("emptyUnpairedTitle") : t("emptyNoneTitle")}</h2>
            <p className="hero__body">{never ? t("emptyUnpairedBody") : t("emptyNoneBody")}</p>
          </div>
          <div className="hero__act">
            <Button label={never ? t("emptyUnpairedLink") : t("emptyNoneLink")} variant="primary" size="lg" onClick={never ? onIntegrations : onBrowseRoles} />
          </div>
        </div>
        <div className="steps">
          <p className="k-hand">{bridge.state === "paired" ? t("wk.steps.handPaired") : t("wk.steps.handUnpaired")}</p>
          <ol className="steps__list">
            <li className={bridge.state === "paired" ? "is-done" : "is-next"}>
              <span className="steps__n">1</span>
              <span>
                <b>{t("wk.steps.pairTitle")}</b>
                {bridge.state === "paired" ? t("wk.steps.pairDone", { when: lastOkAgo ?? "—" }) : t("wk.steps.pairBody")}
              </span>
            </li>
            <li className={bridge.state === "paired" ? "is-next" : ""}>
              <span className="steps__n">2</span>
              <span><b>{t("wk.steps.dispatchTitle")}</b>{t("wk.steps.dispatchBody")}</span>
            </li>
            <li>
              <span className="steps__n">3</span>
              <span><b>{t("wk.steps.cardTitle")}</b>{t("wk.steps.cardBody")}</span>
            </li>
          </ol>
        </div>
      </>
    );
  }

  const entries: NeedsYouEntry[] = needsEntries(agents, bridge.state === "unknown" ? null : { paired: bridge.state === "paired" }, now);
  const needCount = needing(agents, moves).length;
  const dead = bridge.state === "down";
  const waiting = entries.find((e) => e.kind === "repair_bridge")?.count ?? 0;
  const first = dead ? null : needing(agents, moves)[0] ?? null;

  const hero = dead ? (
    <div className="hero hero--alarm" role="alert">
      <span className="hero__n" data-n={waiting}>{waiting}</span>
      <div className="hero__copy">
        <h2 className="hero__title">{t("wk.hero.bridgeDown", { waiting, total: n })}</h2>
        <p className="hero__body">{t("wk.bridge.downDetail", { when: bridge.lastOkAt ? speak.fmt.dateTime(bridge.lastOkAt) : "—", ago: lastOkAgo ?? "—" })}</p>
      </div>
      <div className="hero__act">
        <Button label={t("nextAction.control.integrations")} variant="primary" size="lg" onClick={onIntegrations} />
        <span className="hero__note">{t("wk.hero.reconnects")}</span>
      </div>
    </div>
  ) : (
    <div className="hero">
      <span className={`hero__n${needCount ? "" : " is-calm"}`} data-n={needCount}>{needCount}</span>
      <div className="hero__copy">
        <h2 className="hero__title" data-level-heading="" tabIndex={-1}>
          {needCount ? t("wk.hero.need", { count: needCount }) : t("wk.hero.nothing")}
          {needCount ? <span className="hero__of"> {t("wk.hero.of", { total: n })}</span> : null}
        </h2>
        <p className="hero__body">
          {needCount
            ? `${list(entries.map((e) => `${speak.words.chip(e.kind, e.count)}${e.kind === "approve_in_personas" && e.soonestHoursLeft != null ? ` (${t("nextAction.soonest", { hours: e.soonestHoursLeft })})` : ""}`))}.${` ${t("wk.hero.eachDiamond")}`}`
            : t("wk.hero.allWhere")}
        </p>
      </div>
    </div>
  );

  return (
    <>
      {hero}
      <p className="k-hand needs-hand">{dead ? t("wk.hand.bridgeFirst") : needCount ? t("wk.hand.start") : t("wk.hand.calm")}</p>
      {first ? <FirstUp agent={first} move={moves.get(first.id) ?? { kind: "none" }} drawers={drawers} speak={speak} onOpen={(el) => onOpenCard(first.id, (moves.get(first.id) ?? { kind: "none" }).kind, el)} /> : null}
      {needCount === 0 ? (
        <div className="calm"><p className="calm__body">{t("wk.calmBody")}</p></div>
      ) : (
        <div className="queues" role="group" aria-label={t("wk.queuesLabel")}>
          {entries.map((q, i) => {
            const people = needing(agents, moves, q.kind);
            const hot = filter.need === q.kind;
            return (
              <div key={q.kind} className={`k-queue q is-needs${hot ? " is-hot" : ""}`} data-q={q.kind}>
                <button type="button" className={TOP_CLS} aria-pressed={hot} aria-keyshortcuts={String(i + 1)} onClick={() => onFilter(hot ? null : q.kind)}>
                  <span className="k-queue__n">{q.count}</span>
                  <span className="k-queue__l">{speak.words.chip(q.kind, q.count).replace(/^\d+\s/, "")}</span>
                  <span className="q__key"><kbd className={KBD_CLS}>{i + 1}</kbd></span>
                </button>
                <p className="k-queue__names">
                  {people.slice(0, 3).map((a) => (
                    <button key={a.id} type="button" className={NAME_CLS} onClick={(e) => onOpenCard(a.id, q.kind, e.currentTarget)}>{nameOf(a)}</button>
                  ))}
                  {people.length > 3 ? <span className="q__more">{t("wk.more", { count: people.length - 3 })}</span> : null}
                </p>
                <div className="k-queue__foot">
                  {q.kind === "check_reporter" ? <span className="k-queue__on">{t("wk.checkedInPersonas")}</span> : null}
                  {q.kind === "approve_in_personas" && q.soonestHoursLeft != null ? <span className="k-queue__on">{t("nextAction.soonest", { hours: q.soonestHoursLeft })}</span> : null}
                  {q.kind === "repair_bridge" ? (
                    <Button label={t("nextAction.control.integrations")} variant="primary" size="sm" onClick={onIntegrations} />
                  ) : (
                    <Button label={t("wk.showInRack", { count: q.count })} variant="link" onClick={() => onShowInRack(q.kind)} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function FirstUp({ agent, move, drawers, speak, onOpen }: {
  agent: AgentRosterEntry;
  move: NextAction;
  drawers: readonly Drawer[];
  speak: Speak;
  onOpen: (el: HTMLElement) => void;
}) {
  const t = useTranslations("agentsWorkforce");
  const drawer = drawers.find((d) => d.agents.some((a) => a.id === agent.id));
  return (
    <article className="first k-queue is-needs" data-id={agent.id}>
      <p className="first__eyebrow"><NeedsMark tone="caution" />{t("wk.firstUp")}</p>
      <button type="button" className={FIRST_NAME_CLS} onClick={(e) => onOpen(e.currentTarget)}>{nameOf(agent)}</button>
      <p className="first__role">{agent.jobTitle}{drawer && speak.words.drawerName(drawer) !== agent.jobTitle ? ` · ${speak.words.drawerName(drawer)}` : ""}</p>
      <p className="first__move"><NeedsMark /><span>{speak.words.moveLine(move)}</span></p>
      <div className="first__acts"><ControlButton agent={agent} move={move} speak={speak} size="md" /></div>
      <HireNoteView id={agent.id} speak={speak} />
    </article>
  );
}
