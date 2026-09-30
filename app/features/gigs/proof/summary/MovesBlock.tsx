"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, KitIcon, Mark } from "@/app/_components/kit";
import type { Gig, GigProposal } from "@/app/_lib/gigs/types";
import type { ReportSection } from "../../logic/report";
import type { GigFileState } from "../report/useGigFile";
import { useMoveGroups, type MoveItem } from "./moveGroups";
import type { SummaryKit } from "./useSummaryKit";

// The ONE action place of the Summary, at the top of the sticky decision sidebar, kept short so
// the gig's metadata under it is on the first screen too:
//   - the gig's next move (logic/moves.ts) as the ONE primary, full width, with its reason in one
//     line under it; when the next move is the sign-off's (a New listing's Accept) or a write is
//     in flight, a line says so instead (and, with no brief yet, that everything starts there);
//   - each state that is present (Writing, a failed write and why, the proposal's basis note) as
//     one quiet line, its object named;
//   - every other move in a disclosure ("N more moves"), grouped by object with a small label.
//     It opens on a click, never on hover; it starts open when it holds two moves or fewer, and
//     remembers the operator's last choice for the session.

let moreOpen: boolean | null = null; // the operator's last choice, kept while the tab lives

function Item({ item, primary }: { item: MoveItem; primary: boolean }) {
  const cls = primary ? "sm-full" : "";
  if (item.href) {
    return (
      <a className={`k-btn k-btn--${primary ? "primary" : "secondary k-btn--sm"} ${cls}`} href={item.href} target={item.download ? undefined : "_blank"} rel="noopener noreferrer" download={item.download || undefined}>
        {item.icon ? <KitIcon name={item.icon} /> : null}
        {item.label}
      </a>
    );
  }
  return <Button className={cls || undefined} label={item.label} tip={item.tip} variant={primary ? "primary" : "secondary"} size={primary ? "md" : "sm"} loading={item.loading} loadingLabel={item.loadingLabel} disabled={item.disabled} onClick={item.onClick} />;
}

export function MovesBlock({ gig, kit, proposalFile, onGo }: { gig: Gig; kit: SummaryKit; proposalFile: GigFileState<GigProposal>; onGo: (s: ReportSection) => void }) {
  const t = useTranslations("gigs.moves");
  const groups = useMoveGroups(gig, kit, proposalFile, onGo);
  const lead = kit.next ? (groups.flatMap((g) => g.items).find((i) => i.move === kit.next) ?? null) : null;
  const others = groups.map((g) => ({ ...g, items: g.items.filter((i) => i !== lead) })).filter((g) => g.items.length > 0);
  const count = others.reduce((n, g) => n + g.items.length, 0);
  const states = groups.flatMap((g) => g.states.map((s, i) => ({ ...s, key: `${g.key}-${i}`, object: g.title })));
  const [open, setOpen] = useState(() => moreOpen ?? count <= 2);

  return (
    <section className="sm-moves" aria-label={t("label")}>
      {lead ? (
        <div className="sm-next">
          <Item item={lead} primary />
          <p className="sm-why">{t(`why.${lead.move ?? "research"}`)}</p>
        </div>
      ) : (
        <p className="sm-why">{kit.facts.untriaged ? t("signoffFirst") : t("none")}</p>
      )}
      {kit.research.brief === null && !kit.facts.untriaged ? <p className="sm-why">{t("afterResearch")}</p> : null}
      {states.map((s) => (
        <p key={s.key} className={`sm-state is-${s.tone}`} role={s.tone === "fail" ? "alert" : s.tone === "writing" ? "status" : undefined}>
          {s.tone === "writing" ? <Mark kind="wait" /> : null}
          <span>
            <b>{s.object}</b> · {s.text}
          </span>
        </p>
      ))}
      {count ? (
        <details
          className="sm-others"
          open={open}
          onToggle={(e) => {
            // Only a click is the operator's choice: the first render's `open` toggles too.
            const now = e.currentTarget.open;
            if (now === open) return;
            moreOpen = now;
            setOpen(now);
          }}
        >
          <summary>{t("more", { count })}</summary>
          {others.map((g) => (
            <div key={g.key} className="sm-group" role="group" aria-label={g.title}>
              <span className="sm-group-k">{g.title}</span>
              {g.items.map((i) => (
                <Item key={i.key} item={i} primary={false} />
              ))}
            </div>
          ))}
        </details>
      ) : null}
    </section>
  );
}
