// Which view the Split layout puts where — pure, so the rule is pinned by a test.
//
//   primary  the view that answers the question: the one in front (`focusId`), else the
//            newest unpinned one, else the newest. Its SUMMARY is the main column's sticker
//            and its TABLE opens the side.
//   tabs     every view on screen, primary first, then the pinned ones, then the rest in
//            screen order. The side shows one of them at a time; picking a tab is LOCAL —
//            it never focuses a panel in the session, so the main column never re-forms.
import type { PanelInstance } from "../../types";

export function primaryOf(
  panels: readonly PanelInstance[],
  focusId: string | null,
): PanelInstance | null {
  if (panels.length === 0) return null;
  const front = focusId ? panels.find((p) => p.id === focusId) : undefined;
  if (front) return front;
  const unpinned = panels.filter((p) => !p.pinned);
  return unpinned.at(-1) ?? panels.at(-1) ?? null;
}

export function tabsOf(
  panels: readonly PanelInstance[],
  primary: PanelInstance | null,
): PanelInstance[] {
  if (!primary) return [...panels];
  const rest = panels.filter((p) => p.id !== primary.id);
  return [
    primary,
    ...rest.filter((p) => p.pinned),
    ...rest.filter((p) => !p.pinned),
  ];
}

/** The tab on the side: the user's pick while it is still on screen, else the primary. */
export function sideOf(
  tabs: readonly PanelInstance[],
  picked: string | null,
): PanelInstance | null {
  return tabs.find((p) => p.id === picked) ?? tabs[0] ?? null;
}
