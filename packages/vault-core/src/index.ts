import type { LinkType } from "@defluance/shared";

/** Edge between two notes. Filled by the parser (STORY-002). */
export interface Link {
  target: string;
  type: LinkType;
}
