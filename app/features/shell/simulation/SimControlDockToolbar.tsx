"use client";

// LAYER 1 of the two-layer control dock — one compact icon row that is the only
// way into a layer-2 panel from INSIDE the panel's border. Three of its four
// controls TOGGLE a panel (automations, command, schedule); "Ask Candi" is the
// odd one out on purpose: it is an action that raises the companion dock, so it
// closes whatever panel is open rather than becoming one.
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
  DOCK_PANEL_DOM_ID,
  DOCK_TOOLBAR_PANEL_IDS,
  dockTabDomId,
  nextToolbarIndex,
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
  companionOpen,
}: {
  panel: DockPanelId | null;
  awaiting: number;
  openDecisions: () => void;
  onSelectPanel: (id: DockPanelId) => void;
  /** Null on the deep-link pages, which render no companion dock — the control is
   *  then omitted rather than rendered as a button that does nothing. */
  onAskCandi: (() => void) | null;
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
  const count = DOCK_TOOLBAR_PANEL_IDS.length + (onAskCandi ? 1 : 0);

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
        {onAskCandi ? (
          <button
            ref={(el) => {
              refs.current[DOCK_TOOLBAR_PANEL_IDS.length] = el;
            }}
            type="button"
            tabIndex={DOCK_TOOLBAR_PANEL_IDS.length === tabStop ? 0 : -1}
            onClick={() => {
              setFocusIndex(DOCK_TOOLBAR_PANEL_IDS.length);
              onAskCandi();
            }}
            onKeyDown={(event) => onKeyDown(event, DOCK_TOOLBAR_PANEL_IDS.length)}
            aria-pressed={companionOpen}
            title={tc("dock.askCandi")}
            className={dockToolbarBtn(companionOpen)}
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
