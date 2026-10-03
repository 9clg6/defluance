export const LINK_TYPES = [
  "implements",
  "depends_on",
  "supersedes",
  "tested_by",
  "tracked_by",
  "blocks",
  "related",
] as const;

export type LinkType = (typeof LINK_TYPES)[number];

export const NOTE_STATUSES = ["draft", "review", "approved", "implemented", "deprecated"] as const;

export type NoteStatus = (typeof NOTE_STATUSES)[number];
