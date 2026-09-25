import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import "./kit.css";

/**
 * @catalog The measure: the ONE grid template (mark | name | meta | fig | time | act) every row-shaped part sets itself on. Internal: parts own it, callers never pass columns.
 */
export function Measure({
  className, children, style, ...rest
}: HTMLAttributes<HTMLDivElement> & { className?: string; children?: ReactNode; style?: CSSProperties }) {
  return (
    <div className={`k-measure${className ? ` ${className}` : ""}`} style={style} {...rest}>
      {children}
    </div>
  );
}
