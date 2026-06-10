"use client";

import { useEffect } from "react";
import { recordRecent, type RecentItem } from "./recents";

// SHELL3 — render-nothing client island for SERVER detail pages (/jds/<slug>,
// /history/<slug>): the page resolved the entity server-side and passes the
// label; this records the visit once on mount (an external-system write, the
// thing effects are for).
export function RecordRecent({ type, id, label, href }: Omit<RecentItem, "at">) {
  useEffect(() => {
    recordRecent({ type, id, label, href });
  }, [type, id, label, href]);
  return null;
}
