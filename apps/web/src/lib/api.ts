export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const UNAUTHORIZED_EVENT = "dfl:unauthorized";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
  let problem: { title?: string; detail?: string; errors?: unknown; [k: string]: unknown } = {};
  try {
    problem = await res.json();
  } catch {
    // not JSON
  }
  if (res.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  const { title, ...extra } = problem;
  throw new ApiError(res.status, title ?? res.statusText, extra);
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export const qs = (params: Record<string, string | number | undefined | null>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};

/** `/api/v1/notes/specs%2Fauth` */
export const noteApi = (id: string) => `/api/v1/notes/${encodeURIComponent(id)}`;

/** `/n/specs/auth` */
export const notePath = (id: string, heading?: string | null) =>
  `/n/${id.split("/").map(encodeURIComponent).join("/")}${heading ? `#${slugify(heading)}` : ""}`;

/** Note id from a pathname such as `/n/specs/auth/`. */
export function idFromPath(pathname: string): string {
  const rest = pathname.replace(/^\/n\/?/, "").replace(/\/+$/, "");
  return rest
    .split("/")
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join("/");
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

export const errorMessage = (e: unknown): string => {
  if (e instanceof ApiError) {
    const errs = e.extra["errors"];
    if (Array.isArray(errs) && errs.length) return `${e.message}: ${errs.map((x: { message?: string }) => x.message ?? "").filter(Boolean).join("; ")}`;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
};
