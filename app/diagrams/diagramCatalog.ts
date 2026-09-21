// The files the Architecture page actually renders. Labels and blurbs live in
// messages/*.json (`items.<key>.*`); only the on-disk file name and layout flags
// stay here so page.tsx and the standalone-read contract share one catalog.

export type DiagramCatalogKey = "tobe" | "v1" | "v2";

export type DiagramCatalogEntry = {
  file: string;
  key: DiagramCatalogKey;
  featured?: boolean;
};

export const DIAGRAMS: readonly DiagramCatalogEntry[] = [
  { file: "15-automated-pipeline-tobe.puml", key: "tobe", featured: true },
  { file: "01-system-architecture-v1.puml", key: "v1" },
  { file: "02-system-architecture-v2.puml", key: "v2" },
];
