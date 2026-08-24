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
 */
export function ChatBlocks({ blocks, labels }: { blocks: readonly ChatBlock[]; labels: ChatBlockLabels }) {
  if (blocks.length === 0) return null;
  return (
    <div className="w-full max-w-[85%] min-w-0">
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
