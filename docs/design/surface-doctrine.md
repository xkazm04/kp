# Surface doctrine — what a well-dressed surface does

The design system says which paint is allowed. This says how a surface is
*composed* — the rules that decided a redesign of the job-intake studio in
September 2026, written so they transfer to the next surface instead of being
re-derived from taste each time.

Every rule here was applied and looked at, not proposed. The intake studio is
the worked example, and where a rule names a before-and-after it is that one.

---

## 1. No sentence occupies layout

A surface that explains how to use itself has failed to be usable. The intake
studio carried roughly forty sentences of chrome copy: what materials are for,
what the draft column will contain once you talk, that a thorough reply takes
thirty to forty seconds, that dictation is not configured on this server so you
should continue in text.

The rule is not "delete the explanation". It is **the explanation lives on the
control it explains, and is reached rather than read**:

| Was | Is |
| --- | --- |
| "Holding a team charter, an old posting or notes? They can be attached as materials. Open Materials" | a paperclip glyph with its count; the tooltip names it |
| "Dictation is not set up on this server; typing works as usual." | a struck microphone; the reason is its tooltip |
| "The brief builds itself here as you talk." | five ghost record rows in the shape the brief will take |
| "Also design the work-sample assignment" beside a checkbox | a pressed clipboard glyph |

**Two things stay visible and are not chrome**: an error the reader must act on,
and an honesty notice about what produced what they are reading (kp's degraded
engine writes a different artifact, and hiding that would be a lie of omission).
When you are unsure which side a sentence falls on, ask whether a reader who
never saw it would make a worse decision. If not, it is chrome.

**A tooltip must be a real element, not `title=`.** The native attribute never
appears on keyboard focus and is invisible to touch, so a control whose only
name is a `title` is a picture to half the audience. `app/_components/Tooltip.tsx`
shows on hover *and* focus, dismisses on Escape, and wires `aria-describedby`.
`app/_components/IconAction.tsx` takes one `label` and spends it three ways — the
accessible name, the tooltip, and the screen-reader text — so a glyph cannot ship
without a meaning.

## 2. Planes, not nested boxes

The strongest signal that a surface is dated is nesting: a rounded bordered card,
inside a rounded bordered card, inside a panel, with a bubble inside that. The
intake desk was five radii deep before the first readable sentence.

Depth comes from **hairline, space and type** instead. One continuous ground;
zones parted by a 1px rule; a zone head that is quiet and sticky; content that
owns its own rhythm. The visual weight then lands on the words, which is what the
reader came for.

## 3. A count is a numeral; a pill is a state you can act on

Wrapping every number in a chip flattens the difference between "eleven items"
and "needs your approval". Counts render as bare tabular numerals in the zone
head. Reserve the pill for something with a next action.

## 4. Evidence on demand

Provenance, citations, confidence and rationale are the reason a brief can be
defended, and they are also noise on every line. Keep them in the DOM and reveal
them on hover or focus: the `[7]` citation, the rationale disclosure, the
confidence figure. The reader who is skimming sees a document; the reader who is
challenging it finds the receipts without leaving.

## 5. Motion belongs to state changes, and a change is a morph

Three quarters of the motion in a typical surface is entrance animation nobody
asked for. Cut that and spend the budget on the moments the state actually
changes, where motion carries information:

- **A thing that persists must persist visually.** When a pending marker becomes
  an arrived answer, give both a shared `layoutId` so one object morphs. A
  component that unmounts and another that mounts in its place throws away scroll
  anchoring, selection and focus at exactly the moment the reader engages.
- **Arrival is staggered and capped.** 40ms between rows, twelve rows maximum,
  the rest instant, so a large update is a wave and not a queue.
- **Only what changed animates.** Diff the new state against the previous one and
  animate the delta; an untouched row keeps its element and stays still.
- **Everything is gated** on `useReducedMotion()`, and the reduced path drops the
  transform rather than shortening it.

Forbidden, because it reads as noise and gets rejected on sight: `repeat:
Infinity`, ambient drift, and geometry that moves on hover.

## 6. The live thing is the hero

In a surface with a working state and a history, the element the reader must act
on *now* deserves the size, and the history compresses to a rail they can open.
The intake conversation is one question per turn, so the current question stands
alone at reading size above the field that answers it, and earlier exchanges
become numbered ticks. The same shape fits any queue, review or inbox: one live
item large, the rest as marks.

## 7. What the engine says, the chrome does not repeat

The intake composer used to coach: "Answer in your own words. Vague is fine."
The agent's own opening turn already says it, in the reader's language, at the
moment it matters. A product with a conversational surface should let the
conversation carry the coaching and keep the chrome silent.

---

## How to apply this to another surface

Use the repo's `/prototype` skill. It is the method this doctrine came out of:
two *directional* variants behind a switcher, the current surface kept as the
default tab so there is something to compare against, one commit per round, and
the variant count shrinking every round until one wins. Fusion is a legal move —
the studio's winner is one direction wearing another's document component.

Surfaces in kp that carry the same tells and would repay a round, roughly in
order of how much of the product they are:

1. **The pipeline board and its candidate drawer** — the densest daily surface;
   nested cards and status pills throughout.
2. **Decisions** — a queue with a live item and a history, which is rule 6
   almost exactly.
3. **Channels** — heavy explanatory copy around setup and delivery states.
4. **Analytics** — counts in pills, and evidence that should be on demand.
5. **Settings and billing** — the most sentences per pixel in the app.

Before starting one, read this page and `docs/design/README.md`, and check the
surface against the seven rules above. Most of the findings write themselves.
