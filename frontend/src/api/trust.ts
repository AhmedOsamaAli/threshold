/* What a person can check: the limits they give an assistant, the service's public key and a campaign's proof, as
   docs/CONTRACT.md has them. Amounts are strings with two decimals ("25.00"), times ISO 8601 in UTC. */
import { post, request } from "./client";
import type { BusinessKind, CampaignStatus } from "./founders";

/** The header an assistant presents the limits in. */
export const LIMITS_HEADER = "X-Limits";

export interface Near {
  lat: number;
  lon: number;
  km: number;
}

/** The limits as the person sees them; `used`, `remaining` and `pledges` come with GET /api/limits. */
export interface Limits {
  currency: string;
  max_pledge: string;
  max_total: string;
  max_count: number;
  near: Near | null;
  kinds: BusinessKind[] | null;
  expires_at: string;
  used?: string;
  remaining?: string;
  pledges?: number;
}

/** POST /api/limits: what the person chooses. */
export interface LimitsRequest {
  max_pledge: string;
  max_total: string;
  max_count: number;
  /** How long the limits last, in days (1/24 to 30). */
  days: number;
  near?: Near;
  kinds?: BusinessKind[];
}

export interface MadeLimits {
  token: string;
  header: string;
  limits: Limits;
}

export type PledgeState = "created" | "authorized" | "declined" | "captured" | "voided" | "withdrawn" | "expired" | "failed" | "refunded";
export type Check = "valid" | "invalid" | "missing";
export type PaypalCheck = "matches" | "differs" | "unavailable" | "not_checked";

export interface ProofPledge {
  /** A short public reference: never the pledge's id, which can withdraw it. */
  ref: string;
  how: "assistant" | "page";
  state: PledgeState;
  amount: string;
  held_at: string | null;
  ids: { authorization: string | null; capture: string | null };
  signed: { terms_hash: string | null; signature: string | null };
  checks: {
    signature: Check;
    hash: Check;
    unchanged: boolean | null;
    paypal: PaypalCheck;
    invoice: boolean | null;
    amount: boolean | null;
  };
  /** What differs, in plain words. */
  problems: string[];
  /** true: all that could be checked agrees; false: something differs; null: unconfirmed. */
  verified: boolean | null;
}

export interface ProofTerms {
  v: number;
  campaign: string;
  business: string;
  title: string;
  amount: string;
  currency: string;
  goal: number;
  deadline: string;
  perk: string | null;
  how_it_works: string;
  /** A fingerprint of the owner's PayPal email, never the address. */
  payee: string;
}

export interface ProofPayout {
  status: "pending" | "paid" | "failed";
  amount: string;
  batch: string | null;
  item: string | null;
  check: PaypalCheck;
  paypal?: string;
}

/** GET /api/campaigns/{id}/proof: the campaign's record, checked against PayPal. */
export interface Proof {
  campaign: {
    id: string;
    title: string;
    business: string;
    status: CampaignStatus;
    amount: string;
    currency: string;
    goal: number;
    deadline: string;
  };
  terms: ProofTerms;
  terms_hash: string;
  key: { jwks: string; kid: string; persistent: boolean };
  paypal_environment: "sandbox" | "live";
  checked_at: string;
  summary: { listed: number; verified: number; differs: number; unconfirmed: number; prepared: number };
  pledges: ProofPledge[];
  outcome: {
    status: CampaignStatus;
    funded: boolean | null;
    held: number;
    released: number;
    collected: { count: number; gross: string; fee: string | null; net: string | null } | null;
    payout: ProofPayout | null;
  };
}

export const trust = {
  /** Mints limits for an assistant: the token goes in X-Limits with every pledge it prepares. */
  makeLimits: (body: LimitsRequest) => request<MadeLimits>("/api/limits", post(body)),
  /** The limits a token carries, and what is already prepared or held under it. */
  readLimits: (token: string, signal?: AbortSignal) =>
    request<{ limits: Limits }>("/api/limits", { headers: { [LIMITS_HEADER]: token }, signal }),
  proof: (campaignId: string, signal?: AbortSignal) =>
    request<Proof>(`/api/campaigns/${encodeURIComponent(campaignId)}/proof`, { signal }),
};
