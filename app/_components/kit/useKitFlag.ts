"use client";

import { useSyncExternalStore } from "react";

/*
 * Gate K2 decision switch (kit-unification spark). While the owner judges the composition-kit
 * port INSIDE the product, a surface that has a kit port renders it when `?kit=1` is in the URL
 * or `localStorage["kp-kit"] === "1"`; `?kit=0` switches back and clears the stored choice.
 * Production builds always render the current surface. Deleted (and the ports promoted) when
 * the owner decides.
 */

const KEY = "kp-kit";

function read(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  try {
    const q = new URLSearchParams(window.location.search).get("kit");
    if (q === "1") { window.localStorage.setItem(KEY, "1"); return true; }
    if (q === "0") { window.localStorage.removeItem(KEY); return false; }
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    // Storage blocked (private mode, sandboxed preview): the current surface renders.
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

/** True when this surface should render its composition-kit port (dev only). */
export function useKitFlag(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
