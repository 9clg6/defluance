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
  return <Badge tone="muted">{tr("type", type)}</Badge>;
}

/** One colour per note type, readable on both themes. Used by the graph and its legend. */
export const TYPE_COLORS: Record<string, string> = {
  "functional-spec": "#2563eb",
  "technical-spec": "#ea580c",
  adr: "#dc2626",
  note: "#737373",
  glossary: "#0d9488",
  component: "#ca8a04",
};
export const typeColor = (t: string | null) => TYPE_COLORS[t ?? ""] ?? "#737373";
