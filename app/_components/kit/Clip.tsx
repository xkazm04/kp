import "./kit.css";

/**
 * @catalog One line of text that never wraps: an ellipsis when its track is too narrow, the full text as its tip (focusable), so an ellipsis never hides anything.
 */
export function Clip({ text }: { text: string }) {
  return (
    <span className="k-clip" data-tip={text} tabIndex={0} data-role="kit-clip">
      {text}
    </span>
  );
}
