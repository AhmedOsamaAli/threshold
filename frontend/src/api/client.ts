export class ApiError extends Error {
  readonly status: number;
  /** Whether `message` is the server's own words rather than a sentence about the status. */
  readonly explained: boolean;
  /** The answer's JSON, for what an endpoint sends beside `detail` (a campaign's `problems` or `retry`). */
  readonly body: unknown;

  constructor(message: string, status: number, explained = false, body: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.explained = explained;
    this.body = body;
  }
}

function detailOf(body: unknown): string | null {
  return typeof body === "object" && body !== null && "detail" in body && typeof body.detail === "string" ? body.detail : null;
}

/** The failed response as an error: the server's own `detail` message when it sent one, else a sentence about the status. */
async function apiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: describe the status instead.
  }
  const detail = detailOf(body);
  const message =
    detail ?? (response.status === 429 ? "Too many requests. Try again in a while." : `Request failed (${response.status}).`);
  return new ApiError(message, response.status, detail !== null, body);
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function query(params: Record<string, string | number>): string {
  return new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
}

/* ---------- The engine's naps ---------- */

/*
 * Render's free plan puts the backend to sleep after 15 quiet minutes, and it takes up to a minute to wake. Meanwhile
 * the front door (functions/api) answers 503 {"waking": true} with a Retry-After, and requests wait that out instead of
 * failing: for up to two minutes in all.
 */
export const WAKE_BUDGET_MS = 120_000;
const RETRY_DEFAULT_MS = 3000;
const RETRY_MAX_MS = 15_000;
export const ENGINE_ASLEEP = "The server did not wake up in time. Try again in a minute.";

/** The answer's Retry-After in milliseconds, given in seconds or as a date: 1 to 15 s, or 3 s when it gives none. */
export function retryAfterMs(response: Response, now = Date.now()): number {
  const value = response.headers.get("retry-after")?.trim() ?? "";
  const ms = /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.min(RETRY_MAX_MS, Math.max(1000, ms)) : RETRY_DEFAULT_MS;
}

/** Whether the answer is the front door's "the engine is waking": a 503 whose JSON says `waking: true`. */
export async function isWaking(response: Response): Promise<boolean> {
  if (response.status !== 503) return false;
  try {
    const body: unknown = await response.clone().json();
    return typeof body === "object" && body !== null && "waking" in body && body.waking === true;
  } catch {
    return false;
  }
}

/**
 * Whether the front door answered from a copy it keeps at the edge (functions/_lib/cache.ts), without the backend: such
 * an answer says nothing about whether the engine is up.
 */
export function fromEdge(response: Response): boolean {
  const cached = response.headers.get("x-threshold-cache");
  return cached === "hit" || cached === "stale";
}

/** Resolves true after `ms`, or false as soon as the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal | null): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const cancel = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve(true);
    }, ms);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

/** Told as requests go out, as the backend answers them and when it turns out to be napping (state/engine.ts). */
export interface EngineWatcher {
  asking: () => void;
  answered: () => void;
  waking: () => void;
}

const watchers = new Set<EngineWatcher>();

export function watchEngine(watcher: EngineWatcher): () => void {
  watchers.add(watcher);
  return () => {
    watchers.delete(watcher);
  };
}

function tell(news: keyof EngineWatcher): void {
  for (const watcher of watchers) watcher[news]();
}

/** What waiting for the engine uses; tests pass stand-ins. */
export interface WakeDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal | null) => Promise<boolean>;
}

const WAKE_DEPS: WakeDeps = { fetch: (input, init) => fetch(input, init), now: () => Date.now(), sleep };

/**
 * fetch, sleeping through the engine's naps: a 503 {"waking": true} is asked again after its Retry-After, for up to
 * WAKE_BUDGET_MS in all, and then fails with ENGINE_ASLEEP. Aborting the request's signal stops the waiting too.
 */
export async function fetchAwake(input: string, init: RequestInit = {}, deps: WakeDeps = WAKE_DEPS): Promise<Response> {
  const started = deps.now();
  tell("asking");
  for (;;) {
    const response = await deps.fetch(input, init);
    if (!(await isWaking(response))) {
      if (response.status < 500 && !fromEdge(response)) tell("answered");
      return response;
    }
    const wait = retryAfterMs(response, deps.now());
    if (deps.now() + wait - started > WAKE_BUDGET_MS) throw new ApiError(ENGINE_ASLEEP, 503, true);
    // Only a request that will wait says so: one giving up must not start the note again after the engine gave up.
    tell("waking");
    if (!(await deps.sleep(wait, init.signal))) throw new DOMException("The request was aborted.", "AbortError");
  }
}

/** One look at the engine, without waiting through a nap: up, napping (the front door says so), or no answer. */
export type EngineProbe = "ready" | "waking" | "down";

export async function probeEngine(signal: AbortSignal, deps: Pick<WakeDeps, "fetch"> = WAKE_DEPS): Promise<EngineProbe> {
  try {
    const response = await deps.fetch("/api/health", { signal, cache: "no-store", headers: { Accept: "application/json" } });
    if (response.ok) return "ready";
    return (await isWaking(response)) ? "waking" : "down";
  } catch {
    return "down";
  }
}

/** What a request may carry beyond fetch's own options: headers as plain text, such as the person's limits. */
export type RequestOptions = Omit<RequestInit, "headers"> & { headers?: Record<string, string> };

/** A JSON request; an answer without a body (204, or a 202 that says nothing) resolves to undefined. */
export async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...init.headers };
  if (init.body) headers["Content-Type"] = "application/json";
  const response = await fetchAwake(path, { ...init, headers });
  if (!response.ok) throw await apiError(response);
  const text = response.status === 204 ? "" : await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function post(body?: unknown): RequestOptions {
  return body === undefined ? { method: "POST" } : { method: "POST", body: JSON.stringify(body) };
}

/** A match for an address search (GET /api/geocode). */
export interface GeocodeResult {
  label: string | null;
  lat: number;
  lon: number;
}

export const api = {
  /** Address search: the matches for what was typed, as they are labelled. */
  geocode: (text: string) => request<GeocodeResult[]>(`/api/geocode?${query({ q: text })}`),
};
