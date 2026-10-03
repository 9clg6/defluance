"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import { StatusBadge, TYPE_COLORS, typeColor } from "@/components/badges";
import { notePath } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import type { Subgraph } from "@/lib/types";

const ForceGraph2D = dynamic(() => import("./ForceGraphClient"), { ssr: false });

const EDGE_WIDTH: Record<string, number> = { depends_on: 1.8, implements: 1.8, supersedes: 1.8, blocks: 1.8, tested_by: 1.2, tracked_by: 1.2, related: 0.8 };

interface FNode {
  id: string;
  title: string;
  type: string | null;
  status: string | null;
  x?: number;
  y?: number;
}

/**
 * Force-directed view of notes and their typed links. Colour is the note type, line weight is the link type.
 * The canvas is not readable by screen readers, so the same data is offered as a list.
 */
export function GraphView({ graph, focusId, onOpen, height = 480 }: { graph: Subgraph; focusId?: string | undefined; onOpen: (id: string) => void; height?: number }) {
  const { t, tr } = useT();
  const { dark } = useTheme();
  const wrap = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods>(undefined);
  const [width, setWidth] = useState(640);
  const [list, setList] = useState(false);
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    setReduce(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({ ...n })) as FNode[],
      links: graph.edges.map((e) => ({ source: e.from, target: e.to, type: e.type })),
    }),
    [graph],
  );

  const ink = dark ? "#f5f5f5" : "#171717";
  const edge = dark ? "rgba(163,163,163,0.65)" : "rgba(82,82,82,0.6)";
  const types = [...new Set(graph.nodes.map((n) => n.type ?? "note"))];

  return (
    <div>
      <div ref={wrap} role="img" aria-label={t("graph.label", { nodes: graph.nodes.length, edges: graph.edges.length })} className="overflow-hidden rounded-xl border bg-card" style={{ height }}>
        <ForceGraph2D
          graphRef={graphRef}
          onEngineStop={() => graphRef.current?.zoomToFit(300, 56)}
          graphData={data}
          width={width}
          height={height}
          backgroundColor="rgba(0,0,0,0)"
          nodeRelSize={5}
          warmupTicks={reduce ? 120 : 20}
          cooldownTicks={reduce ? 0 : 120}
          linkColor={() => edge}
          linkWidth={(l) => EDGE_WIDTH[(l as { type: string }).type] ?? 1}
          linkLineDash={(l) => ((l as { type: string }).type === "related" ? [3, 3] : null)}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          onNodeClick={(n) => onOpen((n as FNode).id)}
          nodeLabel={(n) => `${(n as FNode).title} (${(n as FNode).type ?? "note"})`}
          nodeCanvasObject={(n, ctx, scale) => {
            const node = n as FNode;
            const focus = node.id === focusId;
            const r = focus ? 7 : 5;
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
            ctx.fillStyle = typeColor(node.type);
            ctx.fill();
            if (focus) {
              ctx.lineWidth = 2 / scale;
              ctx.strokeStyle = ink;
              ctx.stroke();
            }
            if (scale > 1.1 || focus || data.nodes.length <= 25) {
              ctx.font = `${(focus ? 12 : 10) / Math.min(scale, 1.6)}px sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillStyle = ink;
              ctx.fillText(node.title.length > 28 ? `${node.title.slice(0, 27)}…` : node.title, node.x ?? 0, (node.y ?? 0) + r + 2);
            }
          }}
          nodePointerAreaPaint={(n, color, ctx) => {
            const node = n as FNode;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, 9, 0, 2 * Math.PI);
            ctx.fill();
          }}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {types.map((ty) => (
          <span key={ty} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full" style={{ background: TYPE_COLORS[ty] ?? typeColor(ty) }} aria-hidden />
            {tr("type", ty)}
          </span>
        ))}
        {graph.truncated && <span className="text-warning">{t("graph.truncated")}</span>}
        <button type="button" className="ml-auto underline underline-offset-2 hover:text-foreground" aria-expanded={list} onClick={() => setList((v) => !v)}>
          {list ? t("graph.hideList") : t("graph.showList")}
        </button>
      </div>
      {list && (
        <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2" aria-label={t("graph.listLabel")}>
          {graph.nodes.map((n) => (
            <li key={n.id} className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
              <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: typeColor(n.type) }} aria-hidden />
              <Link href={notePath(n.id)} className="truncate font-medium text-primary underline underline-offset-2">
                {n.title}
              </Link>
              <StatusBadge status={n.status} />
              <span className="ml-auto text-xs text-muted-foreground">
                {graph.edges.filter((e) => e.from === n.id || e.to === n.id).length} {t("graph.links")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
