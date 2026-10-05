import { forwardRef, type ButtonHTMLAttributes } from "react";
import "./scene.css";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">;

/**
 * @catalog A piece of drawn scene furniture you press (a building, a folded figure, a step dot, a pinned note, a name set as the card's title): a real button with a zero-specificity reset and the kit's focus ring; the drawing inside it and its paint (a class on the caller's token-only sheet) are the caller's.
 *
 * Reach for it only when the press IS the drawing. A labelled action is a kit `Button` (its height
 * is its `size`), a toggle is a `ChipButton`. The reset and the ring sit under `:where()`, so the
 * caller's own class always wins (a building that rings its plate instead of itself, say).
 */
export const ScenePress = forwardRef<HTMLButtonElement, Props>(function ScenePress({ className, ...rest }, ref) {
  return <button ref={ref} type="button" className={className ? `k-press ${className}` : "k-press"} {...rest} />;
});
