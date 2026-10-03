"use client";

import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { clampSplit, readStoredSplit, SPLIT_DEFAULT, SPLIT_MAX, SPLIT_MIN, splitForKey, storeSplit } from "@/lib/split";

/**
 * The editor (`main`) and, when `side` is given, a second pane with a draggable divider between them. `main` keeps its place in
 * the tree whether `side` is there or not, so the editor behind it is never remounted. Under 900px the panes stack, with no divider.
 */
export function SplitView({ main, side }: { main: ReactNode; side: ReactNode }) {
  const { t } = useT();
  const box = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(readStoredSplit);
  const [dragging, setDragging] = useState(false);

  const move = (n: number) => {
    const v = clampSplit(n);
    setSplit(v);
    storeSplit(v);
  };
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    const r = box.current?.getBoundingClientRect();
    if (dragging && r && r.width > 0) move(((e.clientX - r.left) / r.width) * 100);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = splitForKey(e.key, split);
    if (n === null) return;
    e.preventDefault();
    move(n);
  };

  return (
    <div ref={box} className="flex flex-col gap-4 min-[900px]:flex-row min-[900px]:gap-0" style={{ "--split": `${split}%` } as CSSProperties}>
      <div className={side ? "min-w-0 min-[900px]:w-[var(--split)] min-[900px]:flex-none" : "min-w-0 flex-1"}>{main}</div>
      {side && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("layout.divider")}
          aria-valuenow={Math.round(split)}
          aria-valuemin={SPLIT_MIN}
          aria-valuemax={SPLIT_MAX}
          tabIndex={0}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
          }}
          onPointerMove={drag}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onKeyDown={key}
          onDoubleClick={() => move(SPLIT_DEFAULT)}
          className="group hidden w-4 flex-none cursor-col-resize touch-none select-none justify-center focus-visible:outline-2 focus-visible:outline-[var(--arc-focus-ring)] min-[900px]:flex"
        >
          <span className={`w-0.5 rounded-full transition-colors group-hover:bg-primary group-focus-visible:bg-primary ${dragging ? "bg-primary" : "bg-border"}`} />
        </div>
      )}
      {side && <div className="min-w-0 flex-1">{side}</div>}
    </div>
  );
}
