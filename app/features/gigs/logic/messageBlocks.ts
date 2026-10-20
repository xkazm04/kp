// A bid message (plain text, as it is pasted on the platform) as blocks to SET: paragraphs, and
// runs of "- " lines as lists. The bid's shape (gig_proposal_cli.py "message") is a greeting,
// "How I would approach it:" with the plan as "- " lines, "To get started once we agree, I would
// need:" with the asks as "- " lines, a closing line and the disclosure. A line that introduces a
// list (it ends with ":") becomes that list's heading. Copying always uses the original text;
// this is only how the Review tab and the bid read it. Pure.

export type MessageBlock = { kind: "p"; text: string } | { kind: "list"; lead: string | null; items: string[] };

const ITEM = /^\s*[-*•]\s+/;

export function messageBlocks(text: string): MessageBlock[] {
  const out: MessageBlock[] = [];
  for (const para of text.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = para.split("\n").map((l) => l.trim()).filter(Boolean);
    let prose: string[] = [];
    const flush = () => {
      if (prose.length) out.push({ kind: "p", text: prose.join(" ") });
      prose = [];
    };
    for (const line of lines) {
      if (ITEM.test(line)) {
        const last = out.at(-1);
        const item = line.replace(ITEM, "");
        if (!prose.length && last?.kind === "list") {
          last.items.push(item);
          continue;
        }
        // The prose line right before the first item, when it ends with ":", is the list's lead.
        const lead = prose.length && prose.at(-1)!.endsWith(":") ? prose.pop()! : null;
        flush();
        out.push({ kind: "list", lead, items: [item] });
      } else prose.push(line);
    }
    flush();
  }
  return out;
}
