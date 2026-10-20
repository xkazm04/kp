/*
 * The composition kit's SCENE layer (2026-09-30): parts lifted from two contest winners (Hiring > Channels,
 * "The Night Post", and the Hiring Overview, "The Orbit, Lit") when a practical surface was redesigned in
 * the marketing site's layered, drawn, animated manner. Each part is used by ONE of them today
 * (docs/design/README.md "Scenes" names which); they are generic, not yet shared. Levels you walk into
 * (a stack, its frame, its trail, its wipe), marks with words (condition, plate, needs), and a figure
 * with its cards wired to it (wires, halos, the hand note, the lit ground, the queue card). Every part
 * is copy-free (words arrive formatted), renders inside a `.k-kit` root, and loads `scene.css` itself.
 * docs/design/app-contest-kit.md says when to reach for them; docs/design/README.md "Scenes" lists them.
 */
export { LevelFrame, type LevelTone } from "./LevelFrame";
export { LevelTrail, type Crumb } from "./LevelTrail";
export { LevelTransition } from "./LevelTransition";
export { KeyHints, type KeyHint } from "./KeyHints";
export { levelReduce, layerModeAt, type LevelEntry, type LevelAction, type LevelRules, type LayerMode, type TransitionKind } from "./levelStack";
export { ConditionMark } from "./ConditionMark";
export { NamePlate } from "./NamePlate";
export { ScenePress } from "./ScenePress";
export { NeedsList, NeedsItem } from "./Needs";
export type { Condition, NeedTone } from "./conditions";
export { QueueCard, type QueueName } from "./QueueCard";
export { HandNote } from "./HandNote";
export { Halos, type HaloPoint } from "./Halos";
export { Wires, type SceneWire } from "./Wires";
export { LitGround } from "./LitGround";
export { wireFor, nearest, type Pt, type Box, type Wire } from "./wireGeometry";
export { labelWidths } from "./labelWidths";
