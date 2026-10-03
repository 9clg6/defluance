"use client";

import ForceGraph2D, { type ForceGraphMethods, type ForceGraphProps } from "react-force-graph-2d";
import type { MutableRefObject } from "react";

/** `next/dynamic` drops refs, so the graph ref travels as a plain prop. */
export default function ForceGraphClient({ graphRef, ...props }: ForceGraphProps & { graphRef: MutableRefObject<ForceGraphMethods | undefined> }) {
  return <ForceGraph2D ref={graphRef as never} {...props} />;
}
