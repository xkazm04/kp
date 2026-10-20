import { KBD } from "@/app/_components/ui/recipes";
import "./scene.css";

/** One hint: the keys (their names, in the reader's language) and what they do. */
export type KeyHint = { id: string; keys: readonly string[]; act: string };

/**
 * @catalog The keys a level answers to, stated where they apply: a labelled list, each key a `<kbd>` in the KBD recipe, each act in words.
 *
 * Copy-free: the caller names the keys and the acts. Offer no bare-letter shortcut: the workspace
 * owns `g` as the prefix of its two-key tab chords (WorkspaceKeyboardShortcuts.tsx), and `?` opens
 * its shortcut overlay. Renders nothing for no hints.
 */
export function KeyHints({ hints, label }: { hints: readonly KeyHint[]; label: string }) {
  if (hints.length === 0) return null;
  return (
    <ul className="k-keys" aria-label={label}>
      {hints.map((h) => (
        <li key={h.id}>
          {h.keys.map((k) => (
            <kbd key={k} className={`${KBD} text-micro`}>
              {k}
            </kbd>
          ))}
          <span>{h.act}</span>
        </li>
      ))}
    </ul>
  );
}
