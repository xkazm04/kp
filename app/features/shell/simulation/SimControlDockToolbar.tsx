"use client";

// LAYER 1 of the two-layer control dock — one compact icon row that is the only
// way into a layer-2 panel. Three of its four controls TOGGLE a panel (guided
// demo, operations, command); "Ask Candi" is the odd one out on purpose: it is an
// action that raises the companion dock, so it closes whatever panel is open
// rather than becoming one.
//
// Keyboard: a WAI-ARIA toolbar — one tab stop, arrows/Home/End rove focus along
// the row, Enter/Space activates. Focus moves, activation does not follow it (see
// nextToolbarIndex): half this row fires side effects, and an arrow key must not
// run one.
import { useRef, useState, type KeyboardEvent } from "react";
import { MessagesSquare, Sparkles, SlidersHorizontal, Terminal, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { CandiSwitch } from "./SimControlDockTiles";
import { dockToolbarBtn } from "./simControlDockStyles";
import { nextToolbarIndex, type DockPanelId } from "./simControlDockLayers";

/** Stable ids: exactly one dock mounts per document (SimBar in Workspace), so the
 *  button ↔ region association needs no useId plumbing across the two files. */
export const DOCK_PANEL_DOM_ID = "sim-dock-layer2";
export const dockTabDomId = (id: DockPanelId): string => `sim-dock-tab-${id}`;

export function SimControlDockToolbar({
  mode,
  panel,
  aiBusy,
  awaiting,
  openDecisions,
  onSelectPanel,
  onAskCandi,
  companionOpen,
  onCollapse,
}: {
  mode: "sim" | "ops";
  panel: DockPanelId | null;
  aiBusy: boolean;
  awaiting: number;
  openDecisions: () => void;
  onSelectPanel: (id: DockPanelId) => void;
  /** Null on the deep-link pages, which render no companion dock — the control is
   *  then omitted rather than rendered as a button that does nothing. */
  onAskCandi: (() => void) | null;
  companionOpen: boolean;
  onCollapse: () => void;
}) {
  const t = useTranslations("pipeline.controlCenter");
  // Candi's own copy lives in the `companion` namespace, beside the dock she opens.
  const tc = useTranslations("companion");

  const panels: { id: DockPanelId; icon: LucideIcon; label: string }[] = [
    { id: "sim", icon: Sparkles, label: t("guidedDemo") },
    { id: "ops", icon: SlidersHorizontal, label: t("operations") },
    { id: "command", icon: Terminal, label: t("commandInput") },
  ];
  const count = panels.length + (onAskCandi ? 1 : 0);

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
      <CandiSwitch open onClick={onCollapse} busy={aiBusy} />
      <div className="hidden flex-col leading-tight lg:flex">
        <span className="text-meta font-semibold uppercase tracking-wide text-coral">{t("title")}</span>
        <span className="text-sm font-medium text-steel">{mode === "sim" ? t("guidedDemo") : t("operations")}</span>
      </div>
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
        {panels.map((item, index) => {
          const on = panel === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              id={dockTabDomId(item.id)}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              tabIndex={index === tabStop ? 0 : -1}
              onClick={() => {
                setFocusIndex(index);
                onSelectPanel(item.id);
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
              aria-expanded={on}
              // Only while it exists — a dangling aria-controls is worse than none.
              aria-controls={on ? DOCK_PANEL_DOM_ID : undefined}
              title={item.label}
              className={dockToolbarBtn(on)}
            >
              <Icon size={16} aria-hidden />
              {/* Icon-only below `sm` — the row is the space-efficient layer, and
                  the accessible name survives in `title` + the visually-hidden span. */}
              <span className="hidden sm:inline">{item.label}</span>
              <span className="sr-only sm:hidden">{item.label}</span>
            </button>
          );
        })}
        {onAskCandi ? (
          <button
            ref={(el) => {
              refs.current[panels.length] = el;
            }}
            type="button"
            tabIndex={panels.length === tabStop ? 0 : -1}
            onClick={() => {
              setFocusIndex(panels.length);
              onAskCandi();
            }}
            onKeyDown={(event) => onKeyDown(event, panels.length)}
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
