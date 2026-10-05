import type { ReactNode } from "react";
import { MK_FONT_VARIABLES } from "./fonts";
import { MkJsFlag } from "./MkJsFlag";

/*
 * The site root: the element the prototype's <body> became. Every scoped
 * stylesheet in ../css/ lives under it (`.mk.mk` chrome, `.mk.mk-land` landing,
 * `.mk.mk-about` About), and its `:root`/`body` rules land on it: tokens,
 * background, type, overflow. It also carries the three font variables.
 *
 * Root STATE the prototype kept on <html>/<body> lives here as attributes and
 * classes, toggled by the page's own client code through `mkRootOf()`:
 *   - `js`               added on mount by <MkJsFlag> (was html.js)
 *   - `data-intro`       landing hero intro, starts "run" (was body[data-intro])
 *   - `is-intro`         About intro, present on arrival (was body.is-intro)
 *   - `reduced`, `is-leaving`, `is-arriving`, `--sc`  About's (was html/body)
 * Server-rendered and stable: a locale refresh re-renders it with the same
 * props, so React never overwrites the state a page has toggled.
 *
 * It imports NO stylesheet. Each page imports its own ordered list first
 * (land/styles.ts, about/styles.ts): equal-weight ties between the chrome and
 * page sheets resolve by source order, exactly as the prototype's <link> order did.
 */
export type MkMode = "land" | "about";

export default function MkRoot({
  mode,
  className,
  children
}: {
  mode: MkMode;
  /** Extra classes, e.g. About's mono font variable. */
  className?: string;
  children: ReactNode;
}) {
  const classes = ["mk", `mk-${mode}`, mode === "about" ? "is-intro" : null, MK_FONT_VARIABLES, className]
    .filter(Boolean)
    .join(" ");
  return (
    <div data-mk-root="" data-page={mode} data-intro={mode === "land" ? "run" : undefined} className={classes}>
      <MkJsFlag />
      {children}
    </div>
  );
}
