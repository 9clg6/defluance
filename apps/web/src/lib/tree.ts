import type { NoteSummary } from "@/lib/types";

export interface VaultNode {
  /** `dir:<path>` for a folder, `note:<id>` for a note: the two never collide. */
  id: string;
  label: string;
  children?: VaultNode[];
  private?: boolean;
}

/** Notes as a tree of folders, folders first. A filter keeps the notes whose id or title matches and lists the folders to open. */
export function buildTree(notes: NoteSummary[], filter = ""): { nodes: VaultNode[]; open: string[] } {
  const needle = filter.trim().toLowerCase();
  const root: VaultNode[] = [];
  const dirs = new Map<string, VaultNode>();
  const open = new Set<string>();
  for (const n of [...notes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (needle && !n.id.toLowerCase().includes(needle) && !n.title.toLowerCase().includes(needle)) continue;
    const parts = n.id.split("/");
    let siblings = root;
    let path = "";
    for (const part of parts.slice(0, -1)) {
      path = path ? `${path}/${part}` : part;
      let dir = dirs.get(path);
      if (!dir) {
        dir = { id: `dir:${path}`, label: part, children: [] };
        dirs.set(path, dir);
        siblings.push(dir);
      }
      if (needle) open.add(dir.id);
      siblings = dir.children as VaultNode[];
    }
    // a locked private note only has its file name to show
    siblings.push({ id: `note:${n.id}`, label: n.private && n.locked ? (parts.at(-1) ?? n.id) : n.title, ...(n.private ? { private: true } : {}) });
  }
  const order = (nodes: VaultNode[]) => {
    nodes.sort((a, b) => Number(!!b.children) - Number(!!a.children));
    for (const n of nodes) if (n.children) order(n.children);
  };
  order(root);
  return { nodes: root, open: [...open] };
}
