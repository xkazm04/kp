"use client";

import { motion } from "framer-motion";
import { DISPLAY } from "../tokens";
import { DRAW, ENTER } from "./shared";

/* 02 · Source — candidates ranked against the role, bars filling to match %. */
// Nothing here is translatable copy: the names are fictional sample data and
// the role labels are DNT technology terms.
const ROWS = [
  { name: "Jana N.", role: "Backend", v: 88 },
  { name: "Petr K.", role: "Full-stack", v: 74 },
  { name: "Alex T.", role: "Java", v: 61 }
];

export default function SourceArt({ color = "#caa54c" }: { color?: string }) {
  return (
    <div className="mx-auto w-full max-w-lg space-y-2.5">
      {ROWS.map((r, i) => (
        <motion.div
          key={r.name}
          initial={{ opacity: 0, x: 40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={ENTER}
          transition={{ delay: i * 0.12, type: "spring", bounce: 0.3 }}
          className="flex items-center gap-3 rounded-2xl border-[3px] border-[#17202a] bg-white p-3 shadow-[4px_4px_0_#17202a]"
        >
          <span
            className={`${DISPLAY} grid h-8 w-8 shrink-0 place-items-center rounded-full border-[3px] border-[#17202a] text-sm font-extrabold text-white`}
            style={{ background: color }}
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">
              {r.name} · <span className="text-[#42606f]">{r.role}</span>
            </p>
            <div className="mt-1 h-2.5 w-full rounded-full bg-[#dce7d0]">
              <motion.div
                initial={{ width: 0 }}
                whileInView={{ width: `${r.v}%` }}
                viewport={ENTER}
                transition={{ ...DRAW, delay: 0.2 + i * 0.12 }}
                className="h-full rounded-full"
                style={{ background: color }}
              />
            </div>
          </div>
          <span className={`${DISPLAY} text-lg font-extrabold`}>{r.v}</span>
        </motion.div>
      ))}
    </div>
  );
}
