/**
 * The three illustrations on the empty board's action cards — drawn here, by
 * hand, as inline SVG.
 *
 * WHY NOT A TRACED GLYPH. These cards used to render three `/motionize` traces
 * (`stepFirstRoleGlyph`, `profileRosterGlyph`, `stepChannelsGlyph`) and they were
 * wrong in two independent ways, both structural rather than a matter of taste:
 *
 * 1. TRACED ART CARRIES ITS OWN GROUND. Every emitted trace opens with a
 *    full-canvas rectangle — `M0 0h606v518H0z` — that `glyphTokens.snapToToken`
 *    resolves to `var(--color-paper)`. Paper is the PAGE canvas, not a panel: on
 *    Studio Light it is cream `#fdf8ee` sitting on a `bg-white` card, and on
 *    Spark Dark it is `#141b24` sitting on a `#1d2630` card. So the drawing
 *    always shipped a visible rectangle of the wrong colour behind itself, in
 *    both themes, and no gate could see it because the fill is a legitimate
 *    token. The same trap will bite anything that renders a trace on a raised
 *    surface — a traced glyph belongs on the page ground it was quantized
 *    against, or nowhere.
 * 2. THE SIZE VOCABULARY IS SQUARE. `GLYPH_SIZE.*` is `h-N w-N` by construction
 *    (a trace's viewBox is its canvas), and two of these three canvases are not
 *    square (606x518, 544x639). Boxed into 96x96 they letterboxed, so the baked
 *    ground above became a shape that matched neither the art nor the card — a
 *    small off-white stamp adrift in a 368px-wide cell.
 *
 * WHAT REPLACES THEM. One canvas, three drawings, no ground of their own:
 *
 * - EVERY colour is `currentColor` inherited from a token utility class on the
 *   enclosing `<g>` (`text-steel`, `text-coral`, `text-stone-300`, `text-white`).
 *   There is no `fill="#…"`, no `rgba()`, and nothing painted behind the art, so
 *   the card's own background — including its hover wash — shows through and both
 *   themes resolve from `globals.css` with zero per-theme forks.
 * - FULL-BLEED, NEVER DISTORTED. The wrapper is `w-full` with the canvas's own
 *   `aspect-[30/11]` and a `max-h` guard; the svg is `h-full w-full` with
 *   `preserveAspectRatio="xMidYMid slice"`. Matching the wrapper's ratio to the
 *   viewBox means `slice` is an exact fit at every ordinary width, and where the
 *   `max-h` clamp bites (a card wider than ~390px) it crops symmetrically in Y
 *   rather than stretching. Which is why every mark below lives inside
 *   `y ∈ [18, 92]` of a 110-tall canvas: the outer 18 units are deliberate bleed.
 *
 * THE FAMILY. One stroke weight (`STROKE` = 2 canvas units), round caps and
 * joins, a 7-unit corner on every large shape, and two hues doing all the work:
 * `steel` draws structure, `coral` marks the move itself, `stone-300` is ruled
 * detail and `white` is the body of a raised sheet. Lucide icons are composed in
 * where the icon genuinely IS the subject (a pen, a candidate, the channels, the
 * tray they arrive in); each is dropped into a `<g transform>` and given a
 * counter-scaled `strokeWidth` so the family's line weight survives the scale.
 *
 * MOTION: none of its own. The art is decorative (`aria-hidden` — the card's
 * accessible name is its title) and static; the only reaction is the opacity
 * lift the card drives on hover AND focus, which drops out under `motion-reduce`.
 */

import { Globe, Inbox, Mail, Megaphone, Pen, UserRound } from "lucide-react";
import type { EmptyMoveKey } from "./pipelineEmptyMoves";

/** The canvas. Content lives in y ∈ [18, 92]; the rest is crop bleed. */
const VIEW_BOX = "0 0 300 110";

/** The one line weight in the family, in canvas units. */
const STROKE = 2;

/**
 * Drop a lucide icon onto the canvas at `x`/`y`, `size` canvas units wide,
 * keeping the family's stroke weight: lucide draws in a 24-unit box, so the
 * transform's scale multiplies its stroke and the width is divided back out.
 */
function iconBox(x: number, y: number, size: number) {
  const scale = size / 24;
  return { transform: `translate(${x} ${y}) scale(${scale})`, strokeWidth: STROKE / scale };
}

/* ── 1. Write the job description ─────────────────────────────────────────────
   A posting on the desk, mid-sentence: one wide sheet, its headline already set
   in coral, two columns of ruled body, and the last line of the left column
   still being drawn — the pen resting where the ink stops. The move is "write
   the role", so what is drawn is the writing, not a document icon. */
function RoleArt() {
  const pen = iconBox(98, 48, 42);
  return (
    <>
      <g className="text-white" fill="currentColor">
        <rect x="24" y="18" width="252" height="74" rx="7" />
      </g>
      <g className="text-stone-300" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round">
        <path d="M42 56h54" />
        <path d="M42 70h50" />
        <path d="M170 56h88" />
        <path d="M170 70h80" />
        <path d="M170 84h58" />
      </g>
      <g className="text-steel" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round">
        <rect x="24" y="18" width="252" height="74" rx="7" />
        <path d="M151 28v54" strokeLinecap="round" strokeDasharray="2 8" />
      </g>
      <g className="text-coral" fill="currentColor">
        <rect x="42" y="30" width="96" height="10" rx="5" />
      </g>
      <g className="text-coral" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round">
        <path d="M42 84h58" />
      </g>
      <g className="text-coral">
        <Pen size={24} {...pen} />
      </g>
    </>
  );
}

/* ── 2. Put candidates against it ─────────────────────────────────────────────
   The role on the left as the same sheet, shrunk to a column; a dashed rule for
   the word "against"; three candidates on the right, each one a head and a bar
   filled to how far they got. Measurement is the subject, so the bars are the
   loudest thing in the drawing. */
function CandidatesArt() {
  const rows: { y: number; fill: number }[] = [
    { y: 32, fill: 248 },
    { y: 55, fill: 212 },
    { y: 78, fill: 184 },
  ];
  return (
    <>
      <g className="text-white" fill="currentColor">
        <rect x="24" y="18" width="68" height="74" rx="7" />
      </g>
      <g className="text-stone-300" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round">
        <path d="M34 54h44" />
        <path d="M34 66h36" />
        <path d="M34 78h28" />
      </g>
      <g className="text-steel" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round">
        <rect x="24" y="18" width="68" height="74" rx="7" />
        <path d="M110 20v70" strokeLinecap="round" strokeDasharray="2 8" />
      </g>
      <g className="text-coral" fill="currentColor">
        <rect x="34" y="30" width="40" height="9" rx="4.5" />
      </g>
      <g className="text-steel">
        {rows.map((row) => (
          <UserRound key={row.y} size={24} {...iconBox(124, row.y - 11, 22)} />
        ))}
      </g>
      <g className="text-stone-200" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round">
        {rows.map((row) => (
          <path key={row.y} d={`M162 ${row.y}h114`} />
        ))}
      </g>
      <g className="text-coral" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round">
        {rows.map((row) => (
          <path key={row.y} d={`M162 ${row.y}H${row.fill}`} />
        ))}
      </g>
    </>
  );
}

/* ── 3. Open the channels ─────────────────────────────────────────────────────
   The only move nobody has to make, and the only drawing with no sheet in it:
   three sources — the careers page, the email intake, the ad — each opening a
   coral line that runs into one tray. What it says is inflow: candidates filing
   themselves in, rather than being carried in one at a time. */
function ChannelsArt() {
  return (
    <>
      <g className="text-steel">
        <Globe size={24} {...iconBox(22, 16, 28)} />
        <Mail size={24} {...iconBox(22, 41, 28)} />
        <Megaphone size={24} {...iconBox(22, 66, 28)} />
        <Inbox size={24} {...iconBox(202, 17, 76)} />
      </g>
      <g className="text-coral" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round">
        <path d="M60 30C126 30 150 55 204 55" />
        <path d="M60 55h144" />
        <path d="M60 80C126 80 150 55 204 55" />
      </g>
    </>
  );
}

const ART: Record<EmptyMoveKey, () => React.JSX.Element> = {
  role: RoleArt,
  candidates: CandidatesArt,
  channels: ChannelsArt,
};

/**
 * The card's illustration. Decorative by contract: the card's accessible name is
 * its title, so naming the drawing again would read the move twice.
 */
export function PipelineEmptyMoveArt({ moveKey }: { moveKey: EmptyMoveKey }): React.JSX.Element {
  const Art = ART[moveKey];
  return (
    // `max-h-36` is the only thing that stops a very wide card from turning a
    // 2.7:1 drawing into a 200px-tall band; `slice` spends the difference on the
    // canvas's Y bleed instead of on the art.
    <span className="block aspect-[30/11] max-h-36 w-full overflow-hidden">
      <svg
        viewBox={VIEW_BOX}
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
        fill="none"
        aria-hidden
      >
        <Art />
      </svg>
    </span>
  );
}
