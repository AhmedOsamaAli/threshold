import { useSyncExternalStore } from "react";
import { ApiError } from "../api/client";
import { trust, type Limits, type LimitsRequest, type MadeLimits } from "../api/trust";
import { plainError } from "../lib/account";

/** Where the limits token is kept: this browser only. It is the person's, and it only ever limits what an assistant may
 * prepare for them; the server checks every pledge against it. */
export const LIMITS_STORAGE_KEY = "dayone-limits";

export interface LimitsState {
  /** The token an assistant presents; null until the person sets limits, and again once they end. */
  token: string | null;
  /** The limits the token carries, with what is used and what is left, once read. */
  limits: Limits | null;
  busy: boolean;
  /** Why the last attempt failed, in plain words. */
  error: string | null;
}

/** The requests the store makes; tests pass stand-ins. */
export interface LimitsApi {
  make: (body: LimitsRequest) => Promise<MadeLimits>;
  read: (token: string, signal?: AbortSignal) => Promise<{ limits: Limits }>;
}

export interface LimitsStore {
  get: () => LimitsState;
  subscribe: (listener: () => void) => () => void;
  /** Sets new limits (they replace any before); resolves to whether it worked. */
  create: (body: LimitsRequest) => Promise<boolean>;
  /** Reads the limits again, with what is used: after a pledge was prepared, say. Limits that ended are dropped. */
  refresh: () => Promise<void>;
  /** The limits as the server gave them after a pledge, without asking again. */
  update: (limits: Limits) => void;
  clear: () => void;
  clearError: () => void;
}

type Keeper = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The codes that say a token will never work again: the person has to set new limits. */
const ENDED = new Set(["limits_invalid", "limits_expired", "limits_required"]);

function codeOf(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body;
  return typeof body === "object" && body !== null && "code" in body && typeof body.code === "string" ? body.code : null;
}

export function createLimitsStore(api: LimitsApi, keeper: Keeper | null): LimitsStore {
  const listeners = new Set<() => void>();
  let kept: string | null = null;
  try {
    kept = keeper?.getItem(LIMITS_STORAGE_KEY) ?? null;
  } catch {
    // A browser that will not keep it still lets the person set limits for this visit.
  }
  let state: LimitsState = { token: kept, limits: null, busy: false, error: null };
  // Each new set of limits, and each clearing, moves this on, so a read that was asked before it never undoes it.
  let generation = 0;

  function set(patch: Partial<LimitsState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  function keep(token: string | null): void {
    try {
      if (token) keeper?.setItem(LIMITS_STORAGE_KEY, token);
      else keeper?.removeItem(LIMITS_STORAGE_KEY);
    } catch {
      // Not kept: the limits last until the page closes.
    }
  }

  async function create(body: LimitsRequest): Promise<boolean> {
    generation += 1;
    set({ busy: true, error: null });
    try {
      const made = await api.make(body);
      keep(made.token);
      set({ token: made.token, limits: made.limits, busy: false });
      return true;
    } catch (error) {
      set({ busy: false, error: plainError(error, "The limits could not be set. Try again.") });
      return false;
    }
  }

  async function refresh(): Promise<void> {
    const token = state.token;
    if (!token) return;
    const asked = generation;
    try {
      const { limits } = await api.read(token);
      if (asked === generation) set({ limits });
    } catch (error) {
      if (asked !== generation) return;
      const code = codeOf(error);
      if (code !== null && ENDED.has(code)) {
        keep(null);
        set({ token: null, limits: null });
      }
      // Any other failure leaves the limits as they were.
    }
  }

  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    create,
    refresh,
    update: (limits) => {
      if (state.token) set({ limits });
    },
    clear: () => {
      generation += 1;
      keep(null);
      set({ token: null, limits: null, error: null });
    },
    clearError: () => {
      if (state.error !== null) set({ error: null });
    },
  };
}

function browserKeeper(): Keeper | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The app's one set of limits. */
export const limits = createLimitsStore({ make: trust.makeLimits, read: trust.readLimits }, browserKeeper());

export function useLimits(): LimitsState {
  return useSyncExternalStore(limits.subscribe, limits.get, limits.get);
}
