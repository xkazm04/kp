"use client";

import { useEffect, useState } from "react";
import { isWorkspaceTabId, type WorkspaceTabId } from "./tabs";

const KEY = "kp.recent-tabs";
const EVENT = "kp:recent-tabs-changed";
const CAP = 3;

export function advanceRecentTabs(previous: readonly WorkspaceTabId[], tab: WorkspaceTabId): WorkspaceTabId[] {
  return [tab, ...previous.filter((id) => id !== tab)].slice(0, CAP);
}

function readRecentTabs(): WorkspaceTabId[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is WorkspaceTabId => isWorkspaceTabId(value)).slice(0, CAP) : [];
  } catch {
    return [];
  }
}

export function useRecentTabs(current: WorkspaceTabId): WorkspaceTabId[] {
  const [recent, setRecent] = useState<WorkspaceTabId[]>([]);
  useEffect(() => {
    const record = () => {
      const previous = readRecentTabs();
      const next = advanceRecentTabs(previous, current);
      setRecent(next);
      if (previous[0] === current) return;
      try {
        sessionStorage.setItem(KEY, JSON.stringify(next));
        window.dispatchEvent(new Event(EVENT));
      } catch {
        // Browsers can disable storage; this is a navigation convenience.
      }
    };
    record();
    const onChange = () => setRecent(readRecentTabs());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [current]);
  return recent;
}
