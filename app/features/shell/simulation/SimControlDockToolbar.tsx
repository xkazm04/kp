"use client";

// LAYER 1 of the two-layer control dock — one compact icon row that is the only
// way into a layer-2 panel from INSIDE the panel's border. Three of its four
// controls always TOGGLE a panel (automations, command, schedule); the fourth,
// Candi, is whichever of the two the interface mode makes her (`candiControl`):
//
//   voice  → a PANEL toggle like the other three. Her answer is a strip at the
//            top of the screen and typing to her is this dock's `candi` panel,
//            so she is one of the console's surfaces and the exclusivity rule
//            covers her: opening Automations closes her, and the reverse.
//   dock   → the round-3 ACTION. It raises the left companion WINDOW, which is
//            the competing surface, so it empties the slot instead of filling it.
//   absent → no companion in this tree (the deep-link pages). The member is not
//            rendered at all, so the row never carries a dead button.
//
// Round 3 moved two things OUT of this row, into the footer beside the panel:
// the identity block (logo + "Control center" + the mode subtitle) now sits
// outside the left border and the guided demo's ONE entry point outside the
// right — see SimControlDockRail.tsx. What stayed is the "N need you" route:
// it is live operational state, not identity, and it has to be one click from
// every panel, so it belongs with the controls rather than with the brand.
//
// Keyboard: a WAI-ARIA toolbar — one tab stop, arrows/Home/End rove focus along
// the row, Enter/Space activates. Focus moves, activation does not follow it (see
// nextToolbarIndex): half this row fires side effects, and an arrow key must not
// run one. The guide button outside the border is NOT a member — it is across a
// visual gap and outside the box, so it owns its own tab stop.
import { useRef, useState, type KeyboardEvent } from "react";
import { Clock, MessagesSquare, SlidersHorizontal, Terminal, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { dockToolbarBtn } from "./simControlDockStyles";
import {
  CANDI_TOOLBAR_INDEX,
  DOCK_PANEL_DOM_ID,
  DOCK_TOOLBAR_PANEL_IDS,
  dockTabDomId,
  nextToolbarIndex,
  toolbarMemberCount,
  type CandiControl,
  type DockPanelId,
} from "./simControlDockLayers";

const TOOLBAR_ICON: Record<(typeof DOCK_TOOLBAR_PANEL_IDS)[number], LucideIcon> = {
  ops: SlidersHorizontal,
  command: Terminal,
  schedule: Clock,
};

export function SimControlDockToolbar({
  panel,
  awaiting,
  openDecisions,
  onSelectPanel,
  onAskCandi,
  candi,
  companionOpen,
}: {
  panel: DockPanelId | null;
  awaiting: number;
  openDecisions: () => void;
  onSelectPanel: (id: DockPanelId) => void;
  /** Non-null only when `candi === "action"` — the window mode's raise. */
  onAskCandi: (() => void) | null;
  /** What her control IS this render: a panel toggle, an action, or nothing. */
  candi: CandiControl;
  companionOpen: boolean;
}) {
  const t = useTranslations("pipeline.controlCenter");
  // Candi's own copy lives in the `companion` namespace, beside the dock she opens.
  const tc = useTranslations("companion");

  // `operations` keeps its key and changed its VALUE to "Automations" — the row
  // names what the panel does, and the key name is a stable identifier.
  const label: Record<(typeof DOCK_TOOLBAR_PANEL_IDS)[number], string> = {
    ops: t("operations"),
    command: t("commandInput"),
    schedule: t("schedule"),
  };
  // Her member is the only conditional one and it is LAST, so its presence never
  // renumbers the three fixed panels under an index the operator is standing on.
  const count = toolbarMemberCount(candi);
  const candiOn = candi === "panel" ? panel === "candi" : companionOpen;

  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const tabStop = Math.min(focusIndex, count - 1);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextToolbarIndex(index, event.key, count);
    if (next === null) return;
    event.preventDefault();
    setFocusIndex(next);
    refs.current[next]?.focus();
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {/* The awaiting-a-human-decision route, promoted out of the ops face so it
          stays reachable in one click from EVERY layer-1 selection. */}
      {awaiting > 0 ? (
        <button
          type="button"
          onClick={openDecisions}
          title={t("openDecisions")}
          className="focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-coral/40 bg-coral/5 px-2.5 text-sm font-semibold text-coral transition-colors hover:bg-coral/10"
        >
          <span className="grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-coral px-1 text-meta font-bold text-white nums">
            {awaiting > 99 ? t("countOverflow") : awaiting}
          </span>
          {t("needYou")}
        </button>
      ) : null}
      <div role="toolbar" aria-label={t("toolbarLabel")} aria-orientation="horizontal" className="ml-auto flex flex-wrap items-center gap-2">
        {DOCK_TOOLBAR_PANEL_IDS.map((id, index) => {
          const on = panel === id;
          const Icon = TOOLBAR_ICON[id];
          return (
            <button
              key={id}
              id={dockTabDomId(id)}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              tabIndex={index === tabStop ? 0 : -1}
              onClick={() => {
                setFocusIndex(index);
                onSelectPanel(id);
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
              aria-expanded={on}
              // Only while it exists — a dangling aria-controls is worse than none.
              aria-controls={on ? DOCK_PANEL_DOM_ID : undefined}
              title={label[id]}
              className={dockToolbarBtn(on)}
            >
              <Icon size={16} aria-hidden />
              {/* Icon-only below `sm` — the row is the space-efficient layer, and
                  the accessible name survives in `title` + the visually-hidden span. */}
              <span className="hidden sm:inline">{label[id]}</span>
              <span className="sr-only sm:hidden">{label[id]}</span>
            </button>
          );
        })}
        {candi !== "absent" ? (
          <button
            // A panel toggle carries the id its region points back at; an action
            // has no region to label, and a dangling `aria-labelledby` target is
            // worse than none.
            id={candi === "panel" ? dockTabDomId("candi") : undefined}
            ref={(el) => {
              refs.current[CANDI_TOOLBAR_INDEX] = el;
            }}
            type="button"
            tabIndex={CANDI_TOOLBAR_INDEX === tabStop ? 0 : -1}
            onClick={() => {
              setFocusIndex(CANDI_TOOLBAR_INDEX);
              if (candi === "panel") onSelectPanel("candi");
              else onAskCandi?.();
            }}
            onKeyDown={(event) => onKeyDown(event, CANDI_TOOLBAR_INDEX)}
            // The two states are announced with the two different words for what
            // they are: a panel EXPANDS in place, a window is PRESSED into view.
            aria-expanded={candi === "panel" ? candiOn : undefined}
            aria-controls={candi === "panel" && candiOn ? DOCK_PANEL_DOM_ID : undefined}
            aria-pressed={candi === "action" ? companionOpen : undefined}
            title={tc("dock.askCandi")}
            className={dockToolbarBtn(candiOn)}
          >
            <MessagesSquare size={16} aria-hidden />
            <span className="hidden sm:inline">{tc("dock.askCandi")}</span>
            <span className="sr-only sm:hidden">{tc("dock.askCandi")}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
