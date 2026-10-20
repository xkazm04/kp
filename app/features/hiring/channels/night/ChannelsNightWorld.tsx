import { ChannelsArtEnvelope } from "./art/ChannelsArtPost";
import { BARRIER_T, PILE_T, ROADS, STAGE, cubicAt, roadPath, tangentAt, type RoadId } from "./channelsNightDistrict";
import type { NightCondition } from "./channelsNightPlumbing";

type RoadState = Record<RoadId, NightCondition>;

/** Letters resting on the roads that carry traffic now, at two fixed points each (a still frame:
 *  the district moves only when its state changes). */
const LETTER_T = [0.3, 0.72];

/**
 * The ground the buildings stand on: hills, the roads (each dressed by the condition of the door
 * or plant it serves: dashed when not wired, tinted when failing), the barrier across the relay
 * road (down until a relay is configured), the pile of letters held behind it, and letters resting on
 * the live roads. Decorative: the plates say all of it in words.
 */
export function ChannelsNightWorld({ roads, relayOpen, held }: { roads: RoadState; relayOpen: boolean; held: number }) {
  const barrier = cubicAt(ROADS.relay, BARRIER_T);
  const barrierAngle = tangentAt(ROADS.relay, BARRIER_T) + 90;
  const pile = cubicAt(ROADS.relay, PILE_T);
  const letters = (Object.keys(roads) as RoadId[])
    .filter((id) => roads[id] === "live" && id !== "out")
    .flatMap((id) => LETTER_T.map((t, i) => ({ id, i, at: cubicAt(ROADS[id], t), angle: tangentAt(ROADS[id], t) })));
  return (
    <svg className="cn-world" viewBox={`0 0 ${STAGE.width} ${STAGE.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <path className="cn-hill cn-hill--far" d="M0 452 C160 412 300 482 470 448 S780 402 1000 452 V540 H0Z" />
      <path className="cn-hill cn-hill--near" d="M0 502 C200 478 360 530 560 502 S860 482 1000 508 V540 H0Z" />
      <path className="cn-cloud" d="M700 40 q10 -16 28 -6 q14 -14 30 2 q16 0 16 12 h-78 q-8 0 4 -8z" />
      {(Object.keys(roads) as RoadId[]).map((id) => (
        <g key={id} className="cn-road" data-cond={roads[id]}>
          <path className="cn-road__edge" d={roadPath(ROADS[id])} />
          <path className="cn-road__bed" d={roadPath(ROADS[id])} />
          <path className="cn-road__line" d={roadPath(ROADS[id])} />
        </g>
      ))}
      {held > 0 ? (
        <g className="cn-pile" data-stuck={relayOpen ? undefined : "1"} transform={`translate(${(pile.x - 6).toFixed(1)} ${(pile.y + 50).toFixed(1)})`}>
          {Array.from({ length: Math.min(held, 24) }, (_, i) => {
            const row = Math.floor(i / 6);
            const x = (i % 6) * 13 + (row % 2) * 6 + (((i * 37) % 7) - 3);
            const y = -row * 9 + (((i * 53) % 5) - 2);
            return (
              <g key={i} transform={`translate(${x} ${y}) rotate(${((i * 29) % 21) - 10}) scale(.62)`}>
                <ChannelsArtEnvelope tone={row % 2 ? "paper" : "lime"} />
              </g>
            );
          })}
        </g>
      ) : null}
      <g className="cn-barrier" data-up={relayOpen ? "1" : undefined} transform={`translate(${barrier.x.toFixed(1)} ${barrier.y.toFixed(1)}) rotate(${barrierAngle.toFixed(1)})`}>
        <rect x="-48" y="-11" width="14" height="24" rx="3" className="cn-a-f cn-fc-steel" />
        <rect x="32" y="-11" width="14" height="24" rx="3" className="cn-a-f cn-fc-steel" />
        <g className="cn-barrier__arm">
          <rect x="-38" y="-7" width="72" height="14" rx="3" className="cn-a-f cn-fc-paper" />
          <path d="M-28 -7 l11 14 h-11z M-4 -7 l11 14 h-11z M20 -7 l11 14 h-11z" className="cn-fc-coral" />
        </g>
      </g>
      {letters.map((l) => (
        <g
          key={`${l.id}-${l.i}`}
          className="cn-letter"
          transform={`translate(${l.at.x.toFixed(1)} ${l.at.y.toFixed(1)}) rotate(${(Math.abs(l.angle) > 90 ? l.angle + 180 : l.angle).toFixed(0)})`}
        >
          <ChannelsArtEnvelope tone={l.id === "relay" ? "paper" : "lime"} />
        </g>
      ))}
    </svg>
  );
}
