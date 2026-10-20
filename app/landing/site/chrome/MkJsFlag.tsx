"use client";

import { useEffect } from "react";
import { MK_ROOT_SELECTOR } from "./rootState";

/** Adds `js` to the site root once the client runs: the prototype's
 *  `document.documentElement.classList.add('js')`. Rules gated on `.js` (reveal
 *  offsets, About's arrival choreography) stay off in the server HTML, so a
 *  reader without scripts sees every section in place. */
export function MkJsFlag() {
  useEffect(() => {
    document.querySelectorAll<HTMLElement>(MK_ROOT_SELECTOR).forEach((el) => el.classList.add("js"));
  }, []);
  return null;
}
