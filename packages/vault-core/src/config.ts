import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export interface SpaceConfig {
  name: string;
  /** Folder at the vault root. */
  path: string;
  /** GitHub repos (owner/repo) that notes of this space may open issues in. */
  repos: string[];
}

export interface VaultConfig {
  spaces: SpaceConfig[];
  /** Default repos for notes outside any space. */
  repos: string[];
  /** `branch`: agent writes go to a branch. `direct`: committed on the current branch. */
  agentWriteMode: "branch" | "direct";
  /** A merged pull request moves the notes it tracks from `approved` to `implemented`. */
  deriveStatus: boolean;
  /** Comment on pull requests with the specs they touch. */
  prComments: boolean;
  /** `owner/repo` hosting this vault: a push to it makes the server pull and re-index. */
  vaultRepo: string | null;
  /** Push to `origin` after each commit made by the server. */
  vaultPush: boolean;
}

export const CONFIG_PATH = ".defluance/config.yaml";
export const DEFAULT_SPACE = "default";

export const defaultConfig: VaultConfig = { spaces: [], repos: [], agentWriteMode: "branch", deriveStatus: true, prComments: false, vaultRepo: null, vaultPush: false };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export async function loadConfig(root: string): Promise<VaultConfig> {
  let raw: string;
  try {
    raw = await readFile(join(root, CONFIG_PATH), "utf8");
  } catch {
    return structuredClone(defaultConfig);
  }
  const data = (parseYaml(raw) ?? {}) as Record<string, unknown>;
  const spaces: SpaceConfig[] = [];
  if (Array.isArray(data["spaces"])) {
    for (const s of data["spaces"] as unknown[]) {
      if (typeof s === "string") spaces.push({ name: s, path: s, repos: [] });
      else if (s && typeof s === "object") {
        const o = s as Record<string, unknown>;
        if (typeof o["name"] === "string") {
          spaces.push({ name: o["name"], path: typeof o["path"] === "string" ? o["path"] : o["name"], repos: strings(o["repos"]) });
        }
      }
    }
  }
  return {
    spaces,
    repos: strings(data["repos"]),
    agentWriteMode: data["agent_write_mode"] === "direct" ? "direct" : "branch",
    deriveStatus: data["derive_status"] !== false,
    prComments: data["pr_comments"] === true,
    vaultRepo: typeof data["vault_repo"] === "string" ? data["vault_repo"] : null,
    vaultPush: data["vault_push"] === true,
  };
}

/** Space of a note: the space whose folder is the longest prefix of the id, else `default`. */
export function spaceOf(config: VaultConfig, noteId: string): string {
  let best: SpaceConfig | undefined;
  for (const s of config.spaces) {
    const p = s.path.replace(/^\/+|\/+$/g, "");
    if ((noteId === p || noteId.startsWith(p + "/")) && (!best || p.length > best.path.length)) best = s;
  }
  return best?.name ?? DEFAULT_SPACE;
}

export function reposOf(config: VaultConfig, space: string): string[] {
  return config.spaces.find((s) => s.name === space)?.repos.length
    ? (config.spaces.find((s) => s.name === space)?.repos as string[])
    : config.repos;
}
