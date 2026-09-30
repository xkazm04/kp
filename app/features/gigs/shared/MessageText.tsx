"use client";

import { messageBlocks } from "../logic/messageBlocks";

// A bid message SET for reading (logic/messageBlocks.ts): paragraphs, and each "- " run as a list
// under its lead line ("How I would approach it:", "To get started once we agree, I would need:").
// The text itself is unchanged: Copy always copies the plain message the platform receives.

export function MessageText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className ? `msg-text ${className}` : "msg-text"}>
      {messageBlocks(text).map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>{b.text}</p>
        ) : (
          <div key={i} className="msg-list">
            {b.lead ? <p className="msg-lead">{b.lead}</p> : null}
            <ul>
              {b.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          </div>
        )
      )}
    </div>
  );
}
