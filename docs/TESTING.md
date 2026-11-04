# Testing Threshold

This page walks a judge through Threshold on the live site: look around, pledge as a neighbor with PayPal's sandbox,
check the proof, ask the assistant, check a spot, withdraw, start a campaign as an owner, fund it, close it and collect,
cancel, and back a campaign from another AI assistant. The web path takes about 15 minutes; the MCP path needs Python and
an MCP client. How it works is in the [README](../README.md), the product rules and API in [CONTRACT.md](CONTRACT.md).

Live: https://threshold-pledge.pages.dev (pages `/browse`, `/ask`, `/spot`, `/start`, `/p/{id}` for a campaign and
`/proof/{id}` for its proof).

The whole flow is also run end to end against PayPal's sandbox by [`scripts/e2e.py`](../scripts/e2e.py): the assistant
prepares a pledge, three sandbox buyers approve in PayPal, the proof verifies every pledge against PayPal, the owner closes
the campaign, it is collected and paid out, and a second campaign is cancelled and its holds released.

## Before you start

- **Test mode.** Threshold runs on PayPal's sandbox, PayPal's test environment. Its accounts are test accounts with test
  balances: no real money moves, and nothing reaches a card or a bank. Screens that show money say so, and
  `GET /api/config` says `"environment": "sandbox"`. Never use a real card or a real PayPal account here. **The campaigns
  you see on the live site are fictional**: made-up businesses, to give you something to pledge to.
- **Logins.**
  - Neighbors: PayPal sandbox personal accounts. Judges find three in the submission's testing instructions on Devpost
    (they are kept out of this public page, so nobody can lock them). To make your own: log in at
    [developer.paypal.com](https://developer.paypal.com/dashboard/), open **Testing Tools > Sandbox Accounts**, press
    **Create account**, and choose **Personal** and **United States**; **View/edit account** shows its email and
    password. A goal counts different PayPal accounts, and the smallest goal is 3, so a funded campaign (section 7)
    takes three.
  - Owner: your own Google account. Threshold keeps its email, name and picture link to show that you are signed in;
    deleting your account on the account page (`/me`) removes them.
- **The wake.** The backend runs on Render's free tier and sleeps when idle. The first visit after a quiet spell can take
  about a minute: the page says the server is waking and tries again by itself. The pages the Cloudflare front door
  serves itself still open meanwhile.
- **Two windows.** Be the owner in your normal window, signed in. Be the neighbor in a private (incognito) window, signed
  out: on your own campaign's page you see a preview instead of PayPal's button.
- **Pop-ups.** PayPal opens in a pop-up, or in its own modal where pop-ups are blocked. A content blocker that blocks
  paypal.com stops the button; the page then says "PayPal could not load".

## 1. Look around

No login needed. The bar at the top has the product's three places as tabs, **Browse**, **Ask** and **Check a spot**; the tab of
the page you are on is filled in yellow. (Below 980 px wide, so on a phone, the tabs are a row of their own under the logo.)
**Start a campaign** is the blue button beside them, not a tab; it says its whole phrase on every screen, and on a phone (below
420 px) "Sign in" becomes a person icon to make room for it.

1. **Home** (`/`) says what Threshold is and shows it: a short animation of the money moving (pledges into PayPal's hold, then
   collected and paid when the goal is met, or released when it is missed; **Pause** stops it, and it stands still for anyone
   who asked their system for less motion), one campaign that is open now, how a pledge works, an example of an assistant's
   limits, and the proof of a real test run (open it to see three verified pledges, the collection and the payout).
2. **Browse** (`/browse`) puts the open campaigns on a street map, each a price tag at its address, and lists them below,
   newest first; pointing at one lights the other. Press **Show the nearest to me** to sort by distance (your location is asked
   for only when you press it, and only used to sort).
3. Open a campaign. The page shows the business and the place, why here (in the owner's words, not verified), **Where it
   will be** (the street map of its address with its nearest neighbours of the same kind), the pitch and perks, the progress
   toward the goal, the deadline, and the terms in plain words: "PayPal holds $25. You are charged only
   if 40 neighbors join by Nov 30; otherwise the hold is released."
4. Under the terms, **See the proof** opens the campaign's proof, which begins with four steps (pledged, held by PayPal,
   collected or released, paid out) showing where the campaign is. A campaign with no pledges yet says so; you will come back
   to it after a pledge (section 2).

## 2. Pledge as a neighbor

1. Open a campaign in a private window. The card beside the pitch reads "0 of N neighbors", "Held by PayPal so far: $0",
   "Pledge $N with PayPal", then PayPal's button.
2. Press PayPal's button. Log in as the first sandbox neighbor and approve. Approving places a hold, not a charge: the order
   asks PayPal for a "Continue" button rather than "Pay Now".
3. Back on the page: "Placing the hold with PayPal…", then "Your pledge is held". The count reads 1 of N and "Held by PayPal
   so far" shows the amount.
4. **Check it.** Open **See the proof**. The pledge appears by a short reference, with a verdict of **Verified** and the
   checks behind it: the signature and the terms' fingerprint match, the terms are unchanged since the pledge, and PayPal's
   own record agrees (its state, its order carrying the fingerprint, the amount). The page names no one.
5. To see a pledge abandoned: press PayPal's button and close PayPal without approving. The page says "You left PayPal
   before approving, so nothing is held."

At PayPal: pressing the button made the server create an Orders v2 order with intent `AUTHORIZE` (its `custom_id` is the
pledge's id and its `invoice_id` carries the signed terms' fingerprint). Approving let the server authorize it: a hold on
the buyer's sandbox account, valid for 29 days. Nothing is captured yet.

## 3. Ask the assistant

The assistant finds campaigns and prepares a pledge, **inside limits you set**. Only you can approve it, in PayPal.

1. Open **Ask** (`/ask`). Above the conversation, set your limits: the most for one pledge and in all, how many, for how
   long, optionally which kinds of place and how near. Press **Set my limits**. The page then shows what is left of them.
2. Ask "What is open for pledges right now?" (or press the suggestion). Cards appear with where each campaign is, how far
   along it is, and **Back it**.
3. Press **Back it** on a campaign. The assistant prepares a pledge and shows it: PayPal's own approval link, the terms in
   plain words, that it is **not approved yet** and that only you can approve it, the signed reference, a link to the proof
   and your private receipt.
4. Open the link, log in as a sandbox buyer and approve. PayPal brings you back to the campaign's page, which places the
   hold ("Your pledge is held"). Back on **Ask**, your limits show what is left.
5. **Try to go past your limits.** Press **Change**, set the most for one pledge to `5`, and ask the assistant to back a
   campaign whose pledge is more. The server refuses in plain words (for example "This pledge is 10.00 USD and the limit
   for one pledge is 5.00 USD."), and nothing is created at PayPal. The model cannot change this: it never sees your limits'
   numbers and has no tool that touches them.
6. **Try consent.** Say "A bakery near Williamsburg, Brooklyn". The assistant finds the campaign and *asks*: "Do you want me
   to prepare a pledge for Rye & Rise Bakery?" Answer "I might back it if it has perks": it prepares nothing, because a
   question, a hesitation or a condition is not consent. A bare "yes" counts only right after it asked about a campaign;
   on its own it prepares nothing. Press **Back it** on a card, or say "yes" right after it asks, to prepare the pledge.

Without a model key (or when the model is resting), the assistant answers in fixed words from the same facts. The page
labels each answer: "AI wording, checked by the server" or "Plain answer from the server".

## 4. Check a spot

1. Open **Check a spot** (`/spot`), press an example (for example `cafe · Zamalek, Cairo`) or type an address, pick a kind
   of business and press the button.
2. It shows what OpenStreetMap lists within a 10-minute walk on a real street map: the walking area in blue, a numbered pin
   for each place of that kind (22 cafés in Zamalek), the same places in a list beside it, and what else is around. It shows
   supply, never demand, and says that OpenStreetMap is volunteers' work and can be incomplete.
3. Point at a number on the map or a row in the list: both light up and a small card appears. Press one: its card shows how
   far it is and how long on foot, its opening hours, address, phone and website when OpenStreetMap has them, and two links
   that open in a new tab: **Open it on OpenStreetMap** and **Ratings and photos on Google Maps** (OpenStreetMap has no
   ratings or photos, and the card says so). Press Esc to close it. Zoom in on the map to see every number.
4. A check waits at most 45 seconds. When the map data or the routing service does not answer, it says so and shows no
   numbers rather than guessing; ask again a minute later. If the street map cannot load, a plain plan of the walk takes
   its place and the list still works.
5. On a campaign's page, **Where it will be** shows the same map of its address with its nearest neighbours of the same
   kind; on **Browse**, every open campaign is a price tag on a map, lit together with its card in the list.

## 5. Withdraw

1. In the private window, on the campaign's page, press **Withdraw my pledge**, then confirm. The dialog says PayPal
   releases the hold, so nothing is charged.
2. The page says the pledge is withdrawn and the count goes back down. Open **See the proof**: the pledge now reads
   **Withdrawn**.

At PayPal: the server voided the authorization. Withdrawing works while the campaign is open, from the browser that pledged
(or with the private receipt link, from anywhere).

## 6. Start a campaign (owner)

1. Open `/start`. Signed out, it asks you to sign in with Google first. Sign in.
2. **The business.** Describe it: the name (`Crumb Theory`), the kind (`bakery`), what it is in a sentence or two, the
   address (search for it and pick a match), and, if you like, why this place.
3. **Your terms.** Fill in:
   - Each neighbor pledges: `5`
   - Neighbors needed: `3`
   - Deadline: any day 1 to 27 days away (the hint shows your time zone)
   - PayPal email for the money: a sandbox account's email, such as the first sandbox neighbor's, so the test payout has
     somewhere to go
   - Founding-supporter perk (optional): `10% off every visit in the first year`

   Try a term the rules refuse: Neighbors needed `2` is refused with "Pick a goal from 3 to 500 supporters." Set it back
   to `3`.
4. Press **Draft with AI**. A title, a pitch, the perks (yours first, word for word) and "how it works" appear. Your numbers
   are unchanged: the AI writes words, never the amount, the goal, the deadline or the perk. When no model answers in time,
   the rules write the draft instead, and the page looks the same.
5. **Try the rules.** Each of these comes back under "Not published yet" when you press **Publish the campaign**, and
   nothing is published:
   - Change the title to `The best place on the block`: the title says "best", which nothing measured proves.
   - Change a perk to `A $5 pledge`: it only restates the pledge.

   Put your own title and perks back.
6. Press **Publish the campaign**. The campaign's page opens at `/p/{id}` with your panel, the link under **Share this
   page**, and the window poster with its QR code to the page.

## 7. Fund it, close it, collect and pay out (owner)

This needs three different sandbox buyers: one PayPal account counts once, however many times it pledges.

1. Pledge three times, with a different sandbox neighbor each time. Between pledges, close every private window (they share
   one session while any is open) or use another browser: the page remembers the pledge made from a browser and shows it in
   place of PayPal's button. The count reaches 3 of 3 and reads "Goal met"; PayPal holds $15.
2. In the owner's window, reload. The panel offers **Close and collect**. Press it, and the dialog says PayPal collects
   every held pledge now and that the total, after PayPal's fees, goes to your masked email. Confirm.
3. The campaign settles: PayPal captures every hold, and PayPal Payouts sends the net total to the owner's PayPal email.
   The panel shows the gross, PayPal's fee and the net, and the payout's status.
4. Open **See the proof**. Each pledge reads **Collected**, the outcome lines say how much was collected and paid out, and
   PayPal's own payout batch is checked against ours ("PayPal's batch agrees").

## 8. Cancel (owner)

1. Start a second campaign as in section 6, and pledge once as a neighbor.
2. As the owner, press **Cancel and release every hold**, then confirm.
3. The panel says every hold is released and nobody pays. A neighbor reads that the owner cancelled it, so every hold was
   released.

While a campaign is short of its goal, **Close and collect** is not offered; once the goal is met, only **Close and
collect** is. At the deadline, a campaign short of its goal expires and every hold is voided. The server's own settlement
pass runs every 30 minutes while it is awake (and a scheduled job can wake it), so this happens soon after the
deadline; until then the owner sees **Settle now**, which settles at once.

## 9. From another AI assistant (MCP)

Threshold's MCP server lets any assistant find a campaign, explain it, check its proof and prepare a pledge **inside your
limits**. You approve the pledge in PayPal; the assistant never sees a card, a login or an email.

1. Clone the repository, install Python 3.10 or newer, then the server's requirements:

   ```bash
   git clone https://github.com/AhmedOsamaAli/threshold
   pip install -r threshold/mcp_server/requirements.txt
   ```

2. On **Ask**, set your limits, open **Use these limits with another assistant** and copy the token.
3. Point your assistant at the server with the token as `THRESHOLD_LIMITS`. The config for Claude Desktop and VS Code is in
   [mcp_server/README.md](../mcp_server/README.md#client-config). To try the tools by hand instead, run the MCP Inspector:

   ```bash
   npx @modelcontextprotocol/inspector -e THRESHOLD_LIMITS=<your token> python threshold/mcp_server/threshold_mcp.py
   ```

4. Ask, in turn:
   - "Which Threshold campaigns are open right now?" (`find_campaigns`).
   - "Tell me about the first one: why there, and what do I get?" (`get_campaign`).
   - "Is it real? Check its proof." (`check_proof`).
   - "Back it for me." (`back_campaign`).
5. The assistant answers with PayPal's sandbox link (`https://www.sandbox.paypal.com/…`), the terms, the signed reference
   and what is left of your limits. Open the link, log in as a sandbox buyer and approve. PayPal brings you back to the
   campaign's page, which places the hold.

What to check: the assistant never asks for a card, a PayPal login or an email; the link is PayPal's own; nothing is held
until you approve in PayPal; a pledge outside your limits is refused by the server, in its words; and the terms it quotes
match the campaign's page. The first call after a quiet spell may wait about a minute while the server wakes; the tools
send progress meanwhile.

## 10. Without a browser: the public API

```bash
curl https://threshold-pledge.pages.dev/api/config
curl https://threshold-pledge.pages.dev/api/campaigns
curl https://threshold-pledge.pages.dev/api/campaigns/{id}
curl https://threshold-pledge.pages.dev/api/campaigns/{id}/proof
curl https://threshold-pledge.pages.dev/api/keys
curl "https://threshold-pledge.pages.dev/api/spot?kind=cafe&address=Zamalek,%20Cairo"
```

`/api/config` says whether pledging is on (`"paypal": {"enabled": true, "environment": "sandbox", …}`). The campaign answers
carry `Cache-Control: no-store`: they change with every pledge. `/api/keys` is the public key that signed the terms: you can
verify a pledge's signature yourself. The endpoints are in [CONTRACT.md](CONTRACT.md).

## What each step does at PayPal

| You | The server calls PayPal | Code |
|---|---|---|
| Press PayPal's button, **Back it**, or ask another assistant to back a campaign | `POST /v2/checkout/orders` (intent `AUTHORIZE`) | `prepare_pledge` in [app/routes/campaigns.py](../app/routes/campaigns.py) |
| Approve in PayPal | `POST /v2/checkout/orders/{id}/authorize` | `hold_pledge`, same file |
| Withdraw | `POST /v2/payments/authorizations/{id}/void` | `withdraw_pledge`, same file |
| Close and collect | `reauthorize` past day 3, `capture`, then `POST /v1/payments/payouts` | [app/settlement.py](../app/settlement.py), [app/payments/pledges.py](../app/payments/pledges.py) |
| Cancel, or miss the goal | `void` for every hold | the same |
| Open a proof | `GET` each pledge's order, authorization and capture, and the payout batch | [app/trust/proof.py](../app/trust/proof.py) |
| (PayPal) a webhook arrives | `POST /v1/notifications/verify-webhook-signature` | [app/routes/hooks.py](../app/routes/hooks.py) |

## If something goes wrong

- **The page says the server is waking**: wait about a minute; the page tries again by itself.
- **"Pledging is off on this server"**: the server has no PayPal keys or no signing key, so nothing can be pledged. If the
  live site says it, please tell us on the project's Devpost page.
- **"PayPal could not load"**: a blocker stops paypal.com, or the connection dropped. Allow paypal.com and press "Try
  again".
- **"PayPal declined that payment method"** (or "that way to pay"): nothing is held. Press PayPal's button again and choose
  another way to pay.
- **"This campaign no longer takes pledges"**: its deadline passed, or its owner closed it.
- **The assistant refuses a pledge**: that is the limits doing their job. Change them on **Ask** if you want to.
- **A proof says "PayPal did not answer"**: PayPal's sandbox was slow; the pledge reads **Unconfirmed**, not wrong. Open the
  proof again in a minute (it is cached for about 45 seconds).
- **The payout stays "on its way"**: PayPal reports it by webhook, or the next settlement run reads it. A payout email
  without a sandbox account cannot be paid.

## Run the checks yourself

From a clone, after `pip install -r requirements-dev.txt`: `python -m pytest -q` runs the server tests, PayPal's in-memory
fake included, and `cd frontend && npm ci && npm test` runs the front-end tests. The scripts that run the money flows
against the real PayPal sandbox are [`scripts/sandbox_money_flows.py`](../scripts/sandbox_money_flows.py) and
[`scripts/e2e.py`](../scripts/e2e.py); [`scripts/seed_demo.py`](../scripts/seed_demo.py) makes the fictional campaigns.
