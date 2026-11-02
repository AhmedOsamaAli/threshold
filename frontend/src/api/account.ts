/* Accounts: the app's public settings, who is signed in, and the account's own campaigns (the API contract). */
import { post, request } from "./client";
import type { MyCampaign, PayPalConfig } from "./founders";

/** GET /api/config: the web app's public settings, limited to what signing in and pledging need. */
export interface AppConfig {
  google_client_id: string | null;
  /** Development sign-in by email: never on the hosted site. */
  dev_login: boolean;
  /** PayPal for Founders' pledges; a server without it sends none, or `enabled: false`. */
  paypal?: PayPalConfig;
}

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string | null;
}

export interface Me {
  user: User;
}

export const account = {
  config: () => request<AppConfig>("/api/config"),
  /** Never 401: `user` is null when nobody is signed in. */
  me: () => request<{ user: User | null }>("/api/me"),
  signInGoogle: (credential: string) => request<Me>("/api/auth/google", post({ credential })),
  signInDev: (email: string, name: string) => request<Me>("/api/auth/dev", post({ email, name })),
  signOut: () => request<undefined>("/api/auth/logout", post()),
  /** Deletes the account (204). */
  deleteMe: () => request<undefined>("/api/me", { method: "DELETE" }),
  /** GET /api/me/campaigns: the account's Founders campaigns, newest first, at most 100. */
  campaigns: async (signal?: AbortSignal) =>
    (await request<{ campaigns: MyCampaign[] }>("/api/me/campaigns", { signal })).campaigns,
};
