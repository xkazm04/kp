import type { ChatBlock, ChatBlockLabels } from "./chatBlockTypes";
import { ChatTable } from "./ChatTable";
import { ChatMiniChart } from "./ChatMiniChart";

/*
 * The one place a turn's non-text components are dispatched.
 *
 * It exists so a caller wires blocks ONCE — through ChatTranscript's
 * `renderTurnExtras` slot — and gains every future block type without touching
 * the call site. The switch is exhaustive over `ChatBlock`, so adding a variant
 * to the union is a type error here until it is drawn, which is the only place
 * that check can live.
 *
 * Deliberately NOT wired into ChatTranscript itself: intake renders through the
 * same transcript and has no blocks, and a prop it never passes is a prop that
 * can never regress it.
 *
 * FULL-BLEED (round 5). Blocks escape the bubble: the bubble keeps its 85 % cap
 * because a paragraph needs a ragged right edge to read as speech, but a table
 * or a chart is a DRAWING and every pixel it gives back to the identity gutter
 * is a column it cannot show. So this renders at the transcript's full width,
 * under the bubble, on both sides of the conversation. The operator's round-5
 * finding was exactly this — a three-column table inside a 26rem column wrapped
 * every cell to three lines and read as illegible chrome.
 */
export function ChatBlocks({ blocks, labels }: { blocks: readonly ChatBlock[]; labels: ChatBlockLabels }) {
  if (blocks.length === 0) return null;
  return (
    <div className="w-full min-w-0">
      {blocks.map((block, index) =>
        block.type === "table" ? (
          <ChatTable key={index} block={block} labels={labels} />
        ) : (
          <ChatMiniChart key={index} block={block} labels={labels} />
        )
      )}
    </div>
  );
}
