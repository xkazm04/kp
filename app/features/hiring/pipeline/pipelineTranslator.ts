import type { useTranslations } from "next-intl";

/*
 * The translator shape the pipeline tab passes DOWN to its extracted
 * sub-components (toolbar, facet row, bulk bar, stat header, scheduler rows…).
 *
 * When PipelineTab and SchedulerControl were split, each piece needed the parent's
 * `t`. next-intl types `t()` against the literal key union of ITS namespace, and a
 * component receiving `t` as a prop cannot restate that union — so the split
 * initially typed the prop `(...args: any[]) => string`, which is both unsafe and
 * an `no-explicit-any` lint error in sixteen files.
 *
 * This names the real thing instead: the return type of `useTranslations` for the
 * `pipeline` namespace, which is exactly what every one of those parents holds.
 * Same idiom as `NavTranslator` in shell/tabs.ts, minus the escape hatch.
 */
export type PipelineTranslator = ReturnType<typeof useTranslations<"pipeline">>;

/** The tab shell (header, filter bar, bulk bar, activity feed) reads from
 *  `pipeline.tab` — that is what usePipelineTabState holds and hands down. */
export type PipelineTabTranslator = ReturnType<typeof useTranslations<"pipeline.tab">>;

/** The scheduler sub-tree reads from the `pipeline.scheduler` sub-namespace. */
export type SchedulerTranslator = ReturnType<typeof useTranslations<"pipeline.scheduler">>;
