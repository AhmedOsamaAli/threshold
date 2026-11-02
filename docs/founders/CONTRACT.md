# Walk-in Founders: the contract

**Founders** lets the neighbors back a new place (a cafe, a gym, a bakery) with PayPal before the lease is signed: they
pledge, PayPal only holds the money, and everyone is charged only if enough people join by the deadline. If the goal is
missed, every hold is released and nobody pays.

Every builder codes to this file. If something here cannot work, stop and tell the lead rather than inventing a
different shape. All JSON. Errors are FastAPI's `{"detail": "plain words"}`. Amounts are strings with two decimals
(`"25.00"`), never floats. Times are ISO 8601 UTC strings.

## Product rules

1. **Supporters** pledge with PayPal only, without an account.
2. **Owners** sign in with Google to start a campaign. The campaign belongs to the signed-in user who starts it.
3. **The owner chooses the money terms**: one pledge amount ($5.00–$200.00), the goal in supporters (3–500), the
   deadline (1–27 days away: PayPal holds an authorization for 29 days and settlement keeps 2 of them), an optional
   perk line ("10% off every visit in the first year") and the PayPal email that receives the money.
4. **The AI writes the words**: `draft_offer` drafts the title, pitch, perks and "how it works" from the owner's
   description of the business and the place. The owner edits them; the server re-checks the edited words with the same
   rules (no amounts or prices but the owner's, no counts the evidence does not give, no invented names, no
   "only"/"first" claims the evidence does not support). The AI never sets a number.
5. **A pledge is a PayPal order with intent AUTHORIZE.** On the web the supporter approves in the PayPal buttons (JS SDK
   v6). For an AI assistant (MCP) the server creates the order with return and cancel URLs and hands back PayPal's
   approval link; the supporter approves in PayPal, PayPal sends them to `/p/{id}?pledge={pledgeId}`, and that page
   authorizes it. A held pledge counts toward the goal; a declined one never does. A supporter may withdraw a pledge
   while the campaign is open (the hold is voided).
6. **Closing.** At the deadline, or early by the owner once the goal is met. Funded: capture every valid hold
   (reauthorize first when past PayPal's 3-day honor period). Not funded, or cancelled by the owner: void every hold.
   Settlement is idempotent and resumable: the funded decision is stored before the first capture.
7. **Payout.** Once collected, PayPal Payouts sends the net collected total (after PayPal's fees, from the captures'
   `seller_receivable_breakdown`) to the owner's PayPal email, idempotent per campaign (`sender_batch_id`). The owner
   sees its status. In production this would be PayPal's marketplace onboarding, money straight to the owner; the
   README says so.
8. **Demo payments**, disclosed before a pledge and on relevant receipt, owner-money and poster/report views:
   "Demo payments — no real money." This is presentation only: PayPal stays in its sandbox, technical environment
   values and hostnames remain accurate, and PayPal's native approval window is never masked.
9. **Webhooks**, verified with PayPal's verify-webhook-signature API on the raw body, keep pledges and the payout in
   sync. Unknown or replayed events are acknowledged and ignored.
10. **Agents never touch payment credentials.** They find campaigns and prepare a pledge; a person approves every
    pledge in PayPal.
11. **Private receipts.** Each new pledge gets a random 192-bit receipt token, given once to whoever prepared the
    pledge. Only its SHA-256 digest is stored, never the token. Its bearer may read the pledge or withdraw it while
    the campaign takes pledges, without signing in. The receipt is a cancellation capability, not a payment credential:
    keep it private. Old pledges without a receipt still work through their campaign page.
12. **The owner describes the business.** `/founders/start` is the only way to start a campaign. The owner gives the
    name, kind, description, address and optional why-here line, then sets the money terms. Campaigns say "in the
    owner's words" on the web and through MCP: nothing about the place is presented as measured or verified.
    Every campaign uses the same hold, settlement, withdrawal and payout engine.
13. **One poster.** The same editor serves any campaign. Its actual participation perks lead, with accurate terms and
    a public campaign QR link. Owners may reorder real perks, not invent new ones through the artwork editor.
    The palette, original motif, typography, logo and optional real street locator belong to the particular project.
    The QR's branded frame remains outside a five-module white quiet zone. Exports must preserve all perks and terms;
    overflow blocks export rather than silently cutting them.

## Endpoints

`POST /api/business-campaigns/draft` (signed in) takes the money terms (`amount: "25.00"`, `goal: 40`,
`deadline: "<ISO>"`, `perk: string | null`) plus:
`{ name, kind, description, why_here, address, lat, lon }`. It returns `{ title, pitch, perks: string[], how_it_works,
problems: [] }`; a term that is not allowed is refused with 422 and `problems`, before any model is called.
Names are 2–60 characters, descriptions 8–500, why-here up to 300 and addresses 3–250; coordinates must be finite
and in range. Kinds are cafe, restaurant, bakery, bar, gym, studio, salon, barber, bookstore, shop, grocery, kids,
services or other. A from-scratch campaign has no measured exclusivity claim: "only", "first" and "best" remain
subject to the existing copy rules.

`POST /api/business-campaigns` (signed in) adds `payout_email`, `title`, `pitch` and `perks: string[]` to that body. It
returns `{ id, url: "/p/{id}" }`; 422 with `problems` when a term or an edited line breaks a rule. Both routes check
terms before asking a model; edited words get the same checks as model output.
Unknown fields are refused, drafts are limited per address, and publication is limited to 10 per hour
per signed-in account. `/api/campaigns/{id}` returns `source: "owner"` for these campaigns: what the owner says about
why here is shown as their own words, never as measured evidence.

Payment timing is still the existing 27-day pledge campaign, not an escrow or a verified-opening guarantee. A
production marketplace, platform fees, holding seller funds and automatic full refunds require payment-provider
approval and a funded refund policy; they are not silently enabled by this feature.

`GET /api/config` returns
```ts
{ google_client_id: string | null; dev_login: boolean;
  paypal: { enabled: boolean; client_id: string | null; environment: "sandbox" | "live"; currency: "USD" } }
```
`enabled` is false when PayPal is not configured; the web app then hides pledging and says why.

`GET /api/campaigns/{id}` (anyone) →
```ts
type CampaignStatus = "open" | "funded" | "collected" | "partial" | "expired" | "cancelled";
type Campaign = {
  id: string; status: CampaignStatus; accepting: boolean;   // still takes pledges
  source: "owner";                                          // what the owner says about the place is their own words
  name: string;                                             // the business
  place: { label: string; lat: number; lon: number; area: string };  // the address the owner gave; area is "" unless set
  concept: { genre: string; summary: string };              // the owner's kind and description
  evidence: string[];                                       // the owner's why-here line, if any
  title: string; pitch: string; perks: string[]; how_it_works: string;
  amount: string; currency: "USD"; goal: number; deadline: string; closed_at: string | null;
  progress: { supporters: number; goal: number; remaining: number; percent: number; total: string; funded: boolean };
  // total: what the pledges PayPal holds, or has collected, add up to; a second pledge from one payer adds its money
  // but not another supporter.
  is_owner: boolean;
  owner?: {                                                 // the owner only
    counts: Record<string, number>;                         // pledges by status
    report: string[] | null;                                // the settlement, in plain words, once settled
    payout: { status: "none" | "pending" | "paid" | "failed"; amount: string | null; email: string };  // email masked: "o***@example.com"
  };
};
```

`GET /api/campaigns?lat=&lon=&km=` (anyone; agent-friendly) → open campaigns within `km` (default 25, max 100), nearest
first; without `lat`/`lon`, open campaigns newest first. At most 50:
`{ campaigns: { id, url, title, name, place: {label, lat, lon}, distance_km: number | null, amount, goal, supporters, total, deadline }[] }`.
`total` is what the campaign's held pledges add up to (`"75.00"`), as in `progress.total`.

`POST /api/campaigns/{id}/pledges` (anyone) body `{ flow: "buttons" | "redirect" }` →
`{ order_id, approve_url: string | null, receipt: string }`.
Creates the AUTHORIZE order for the campaign's amount (`custom_id` = our pledge id, description "Founding supporter:
{name}"). `redirect` adds return/cancel URLs (`{PUBLIC_URL}/p/{id}?pledge={pledgeId}` and `?cancelled=1`) and returns
PayPal's approval link. 409 when the campaign no longer accepts pledges. Rate-limited per address.

`POST /api/campaigns/{id}/pledges/{order_id}/authorize` (anyone) → `{ status: "authorized" | "declined", progress }`.
Idempotent. `402 {detail, retry: true}` when PayPal declines the instrument, so the buttons can restart.

`POST /api/campaigns/{id}/pledges/{order_id}/withdraw` (anyone holding the order id, while open) → `{ status: "withdrawn", progress }`.

`GET /api/receipts/{receipt}` (receipt bearer) returns
`{ status, state, explanation, withdrawable, amount, currency, pledged_at, campaign }`.
The campaign includes its public terms and progress, not the owner's panel; no payer identity, email, PayPal order,
authorization, capture id, token or token digest is returned.

`POST /api/receipts/{receipt}/withdraw` (receipt bearer) withdraws exactly that pledge under the same lock and rules as
the campaign route, and returns the receipt's new view. Repeating a withdrawal makes no second PayPal call. A campaign
past its close refuses with 409. Unknown or malformed receipts return 404. Reads are limited to 120 per hour per
address, withdrawals to 20; guesses count too. Every answer, errors included, is `no-store`.

`/r/{receipt}` is the private receipt page. Both it and the API suppress referrers, and the edge never caches receipt
API responses even if an upstream header accidentally permits it. The page carries `noindex, nofollow, noarchive`.
Uvicorn's access logger redacts receipt paths. Operators must also keep raw receipt URLs out of proxy analytics and
other access logs. Do not put receipts in public updates, posters or shared campaign links.

`POST /api/campaigns/{id}/close` (owner) → settles now when funded (or when the deadline has passed) → the campaign.
`POST /api/campaigns/{id}/cancel` (owner, short of the goal) → voids every hold → the campaign.

`POST /api/paypal/webhook` (PayPal; verified) and `POST /api/cron/settle` (header `X-Cron-Secret: CRON_SECRET`) settle
what is due. Both are exempt from the Origin check.

`GET /api/me/campaigns` (signed in; never cached) →
`{ campaigns: { id, title, status, supporters, total, goal, deadline, url }[] }`: the user's campaigns, newest first.

## Pages

- `/p/{id}`: the campaign. Supporter view: the business, the place, why here (in the owner's words),
  the pitch and perks, the progress toward the goal, the deadline, "Pledge $25 with PayPal" (the buttons), and in plain
  words: "PayPal holds $25. You are charged only if 40 neighbors join by Nov 30; otherwise the hold is released."
  After pledging: thanks, the progress, and how to withdraw. Owner view adds the counts, close early (once funded),
  cancel, the settlement report and the payout.
- `/founders`: open campaigns, newest first, and "Start one".
- `/founders/start`: start a campaign (the form, the AI draft, edit, publish). Signed out: "Sign in with Google to
  start one."
- The **window poster**: its QR code opens the campaign and the poster says, from the campaign's own terms (not from
  the model): "PayPal holds $25. You are charged only if 40 neighbors join by Nov 30; otherwise the hold is released."
  Actual participation perks lead.
- `/me` lists the user's campaigns. The top bar links "Founders".

## Schema and release rollback

Startup runs the Alembic chain, which is one baseline revision, `0001_baseline.py`: users, sessions, campaigns, pledges
(with a nullable receipt hash and its unique index), payouts and PayPal's webhook events. Pledges keep only the SHA-256
digest of their receipt.

Take and verify an encrypted database snapshot before deployment. An old application image that lacks a revision file
the database is at cannot start against it: a code rollback must retain the migration chain, or restore a verified
pre-release database snapshot deliberately. Do not downgrade or erase data just to start an old image: the baseline's
downgrade drops every table, receipt hashes and campaigns included. Never silently trade customer records or working
receipt capabilities for a code rollback.

## Content-Security-Policy additions (the server's in `app/main.py`, `frontend/public/_headers`, `vite.config.ts`)

`script-src` and `connect-src` add `https://www.sandbox.paypal.com https://www.paypal.com`; `frame-src` adds
`https://www.sandbox.paypal.com https://www.paypal.com`; `img-src` already allows `https:`. Change all three together.

## Agents (MCP server, `mcp_server/walkin_mcp.py`)

`find_campaigns` (a place or lat/lon, km), `get_campaign` (id or link) and `back_campaign` (id or link): it prepares a
pledge with `flow: "redirect"` and returns the approval link with the terms in plain words. `pledge_status` and
`withdraw_pledge` use the pledge's private receipt. The person approves in PayPal; the agent never sees a card or an
account.

## Who builds what

- **P (payments backend):** `app/payments/**`, `app/settlement.py`, `app/db/campaigns.py`, `app/db/events.py`, the
  campaign, pledge, payout and event tables in `app/db/tables.py` and the migration, `app/routes/campaigns.py`,
  `app/routes/business_campaigns.py`, `app/routes/hooks.py`, `app/config.py`, `app/schemas.py`, the router seam and CSP
  in `app/main.py`, `/api/config` and `/api/me/campaigns` in `app/routes/account.py` and `app/db/accounts.py`,
  `.env.example`,
  `render.yaml`, `.github/workflows/settle.yml`, `docs/founders/sandbox_money_flows.py` and
  `docs/founders/setup_paypal_webhook.py`, and their tests.
- **W (web):** `frontend/**`: the pages, the start form, the poster's campaign QR and line, the top bar link, the
  account page, the PayPal buttons, the CSP in `_headers` and `vite.config.ts`.
- **A (agents):** `mcp_server/**`, `frontend/public/llms.txt` and `docs/founders/agents.md`.
- **Lead:** this file, the README, deployment, the submission.
