import type { ReactNode, Ref } from "react";
import "./scene.css";

/**
 * @catalog The lit ground under a scene's figure: a soft radial glow of the amber dial token behind it (fainter in Spark Dark), so the one figure a reader should look at is lit rather than boxed; its children rise above the glow.
 *
 * A plane, not a panel (surface doctrine 2): no border, no radius, no shadow. The glow reaches a
 * little past the element (it is drawn on `::before` at -8% / -14%), so leave it room.
 */
export function LitGround({ children, className, ref }: { children: ReactNode; className?: string; ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={className ? `k-lit ${className}` : "k-lit"}>
      {children}
    </div>
  );
}
