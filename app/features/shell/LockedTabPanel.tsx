"use client";

// The locked-door panel: where every door into a tab this seat cannot open lands —
// a rail click on a lock row, a g-chord, a ?tab= arrival from a checkout return or
// a shared link (WorkspaceTabChunks renders it through navCapabilities.panelFor).
// It names what the tab needs, says the seat's role lacks it, and lists who in this
// workspace holds it, each with an Ask link carrying the exact deep link.
//
// The states and the mailto builder are pure, in ./lockedDoor.ts.
import { useEffect, useState } from "react";
import { Lock, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Capability } from "@/app/_lib/auth/roles";
import { BTN_SECONDARY, CARD_PAD, EYEBROW, ICON_TILE, INTRO, META_LABEL, PANEL, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { capabilityLabelKey } from "./navCapabilities";
import { askHref, holdersUrl, lockedDoorView, parseHolders, type Holder } from "./lockedDoor";
import { navLabel, NAV_GROUPS, type WorkspaceTabId } from "./tabs";

function tabFallbackLabel(tab: WorkspaceTabId): string {
  for (const g of NAV_GROUPS) for (const it of g.items) if (it.id === tab) return it.label;
  return tab;
}

export function LockedTabPanel({ tab, needs }: { tab: WorkspaceTabId; needs: Capability }) {
  const t = useTranslations("nav");
  const tRole = useTranslations("workspaceAdmin.members.role");
  const [holders, setHolders] = useState<{ needs: Capability; list: Holder[] | "failed" } | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(holdersUrl(needs), { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        const list = parseHolders(body);
        setHolders({ needs, list: list ?? "failed" });
      })
      .catch(() => {
        // An aborted read (the tab changed) sets nothing; any other failure is the
        // stated holdersUnknown state, which still names the capability.
        if (!ctrl.signal.aborted) setHolders({ needs, list: "failed" });
      });
    return () => ctrl.abort();
  }, [needs]);

  const tabName = navLabel(t, `tabs.${tab}`, tabFallbackLabel(tab));
  const capability = navLabel(t, capabilityLabelKey(needs), needs);
  const view = lockedDoorView({ needs, holders: holders && holders.needs === needs ? holders.list : null });
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const subject = t("lockedDoor.askSubject", { tab: tabName });

  return (
    <section className={`${PANEL} ${CARD_PAD} mx-auto max-w-2xl space-y-5`} aria-labelledby="locked-door-title">
      <div className="flex items-start gap-4">
        <span className={ICON_TILE} aria-hidden>
          <Lock size={20} />
        </span>
        <div className="min-w-0 space-y-2">
          <p className={EYEBROW}>{t("lockedDoor.eyebrow")}</p>
          <h1 id="locked-door-title" className={TITLE_DISPLAY}>
            {t("lockedDoor.title", { tab: tabName, capability })}
          </h1>
          <p className={INTRO}>{t("lockedDoor.body", { tab: tabName, capability })}</p>
        </div>
      </div>

      <div className="space-y-2" aria-live="polite">
        <h2 className={META_LABEL}>{t("lockedDoor.holdersHeading")}</h2>
        {view.kind === "loading" ? <p className="text-base text-steel">{t("lockedDoor.loading")}</p> : null}
        {view.kind === "noHolders" ? <p className="text-base text-steel">{t("lockedDoor.noHolders", { capability })}</p> : null}
        {view.kind === "holdersUnknown" ? (
          <p className="text-base text-steel">{t("lockedDoor.holdersUnknown", { capability })}</p>
        ) : null}
        {view.kind === "holders" ? (
          <ul className="divide-y divide-stone-200">
            {view.holders.map((h, i) => {
              const name = h.name ?? h.email ?? tRole(h.role);
              const href = askHref(h, tab, origin, subject);
              return (
                <li key={`${h.email ?? "holder"}-${i}`} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium text-ink">{name}</p>
                    <p className="truncate text-sm text-steel">{tRole(h.role)}</p>
                  </div>
                  {href ? (
                    <a href={href} className={`${BTN_SECONDARY} h-9 px-3 text-sm`} aria-label={t("lockedDoor.askLabel", { name })}>
                      <Mail size={15} aria-hidden />
                      {t("lockedDoor.ask")}
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
