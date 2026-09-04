// The gate itself is plain ESM (scripts/ runs on node, not through tsc); this
// declaration exists so the fixtures in app/_components can import it under the
// repo's `noImplicitAny`.
export declare function copyDefaults(source: string): { line: number; prop: string; value: string }[];
