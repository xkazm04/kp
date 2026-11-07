// Where each view on screen lands in the Spotlight layout — pure, so the rule is tested
// without a DOM (stage.test.ts).
//
//   hero    the ONE view drawn large on the stage: the view the user brought forward if it
//           is not pinned, else the newest unpinned view (the one the answer just opened).
//   beside  the other unpinned views, newest first, drawn as summaries beside the hero.
//   pinned  pinned views live in the standing side column, never on the stage, so a pin
//           reads as "keep this beside me while the answers change".
import type { PanelInstance } from "../../types";

export type StagePlan = {
  hero: PanelInstance | null;
  beside: PanelInstance[];
  pinned: PanelInstance[];
};

export function arrangeStage(panels: readonly PanelInstance[], focusId: string | null): StagePlan {
  const pinned = panels.filter((p) => p.pinned);
  const loose = panels.filter((p) => !p.pinned);
  const hero = loose.find((p) => p.id === focusId) ?? loose.at(-1) ?? null;
  const beside = loose.filter((p) => p !== hero).reverse();
  return { hero, beside, pinned };
}
