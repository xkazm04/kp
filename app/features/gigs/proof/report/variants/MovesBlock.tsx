"use client";

import { useTranslations } from "next-intl";
import { Button, KitIcon, Mark } from "@/app/_components/kit";
import type { Gig, GigProposal } from "@/app/_lib/gigs/types";
import type { ReportSection } from "../../../logic/report";
import type { GigFileState } from "../useGigFile";
import { useMoveGroups, type MoveGroup, type MoveItem } from "./moveGroups";
import type { SummaryKit } from "./useSummaryKit";

// The ONE action place of the Summary prototypes: every move the Summary offers, at the top of
// the sticky decision sidebar, grouped by object (moveGroups.ts), exactly one of them primary.
//   look "card"  (Dossier)   - a calm list: each group a caps label, its moves in a wrapping
//                              row, its state as a quiet line under them;
//   look "panel" (Workbench) - a control panel: the next move pinned on top as a full-width
//                              button with its object named, then the groups as a vertical
//                              stack of full-width secondary buttons, the states beside them.
// When the next move belongs to the sign-off (Approve, Dispatch), no button here is primary and
// a line says so.

function Item({ item, primary, full }: { item: MoveItem; primary: boolean; full: boolean }) {
  const cls = `${full ? "sm-full " : ""}`;
  if (item.href) {
    return (
      <a className={`${cls}k-btn k-btn--${primary ? "primary" : "secondary"}`} href={item.href} target={item.download ? undefined : "_blank"} rel="noopener noreferrer" download={item.download || undefined}>
        {item.icon ? <KitIcon name={item.icon} /> : null}
        {item.label}
      </a>
    );
  }
  return <Button className={cls.trim() || undefined} label={item.label} tip={item.tip} variant={primary ? "primary" : "secondary"} loading={item.loading} loadingLabel={item.loadingLabel} disabled={item.disabled} onClick={item.onClick} />;
}

function States({ group }: { group: MoveGroup }) {
  return (
    <>
      {group.states.map((s, i) =>
        s.tone === "fail" ? (
          <p key={i} role="alert" className="sm-state is-fail">
            {s.text}
          </p>
        ) : (
          <p key={i} className={`sm-state${s.tone === "writing" ? " is-writing" : ""}`} role={s.tone === "writing" ? "status" : undefined}>
            {s.tone === "writing" ? <Mark kind="wait" /> : null}
            {s.text}
          </p>
        )
      )}
    </>
  );
}

export function MovesBlock({ gig, kit, proposalFile, onGo, look }: { gig: Gig; kit: SummaryKit; proposalFile: GigFileState<GigProposal>; onGo: (s: ReportSection) => void; look: "card" | "panel" }) {
  const t = useTranslations("gigs.moves");
  const groups = useMoveGroups(gig, kit, proposalFile, onGo);
  const isNext = (i: MoveItem) => !!i.move && i.move === kit.next;
  const lead = groups.flatMap((g) => g.items.filter(isNext).map((item) => ({ item, group: g })))[0] ?? null;

  if (look === "panel") {
    return (
      <section className="sm-moves sm-moves--panel" aria-label={t("label")}>
        <p className="caps dim">{t("title")}</p>
        {lead ? (
          <div className="sm-next">
            <p className="sm-next-k">{t("nextOn", { object: lead.group.title })}</p>
            <Item item={lead.item} primary full />
          </div>
        ) : (
          <p className="sm-state">{t("none")}</p>
        )}
        {groups.map((g) => (
          <div key={g.key} className="sm-group" role="group" aria-label={g.title}>
            <p className="sm-group-k">{g.title}</p>
            {g.items.filter((i) => i !== lead?.item).map((i) => (
              <Item key={i.key} item={i} primary={false} full />
            ))}
            <States group={g} />
          </div>
        ))}
      </section>
    );
  }

  return (
    <section className="sm-moves sm-moves--card" aria-label={t("label")}>
      <p className="caps dim">{t("title")}</p>
      {lead ? null : <p className="sm-state">{t("none")}</p>}
      {groups.map((g) => (
        <div key={g.key} className={`sm-group${lead?.group === g ? " is-next" : ""}`} role="group" aria-label={g.title}>
          <p className="sm-group-k">
            {g.title}
            {lead?.group === g ? <span className="sm-next-tag">{t("next")}</span> : null}
          </p>
          <div className="sm-row">
            {g.items.map((i) => (
              <Item key={i.key} item={i} primary={isNext(i)} full={false} />
            ))}
          </div>
          <States group={g} />
        </div>
      ))}
    </section>
  );
}
