import { Badge } from "@/components/ui";
import { useT } from "@/lib/i18n";

const STATUS_TONE: Record<string, "muted" | "primary" | "success" | "warning" | "destructive"> = {
  draft: "muted",
  review: "warning",
  approved: "primary",
  implemented: "success",
  deprecated: "destructive",
};

export function StatusBadge({ status }: { status: string | null }) {
  const { tr } = useT();
  if (!status) return null;
  return <Badge tone={STATUS_TONE[status] ?? "muted"}>{tr("status", status)}</Badge>;
}

export function TypeBadge({ type }: { type: string | null }) {
  const { tr } = useT();
  if (!type) return null;
  return <Badge tone="primary">{tr("type", type)}</Badge>;
}

/** One colour per note type, readable on both themes. Used by the graph and its legend. */
export const TYPE_COLORS: Record<string, string> = {
  "functional-spec": "#7c5cff",
  "technical-spec": "#0ea5e9",
  adr: "#f59e0b",
  note: "#94a3b8",
  glossary: "#14b8a6",
  component: "#ec4899",
};
export const typeColor = (t: string | null) => TYPE_COLORS[t ?? ""] ?? "#94a3b8";
