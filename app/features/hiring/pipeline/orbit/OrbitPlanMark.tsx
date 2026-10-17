import { OrbitMark } from "./OrbitMarks";

/**
 * A stage's plan mark in the ring key: the executor the hiring plan assigns it and, when the plan
 * stops the stage for a human, the "human gate" stop marker. Labels arrive translated so the
 * markup stays provider-free.
 */
export function OrbitPlanMark({ executor, gate }: { executor: string | null; gate: string | null }) {
  if (!executor && !gate) return null;
  return (
    <span className="ob-plan">
      {executor ? <span className="ob-plan__x" data-plan="executor">{executor}</span> : null}
      {gate ? (
        <span className="ob-plan__gate" data-plan="human-gate">
          <OrbitMark kind="needs" />
          {gate}
        </span>
      ) : null}
    </span>
  );
}
