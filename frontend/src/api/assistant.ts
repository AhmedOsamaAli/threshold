/* The Ask page's assistant (POST /api/assistant), as docs/CONTRACT.md has it. */
import { LIMITS_HEADER, type Limits } from "./trust";
import { post, request } from "./client";

/** One turn of the conversation, as the page keeps it and sends it back with the next message. */
export interface AskTurn {
  role: "user" | "assistant";
  content: string;
  /** The campaigns an assistant turn put on the page, in order. */
  shown?: string[];
  /** The campaign an assistant turn asked "prepare a pledge for it?" about. */
  asked?: string | null;
}

/** A campaign as the assistant shows it. */
export interface AskCard {
  id: string;
  /** /p/{id} */
  url: string;
  name: string;
  title: string;
  kind: string;
  place: string;
  distance_km: number | null;
  amount: string;
  currency: string;
  goal: number;
  supporters: number;
  deadline: string;
  accepting: boolean;
}

/** A pledge prepared for the person to approve in PayPal. */
export interface PreparedPledge {
  campaign_id: string;
  name: string;
  amount: string;
  currency: string;
  goal: number;
  deadline: string;
  /** PayPal's own approval link. */
  approve_url: string;
  /** The pledge's private receipt: it can withdraw this pledge, so it is the person's alone. */
  receipt: string;
  ref: string;
  terms_hash: string;
  limits: Limits | null;
}

export interface Refusal {
  campaign_id: string;
  code: string;
  detail: string;
}

export interface TraceStep {
  tool: string;
  summary: string;
  ok: boolean;
}

export interface AskAnswer {
  reply: string;
  /** "model": the AI's own words passed the checks; "plain": the answer the tools' facts make, in fixed words. */
  mode: "model" | "plain";
  cards: AskCard[];
  shown: string[];
  asked: string | null;
  pledge: PreparedPledge | null;
  refusal: Refusal | null;
  trace: TraceStep[];
}

export const assistant = {
  /** The person's message is the last of `messages`; `back` is the campaign whose Back it button they pressed. */
  ask: (messages: AskTurn[], limitsToken: string | null, back?: string, signal?: AbortSignal) =>
    request<AskAnswer>("/api/assistant", {
      ...post({ messages: messages.map(wire), ...(back ? { back } : {}) }),
      headers: limitsToken ? { [LIMITS_HEADER]: limitsToken } : {},
      signal,
    }),
};

/** A turn as the server reads it: its own fields only. */
function wire(turn: AskTurn): AskTurn {
  return {
    role: turn.role,
    content: turn.content,
    ...(turn.shown?.length ? { shown: turn.shown } : {}),
    ...(turn.asked ? { asked: turn.asked } : {}),
  };
}
