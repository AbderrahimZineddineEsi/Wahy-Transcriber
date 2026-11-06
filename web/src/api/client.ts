import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";

/** A request the server answered with an error status (400-599), or that never reached it (status 0). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly method: string,
    readonly endpoint: string,
    readonly detail: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export type RecentRequest = { at: string; method: string; endpoint: string; status: number };
const RECENT_LIMIT = 10;
const recent: RecentRequest[] = [];

/** The last few calls, shown in the error report ("recent actions"). */
export function recentRequests(): RecentRequest[] {
  return [...recent];
}

function remember(method: string, endpoint: string, status: number): void {
  recent.push({ at: new Date().toISOString(), method, endpoint, status });
  if (recent.length > RECENT_LIMIT) recent.shift();
}

/** FastAPI sends {"detail": "text"} or, for a bad body, {"detail": [{"msg": ..., "loc": [...]}, ...]}. */
export function describeDetail(body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (typeof d?.msg === "string" ? `${(d.loc ?? []).join(".")}: ${d.msg}` : JSON.stringify(d)))
      .join("; ");
  }
  return "";
}

const pathOf = (request: Request) => new URL(request.url, "http://localhost").pathname;

// Turning a failed call into a thrown ApiError here means every query and mutation fails the same way,
// and the shell can show one kind of toast for all of them.
const failures: Middleware = {
  async onResponse({ request, response }) {
    remember(request.method, pathOf(request), response.status);
    if (response.ok) return undefined;
    let detail = "";
    try {
      detail = describeDetail(await response.clone().json());
    } catch {
      /* not JSON */
    }
    throw new ApiError(
      detail || `${response.status} ${response.statusText}`.trim(),
      response.status,
      request.method,
      pathOf(request),
      detail,
    );
  },
  onError({ request, error }) {
    remember(request.method, pathOf(request), 0);
    return new ApiError(
      error instanceof Error ? error.message : String(error),
      0,
      request.method,
      pathOf(request),
      "",
    );
  },
};

// `fetch` is looked up on every call (not once here) so a test can replace globalThis.fetch.
export const api = createClient<paths>({ baseUrl: window.location.origin, fetch: (request) => globalThis.fetch(request) });
api.use(failures);

/** Run a call made with `api` and return its data (calls throw ApiError, so a missing body is a bug). */
export async function data<T>(call: Promise<{ data?: T }>): Promise<T> {
  return (await call).data as T;
}
