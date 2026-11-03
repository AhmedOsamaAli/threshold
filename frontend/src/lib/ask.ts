/* The Ask page in plain words and checks: the limits form (its bounds mirror the server's, app/trust/limits.py), the
   conversation as the server reads it, and the limits as the person sees them. Pure, so they are tested without a browser. */
import type { AskAnswer, AskTurn } from "../api/assistant";
import type { BusinessKind } from "../api/founders";
import type { Limits, LimitsRequest } from "../api/trust";
import { moneyText } from "./founders";

export const LIMIT_BOUNDS = { minPledge: 5, maxPledge: 200, maxTotal: 1000, maxCount: 10, maxKm: 100 } as const;
/** What the server reads of a conversation: its last 12 turns, each at most 600 characters. */
export const MAX_TURNS = 12;
export const MAX_CHARS = 600;

export const DURATIONS = [
  { id: "hour", label: "1 hour", days: 1 / 24 },
  { id: "day", label: "1 day", days: 1 },
  { id: "week", label: "1 week", days: 7 },
  { id: "month", label: "30 days", days: 30 },
] as const;
export type DurationId = (typeof DURATIONS)[number]["id"];

export interface LimitsForm {
  maxPledge: string;
  maxTotal: string;
  maxCount: string;
  duration: DurationId;
  kinds: readonly BusinessKind[];
  /** Where the person was when they asked for it; null for no limit on distance. */
  near: { lat: number; lon: number } | null;
  nearKm: string;
}

export const DEFAULT_LIMITS_FORM: LimitsForm = {
  maxPledge: "30",
  maxTotal: "60",
  maxCount: "3",
  duration: "day",
  kinds: [],
  near: null,
  nearKm: "5",
};

/** "30", "$30" or "30.5" as "30.00" or "30.50"; null for anything that is not an amount in dollars and cents. */
export function dollars(text: string): string | null {
  const clean = text.trim().replace(/^\$/, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(clean)) return null;
  return Number(clean).toFixed(2);
}

export type LimitsField = "maxPledge" | "maxTotal" | "maxCount" | "nearKm";

/** What is wrong with the limits as typed, per field, in plain words; empty when nothing is. */
export function limitsProblems(form: LimitsForm): Partial<Record<LimitsField, string>> {
  const problems: Partial<Record<LimitsField, string>> = {};
  const one = dollars(form.maxPledge);
  if (one === null || Number(one) < LIMIT_BOUNDS.minPledge || Number(one) > LIMIT_BOUNDS.maxPledge) {
    problems.maxPledge = `From $${LIMIT_BOUNDS.minPledge} to $${LIMIT_BOUNDS.maxPledge}, in dollars and cents.`;
  }
  const total = dollars(form.maxTotal);
  if (total === null || Number(total) > LIMIT_BOUNDS.maxTotal) {
    problems.maxTotal = `At most $${LIMIT_BOUNDS.maxTotal.toLocaleString("en-US")}, in dollars and cents.`;
  } else if (one !== null && Number(total) < Number(one)) {
    problems.maxTotal = "At least as much as one pledge.";
  }
  const count = Number(form.maxCount);
  if (!Number.isInteger(count) || count < 1 || count > LIMIT_BOUNDS.maxCount) {
    problems.maxCount = `A whole number from 1 to ${LIMIT_BOUNDS.maxCount}.`;
  }
  if (form.near) {
    const km = Number(form.nearKm);
    if (!form.nearKm.trim() || !Number.isFinite(km) || km <= 0 || km > LIMIT_BOUNDS.maxKm) {
      problems.nearKm = `More than 0 and at most ${LIMIT_BOUNDS.maxKm} km.`;
    }
  }
  return problems;
}

/** The request the server takes, or null while the form has a problem. */
export function limitsRequestOf(form: LimitsForm): LimitsRequest | null {
  if (Object.keys(limitsProblems(form)).length) return null;
  const maxPledge = dollars(form.maxPledge);
  const maxTotal = dollars(form.maxTotal);
  const days = DURATIONS.find((duration) => duration.id === form.duration)?.days;
  if (maxPledge === null || maxTotal === null || days === undefined) return null;
  return {
    max_pledge: maxPledge,
    max_total: maxTotal,
    max_count: Number(form.maxCount),
    days,
    ...(form.near ? { near: { lat: form.near.lat, lon: form.near.lon, km: Number(form.nearKm) } } : {}),
    ...(form.kinds.length ? { kinds: [...form.kinds] } : {}),
  };
}

/** "Nov 4, 3:00 PM": when limits end, in the reader's own time. */
export function whenText(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  return when.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The limits as a few plain lines. */
export function limitsLines(limits: Limits): string[] {
  const lines = [
    `Up to ${moneyText(limits.max_pledge)} for one pledge, ${moneyText(limits.max_total)} in all`,
    `At most ${limits.max_count} pledge${limits.max_count === 1 ? "" : "s"}, until ${whenText(limits.expires_at)}`,
  ];
  if (limits.kinds?.length) lines.push(`Only ${limits.kinds.join(", ")}`);
  if (limits.near) lines.push(`Only within ${limits.near.km} km of where you were`);
  return lines;
}

/** What is left of the limits: "$35 of $60 left", once the server has said what is used. */
export function leftText(limits: Limits): string | null {
  if (limits.remaining === undefined) return null;
  return `${moneyText(limits.remaining)} of ${moneyText(limits.max_total)} left`;
}

/** How much of the limits' money is used, from 0 to 1. */
export function usedShare(limits: Limits): number {
  const total = Number(limits.max_total);
  const used = Number(limits.used ?? 0);
  return total > 0 && Number.isFinite(used) ? Math.max(0, Math.min(1, used / total)) : 0;
}

/** One message on the page: the person's, or the assistant's with everything it answered. */
export interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  answer?: AskAnswer;
}

/** The conversation as the server reads it: the last turns, each assistant turn with the campaigns it showed and the
 * one it asked about, so a later "yes" means what it should. */
export function turnsOf(messages: readonly Message[]): AskTurn[] {
  return messages.slice(-MAX_TURNS).map((message) => ({
    role: message.role,
    content: message.content.slice(0, MAX_CHARS),
    ...(message.answer ? { shown: message.answer.shown, asked: message.answer.asked } : {}),
  }));
}

/** What to try first, before the person knows what to ask: each reads the same with or without an AI model. */
export const SUGGESTIONS = [
  "What is open for pledges right now?",
  "A bakery near Williamsburg, Brooklyn",
  "A gym in Logan Square, Chicago under $30",
  "Coffee around East Austin",
] as const;

/** "2.4 km away", "180 m away". */
export function distanceText(km: number): string {
  const metres = Math.round((km * 1000) / 10) * 10;
  if (metres < 1000) return `${Math.max(10, metres)} m away`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`;
}
