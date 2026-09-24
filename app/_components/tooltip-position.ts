export type TooltipSide = "top" | "bottom" | "left" | "right";

type Rect = { top: number; right: number; bottom: number; left: number };
type Size = { width: number; height: number };

/** Place a body-portaled label beside its trigger and keep it inside the viewport. */
export function tooltipPosition(trigger: Rect, tip: Size, side: TooltipSide, viewport: Size): { left: number; top: number } {
  const gap = 6;
  const margin = 8;
  let left = (trigger.left + trigger.right - tip.width) / 2;
  let top = trigger.top - tip.height - gap;
  if (side === "bottom") top = trigger.bottom + gap;
  if (side === "left") {
    left = trigger.left - tip.width - gap;
    top = (trigger.top + trigger.bottom - tip.height) / 2;
  }
  if (side === "right") {
    left = trigger.right + gap;
    top = (trigger.top + trigger.bottom - tip.height) / 2;
  }
  return {
    left: Math.max(margin, Math.min(left, viewport.width - tip.width - margin)),
    top: Math.max(margin, Math.min(top, viewport.height - tip.height - margin)),
  };
}
