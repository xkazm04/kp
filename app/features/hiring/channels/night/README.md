# Hiring > Channels: "The Night Post"

The channels-setup contest winner (`.contest/arena/channels-setup/judging/entries/B/variant-1/`),
ported onto real state. The plumbing is a small district you walk into, level by level:

| Level | What | Built by | Body today |
|---|---|---|---|
| **L0** the plumbing | four doors (careers, email intake, ad forms, pull feeds), the studio, the relay depot, the night box (edge), the ledger (post book), the candidates' houses; the headline, the figures, "needs you, worst first" | CH-F | final |
| **L1** one channel | careers / email / ads / feeds / relay / edge setup, stepper ← → and a dot per channel | CH-S | final (`night/setup/*`) |
| **L2** the ledger | the relay's truth, verdict chips, facets, search, the role scope, the windowed table, paging | CH-L | final (`ledger/`) |
| **L3** one message | the letter, its verdict, the resend doors, the delivery timeline, prev / next | CH-L | final (`message/`) |

The parity with the kit view this replaced (every behaviour of the old tab and where it lives now,
the deliberate changes and drops) is in `docs/features/comms/README.md`, "Parity with the retired kit
view".

## Architecture

```
ChannelsTab -> ChannelsNightShell            data (ONE useChannelData, ONE useCommsFeed, useChannelsNightDelivery),
                 |                           the stack (useChannelsNightNav), keys (useChannelsNightKeys),
                 |                           the model (channelsNightPlumbing.plumbingModel), the trail announcement
                 +- LevelTransition x N      (kit scene) one per stack entry (+ the closing one): the circle wipe
                      +- L0 ChannelsNightPlumbingView (Head, Stage | Street, Needs, Keys)
                      +- L1 ChannelsNightSetupLevel   -> ChannelsNightFrame + setup/Setup{Careers,Receivers,Feeds,Relay,Edge}
                      +- L2 ChannelsNightLedgerLevel  -> ChannelsNightFrame + ledger/ChannelsNightLedger
                      +- L3 ChannelsNightMessageLevel -> ChannelsNightFrame + message/ChannelsNightLetter
```

The generic parts are the kit's scene layer (`@/app/_components/kit/scene`, see "What moved to the kit"
below); `ChannelsNightFrame` is this surface's binding of the kit's `LevelFrame` (the channel's tone, the
trail's and the keys' words).

### The level machine (`channelsNightNav.ts` over the kit's `levelStack.ts`, pure, tested)

- A `NightStack` is `NightEntry[]` whose root is always `{ level: 0 }`:
  `{ level: 1, channel, focus }` (focus = a receiver token to open on), `{ level: 2, verdict, role, from }`,
  `{ level: 3, id, list }` (the ids it was opened from, for prev / next).
- `nightReduce(stack, action)` is the kit's `levelReduce` with this surface's root and `sameEntry`: `push`
  (a push of a place already on the stack RETURNS to it: no loops), `pop`, `popTo(depth)` (a breadcrumb),
  `replaceTop` (a sideways step, same level), `reset`. The generic rules are pinned by
  `app/_components/kit/scene/levelStack.test.ts`, this grammar by `channelsNightNav.test.ts`.
- `layerModeAt(depth, top, transition)` (kit): only the top is in the page flow; while it opens, the one
  under it stays drawn and inert. `layerKey` (here) keys a layer by depth + place, so a sideways step
  remounts and a closing level keeps its instance while its circle closes.
- Covered levels stay MOUNTED (`hidden`): what was typed at L1 survives a trip to L2 and back.

### Transitions (kit: `LevelTransition` + `scene/wipe.ts`)

A level opens as `clip-path: circle()` growing from the centre of the element that was touched (the
opener) and closes as the same circle shrinking back onto it (measured when the close starts, so it lands
on the building that is visible again). Open 760 ms, close 560 ms; a sideways step fades 140 ms; reduced
motion cross-fades only (`useReducedMotion`). The animation is always cancelled when it ends (a finished
`fill: forwards` clip would keep clipping a level that grows). Each layer is its own stacking context.

### Focus and announcement

A push focuses the new level's heading (`[data-level-heading]`: the kit frame sets it, the L0 headline
carries it too; `tabIndex -1`, no ring: a landmark, not a control) and scrolls the surface into view if the
reader had scrolled past it. A pop focuses the opener, else the building of the level that closed
(`[data-night-node]`), else the heading. A sideways step keeps focus on the control with the same
`data-level-key` (the stepper's `step-prev` / `step-next`, the trail's `back`, a need's `need-<id>`). The
first render never takes focus. The layers are the kit's `.k-layer[data-depth][data-mode]`.
A polite `role=status` line announces the trail ("Channels › Ledger › Klára Blažeková") on every move.

### Keys (`useChannelsNightKeys`)

Esc = one level up at every level; it yields to an open modal, a focused field (blurred first), an open
kit reading pane inside the level (`.k-stage[data-detail=open]`, the kit closes it) and to key presses
outside the surface; handled = `preventDefault` (the control dock ignores it). L0: arrow keys walk the
buildings. L1: ← → step the channel (not inside controls that own their arrows). No bare letters (they
collide with the workspace `g` chords; the ledger's own row keys are level-local, below). Level keys are stated with `ChannelsNightKeys` (in
`ChannelsNightFrame.tsx`: the kit's `KeyHints` with `channelsNight.shell` words; `KEYS_PLUMBING`,
`KEYS_LEVEL`, `KEYS_CHANNEL`).

### URL (the `?sec=` inbox)

The tab's historic `?sec=` stays its ONE inbox param: read on arrival, emptied at once
(`useShellNavigate().replace`), clicking writes nothing (app-structure.md "The URL is their inbox").
Grammar (`parseNightArrival`, inverse `nightArrivalParam`, both tested):

| `?sec=` | Lands on |
|---|---|
| (absent / unknown) | L0 |
| `plumbing` | L0 |
| `comms` / `ledger` | L2, all messages (every old Communications link) |
| `dead` / `queued` / `sent` / `recovered` / `failed` / `bounced` / `orphaned` | L2 filtered (`dead` = needs you) |
| `careers` / `email` / `ads` / `feeds` / `relay` / `edge`, optionally `:<receiver token>` | L1 (old section links still land) |
| `msg:<id>` | L3 over L2 (a message outside the loaded window says so) |

The arrival builds the whole stack (0 -> 2 -> 3), so Esc walks back through it. `sec` is not in
`TAB_SCOPED_PARAM_KEYS` (it never outlives its arrival), so `buildUrl` / `clearedTabScopedParams` are
untouched.

### Data and the model

`useChannelData` (receivers, open roles, the waiting count, `loadFailed`) and `useCommsFeed` (the ledger)
are read ONCE in the shell and handed to every level. `useChannelsNightDelivery` reads the relay's health
word (`GET /api/comms/relay`, falling back to the capability bit) and the edge (`GET /api/edge`) through
`channelsNightReads.ts` (the ONE parse; the relay and edge editors import it too), again on live refresh
and on every return to L0. `channelsNightPlumbing.ts` turns that into plates, figures, the ranking and the
headline, with the app's truthful vocabulary (`commsVerdict`, `isActionable`, `receiverHealth`):

- conditions `live | wait | reach | fail | off | unknown`; `unknown` = not read, never a guess;
- the relay is `live` only with a sent row as evidence ("configured, nothing sent yet" is `wait`);
  `unreadable` is `fail`; unconfigured with queued mail is the page's one alert, and only the
  building of the top-ranked need may wear an alarm (`plumbingPlates(input, needs)`);
- the headline: the top need (>= 30), else "wired and flowing" (`ok`) only with the relay `live`, no
  channel `off` and every source read; else `quiet` ("nothing needs you", with what is not proven:
  the relay has sent nothing yet, N channels off or not set up), or `okPartial` when a source was
  not read;
- "dead letters" is a dash with "not measured: nothing is sent" while no relay could have failed one;
- `rankNeeds` (severity 0-100, worst first; >= `NEEDS_SHOWN` 30 is listed and may take the headline).

Words: `channelsNightCopy.ts` maps model keys to catalog paths (re-using `channels.*` where the words are
the same). The namespace is `channelsNight` with `shell` and `plumbing`; CH-S adds `setup`, CH-L adds
`ledger` and `message` (re-upsert the WHOLE namespace from the current catalog, PORT-PLAN2 "Namespaces").

## Contract for the level owners (CH-S, CH-L)

The contract the levels were built to (the adapters that stood in for them, and the kit view whose parts
they rendered, were deleted on 2026-09-30); keep the frame and the shell:

- **L1 (CH-S, done)**: `ChannelsNightSetupLevel` over `setup/*` (it replaced `ChannelsNightSetupAdapter.tsx`). Props you get: `channel`, `focus` (a receiver token to open on), `plate` (the channel's
  L0 plate: condition, chip, fact), `data` (`useChannelData()`), the nav callbacks (`onStep`,
  `onOpenLedger(from, el)`). Keep: `data-level-key` on steppers, the relay save's
  `invalidateCommsCapability()` + `notifyDataChanged()`, the edge drain's status-first refusal, every coded
  refusal. Parity rows D1-D10.
- **L2 / L3 (CH-L, done)**: L2 gets the shell's `feed` (never a second one) and `data` (the receivers and
  roles, for the scope of `from`), the entry's `verdict` / `role` / `from`, `onOpenMessage(id, list, el)`
  (push L3 with the list AS FILTERED), `onOpenChannel(channel, el)`; L3 gets `feed`, `onStep(id)` (a
  `replaceTop`) and `onOpenChannel(channel, el)` (the relay, from a queued letter). The L2 Delivery block
  is gone (E7). Their keys (1-7, /, j k, ↑ ↓ in the rows, Enter; [ ]) are level-local
  (`ledger/useNightLevelKeys.ts`) with the shell's yield rules; each level states them with the kit's
  `KeyHints` in its foot (the frame's `keys` is empty there). Parity rows E1-E9, F1-F7.
- Both: render inside `ChannelsNightFrame` (its props are unchanged: `ground`, `kicker`, `title`, `lead`,
  `actions`, `art` + `artPlace`, `crumbs`, `onBack`, `foot`, `keys`); its heading is the focus target;
  `KitSurface` inside a level is fine (Esc yields to its open pane). A condition beside art is the kit's
  `ConditionMark`, a plate the kit's `NamePlate`, a crumb the kit's `Crumb` type, all from
  `@/app/_components/kit/scene`. No literal colours, no new fonts, 14px floor, both registers.
- Import paths: `import { ConditionMark, NamePlate, type Crumb } from "@/app/_components/kit/scene"`;
  `import { ChannelsNightFrame, KEYS_LEVEL, KEYS_CHANNEL } from "./ChannelsNightFrame"`. A pure `.ts`
  module (run under `node:test`) imports the kit's pure files directly, with the extension:
  `@/app/_components/kit/scene/levelStack.ts` (the index pulls in `.tsx` and CSS).

## Levels 2 and 3 (CH-L, 2026-09-30)

- `ledger/`: `ChannelsNightLedger` (state, keys, composition), `ChannelsNightLedgerAlarm` (the relay's
  truth: no relay = "N messages are NOT being sent to candidates", the loudest thing on the level, and the
  relay's level as its door; a relay with old queued rows = they stay recorded), `ChannelsNightLedgerChips`
  (needs you + the six verdicts, keys 1-7), `ChannelsNightLedgerFacets`, `ChannelsNightLedgerTable` (the kit
  `DataTable`, 9 rows tall, `useCommsFeed` paging in its pager), `useNightLevelKeys` (a level's own bare
  keys with the shell's yield rules, the `g`-chord window and a top-layer check; L3 uses it for [ ]).
  Pure rules: `channelsNightLedgerModel.ts` (+ test): the order, the filters, the chip counts over the
  OTHER filters, `chipReading` (a zero only a relay could fill, relay off = "—, not measured"),
  `relayFact`, `scopeRoles` (the roles a channel's "Open the ledger" scopes to), `bookCondition`.
- `message/`: `ChannelsNightLetter` (verdict, record, one note, "What you can do", the timeline, the stored
  body), `ChannelsNightResendDoor` (`RetryDoor`, `CorrectAddressDoor` over `../useCommsResend.ts`, the ONE
  resend fold `ChannelsCommsBouncedResend` renders too), `ChannelsNightMessageTimeline`,
  `ChannelsNightEnvelope` (the drawing). Pure rules: `channelsNightMessageModel.ts` (+ test): the timeline
  from the row's own fields only, the note, the drawing's condition.
- Not offered (no API): "hand the queue to the relay", "resend a copy" of a sent letter, "recover" an
  unmatched receipt. Configuring a relay does not send a `queued` row (it is terminal); both levels say so.

## Level 1: one channel's setup (`night/setup/`)

`ChannelsNightSetupLevel` gets `plates` (every channel's plate: the frame's art and condition, the stepper's
dots), `counts` (`countVerdicts` of the shell's feed: the relay's "what it has carried"), `data`, `onStep`,
`onGo(channel)` (a dot: `replaceTop`) and `onOpenLedger(from, el, scope?)` (`scope` = `{ verdict }` or
`{ role }`: "Review the queue first", "Messages for this role"). Each channel is a status strip (the plate's
words) over its real setup, inside a `KitSurface` (the absence tips need its tip layer):

- **careers** `SetupCareers`: every open role's apply link with a copy per row, in a region that scrolls;
  "Receive a test application" (`/api/sim/inbound`) on the first open role.
- **email / ads** `SetupReceivers` -> `SetupReceiverCard`: worst health first (`rankReceivers`), the endpoint
  masked until revealed (`SetupEndpoint`; a failed copy reveals it), add in place (`SetupAddReceiver`, the new
  card opens revealed), remove behind a `ConfirmDialog`, and one panel at a time: setup steps
  (`SetupGuideSteps`), a real-CV test (`SetupCvSim`), the pull source (`SetupPullForm`).
- **feeds** `SetupFeeds`: every receiver's pull half, failing first (`rankFeeds`); `focus` opens its editor.
- **relay** `SetupRelay` + `useRelaySetup`: URL, the write-only secret (`SetupSecretField`: masked when
  stored, Show / Generate / Copy while typed), Save (409 adopts; both announce the capability change), the
  REAL test ping. The depot's barrier lifts while a readable relay is configured; the shutter rolls up
  only on proof: sent rows, or a test the relay just answered (`relayScene`).
- **edge** `SetupEdge` + `useEdgeSetup`: offline / env / secret-missing notes, the drain ledger, Save / Pair,
  Drain now (status first, then the failure CLASS), Enable sealing.

The decisions are pure and tested: `setupModel.ts` (masking, endpoints, the generated secret, ranking) and
`setupDelivery.ts` (blank-save guards, the test and drain outcomes, the depot's scene); `setupGuards.test.ts`
pins that the hooks act on them; `setupI18n.test.ts` renders `channelsNight.setup`.

## What moved to the kit (`app/_components/kit/scene/`, 2026-09-30)

The kit agent lifted the generic pieces into the kit's scene layer (docs/design/README.md "Scenes: levels,
wires, marks"). Each is copy-free (the words come from here) and paints through `--k-*` in `scene.css`:

| Was (night/) | Now (kit scene) | What stays here |
|---|---|---|
| `ChannelsNightFrame.tsx` (markup + CSS) | `LevelFrame` (`tone` instead of `ground`; `trail`, `keys` slots) | `ChannelsNightFrame.tsx`: the binding (ground -> tone, the words, `KEYS_*`, `ChannelsNightKeys`) |
| `ChannelsNightCrumbs.tsx` | `LevelTrail`, type `Crumb` (`backLabel`, `label` passed in) | the words, in the binding |
| `ChannelsNightLayer.tsx` + `channelsNightWipe.ts` (+ test) | `LevelTransition`, `scene/wipe.ts` (+ `wipe.test.ts`) | nothing |
| `nightReduce` / `layerModeAt` / `LayerMode` / `TransitionKind` | `levelReduce`, `layerModeAt`, the types (`levelStack.ts` + test) | `nightReduce` (binding), the grammar, `layerKey`, `sameEntry` |
| `ChannelsNightNeeds.tsx` (`ChannelsNightNeedItem`) | `NeedsList` / `NeedsItem` | `ChannelsNightNeeds` (the ranking filter, `useNeedWords`) |
| `ChannelsNightCondition.tsx` (`CONDITION_MARK`) | `ConditionMark`, `scene/conditions.ts` (+ test) | nothing (`NightCondition` is the same union as the kit's `Condition`) |
| `ChannelsNightPlate.tsx` | `NamePlate` (without a condition it is the studio's static plate; `align="centre"`) | nothing |
| `ChannelsNightKeys.tsx` | `KeyHints` | `ChannelsNightKeys` + `KEYS_*`, in `ChannelsNightFrame.tsx` |

Class names moved with them (`cn-frame*` -> `k-lvl*`, `cn-trail` / `cn-crumbs` -> `k-trail` / `k-crumbs`,
`cn-layer` -> `k-layer`, `cn-cond*` -> `k-cond*`, `cn-plate*` -> `k-plate*`, `cn-needs` / `cn-need*` ->
`k-needlist` / `k-need*`, `cn-keys` -> `k-keys`), and the focus attributes are the kit's
(`data-level-heading`, `data-level-key`). The one visible change: the moved parts' quiet text in Spark Dark
reads the kit's `--k-quiet` (70% ink) where `--cn-quiet` was 72%. `channelsNight.css` keeps the shell, the
L0 head, figures and street, the stepper, the big art and the empty state; `channelsNightScene.css` the
district.

## Art

`night/art/` holds the drawings as typed TSX SVG (`ChannelsArtDoors`, `ChannelsArtPlant`, `ChannelsArtPost`,
registry `ChannelsArt`), stylised and decorative (`aria-hidden`, the plates carry the words):

- **Colour only through classes.** `cn-a-f` (filled + outlined), `cn-a-st` (thin stroke), `cn-a-line`
  (stroke only), `cn-a-gnd` (ground shadow), fills `cn-fc-paper | cream | coral | moss | amber | steel | lime |
  ink | sky`. `channelsNightScene.css` maps them onto tokens through the `--cn-*` roles, so ONE geometry
  renders in both registers: Studio Light draws calm (2px ink lines on light fills, no drop shadow), Spark
  Dark playful (cream 2.5px lines on dark fills, hard sticker drop shadow, a tilt on hover).
- **State from the nearest `[data-cond]`** (`live | wait | reach | fail | off | unknown`) and `[data-sealed]`.
  Parts that exist only in one state are `cn-on-live | cn-on-off | cn-on-fail | cn-on-sealed` groups
  (`cn-on-notlive` hides when live). `off` / `unknown` dash every stroke and fade the fills; `fail` adds a
  coral halo; the relay's `cn-shutter` rolls up and its window lights only when `live`; the edge's
  `cn-lantern` lights only when `live`; the houses' `cn-flag` is down when the relay is `off`.
- **Motion only on a state change**, once: the barrier lifts, the shutter rolls, a letter fades in where a
  road carries traffic, the studio bumps when a test application lands. No loops (surface doctrine §5);
  everything still under reduced motion. The prototype's ambient loops (moving letters, wobbling barrier,
  spinning orbs, smoke) are deliberately NOT ported.
- The district map is `channelsNightDistrict.ts` (1000 x 540 design units; buildings as boxes, roads as
  cubic Béziers); buttons are placed by percentage of the stage so the SVG ground and the HTML plates never
  drift. Below 760px of sheet the district reads as a street of cards (`ChannelsNightStreet`).
The four doors are not placed one by one: they share ONE grid column (`.cn-doors`, `DOORS` / `doorsStyle()`), whose rows are as tall
as their plates and spread over the column with a 12px floor, so a two-line plate in a longer language pushes its neighbours instead of touching them.
The queued count hangs from its right edge (`COUNT_GAP` left of the relay plate) and wraps, so a longer word grows away from the relay.

## Not ported from the prototype (on purpose)

The sample-state switch, "Prototype controls", "sample data" / "stylised" chips, simulated relay / feed /
edge outcomes, the "hand the queue to the relay" batch action and the unmatched-receipt "recover" (no API
behind either), composed message bodies, the hand-lettered font (the "start here" note uses the register's
display face), and bare-letter shortcuts (T, L, R: they collide with the workspace chords).
