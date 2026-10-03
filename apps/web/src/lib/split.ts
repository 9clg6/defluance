// The editor/preview split of the note page: how wide the editor is (in %), and the choices kept in this browser.

export const SPLIT_MIN = 25;
export const SPLIT_MAX = 75;
export const SPLIT_DEFAULT = 50;
export const SPLIT_STEP = 2;

/** Keep the editor's share between the minimum and maximum (25% per side). */
export function clampSplit(n: number): number {
  return Number.isFinite(n) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, n)) : SPLIT_DEFAULT;
}

/** The stored width: anything that is not a number falls back to 50. */
export function parseSplit(raw: string | null): number {
  return raw === null || raw.trim() === "" ? SPLIT_DEFAULT : clampSplit(Number(raw));
}

/** The stored choice of the Preview button: undefined when the person never chose (the default then follows Markdown source). */
export function parseSide(raw: string | null): boolean | undefined {
  return raw === "on" ? true : raw === "off" ? false : undefined;
}

/** The split after a key press on the divider, or null for a key it does not handle. */
export function splitForKey(key: string, current: number): number | null {
  if (key === "ArrowLeft") return clampSplit(current - SPLIT_STEP);
  if (key === "ArrowRight") return clampSplit(current + SPLIT_STEP);
  if (key === "Home") return SPLIT_MIN;
  if (key === "End") return SPLIT_MAX;
  return null;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // the choice lasts for this page only
  }
}

const SPLIT_KEY = "dfl-split";
const SIDE_KEY = "dfl-side-preview";

export const readStoredSplit = () => parseSplit(read(SPLIT_KEY));
export const storeSplit = (n: number) => write(SPLIT_KEY, String(Math.round(n * 10) / 10));
export const readStoredSide = () => parseSide(read(SIDE_KEY));
export const storeSide = (on: boolean) => write(SIDE_KEY, on ? "on" : "off");
