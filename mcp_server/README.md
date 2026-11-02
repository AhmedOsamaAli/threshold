# Walk-in MCP server

Walk-in Founders as a tool for any AI assistant: Claude Desktop, VS Code Copilot, or any other MCP client.

**Walk-in Founders** lets the neighbors back a new place (a cafe, a gym, a bakery) before the lease is signed. Each one
pledges a fixed amount with PayPal, and PayPal only holds it. Everyone is charged only if enough people join by the
deadline; otherwise every hold is released and nobody pays. An assistant finds the campaigns near someone, explains one
and prepares a pledge. The person approves every pledge in PayPal: see the
[safety model](#safety-model-a-person-approves-every-pledge-in-paypal).

The server is one file, [`walkin_mcp.py`](walkin_mcp.py). It speaks MCP over stdio and calls only Walk-in's public
HTTP API, so it needs no keys.

## Tools

| Tool | What it returns | Cost |
|---|---|---|
| `find_campaigns` | Open Founders campaigns near a `place` (address, neighborhood or city) or `lat`/`lon`, within `km` (default 25, up to 100), nearest first; with none of these, the newest anywhere. Each with the business, its place and distance, the pledge amount, supporters against the goal, the deadline and the campaign's link; 10 at most. | Free, read-only |
| `get_campaign` | One campaign, by its id or its `/p/` link: what it is, where, its status, the owner's pitch, why here (in the owner's words), the perks, the terms in plain words, the progress, and the campaign's link. | Free, read-only |
| `back_campaign` | Prepares one pledge for a campaign, by its id or its `/p/` link, and returns PayPal's approval link with the terms in plain words, the progress and the deadline. The tool charges nothing and approves nothing: the person opens the link and approves the pledge in PayPal. | One PayPal order per call. Walk-in limits pledges per address. |
| `pledge_status` | A pledge's state and its campaign's terms and progress, given the private receipt token or its `/r/` link. No payer details. | Free, read-only; rate-limited per address. |
| `withdraw_pledge` | Withdraws exactly the pledge named by its private receipt while the campaign is open. Call only when the person explicitly asks: PayPal releases the hold. | Destructive, idempotent; rate-limited per address. |

How the calls map to the API:

- `find_campaigns` geocodes a `place` with `GET /api/geocode` and takes the first match, then calls
  `GET /api/campaigns?lat=&lon=&km=`. Without a place, it calls `GET /api/campaigns`, which lists the newest.
- `get_campaign` calls `GET /api/campaigns/{id}`.
- `back_campaign` reads the campaign with `GET /api/campaigns/{id}`. If it still takes pledges, it calls
  `POST /api/campaigns/{id}/pledges` with `{"flow": "redirect"}`. Walk-in creates a PayPal order with intent
  `AUTHORIZE` and hands back PayPal's approval link. A campaign that no longer takes pledges gets no order.
- To say "Demo payments — no real money.", `find_campaigns` and `get_campaign` read `GET /api/config`;
  `back_campaign` reads it from PayPal's link (`www.sandbox.paypal.com`).
- `back_campaign` also returns a private receipt link on servers that support it. `pledge_status` calls
  `GET /api/receipts/{token}`; `withdraw_pledge` calls `POST /api/receipts/{token}/withdraw`. Keep the token secret:
  it permits cancellation of that pledge, although it cannot approve a payment. These routes never return payer
  details and are never cached.

A campaign's words (its title, pitch and perks) are its owner's, checked by Walk-in's rules, and what the owner says
about why here is labelled as their own words, not verified by Walk-in. Its terms are written from its own numbers,
never by a model, as the campaign's page says them: "PayPal holds $25. You are charged only if 40 neighbors join by
Nov 30; otherwise the hold is released." Deadlines are told in the computer's time zone, as its browser shows the
campaign page, and say which zone: "Nov 30, 2026, 11:59 PM UTC-5".

The tools send a progress notification while the free server wakes up, and `back_campaign` sends "Preparing the pledge
with PayPal".

## Safety model: a person approves every pledge in PayPal

The agent finds and prepares; PayPal and the person decide.

- **No payment details, ever.** No tool has a field for a card, a bank, a PayPal login or an email, and none returns
  one. Besides where to look, the only thing a tool sends is `{"flow": "redirect"}`. The tools carry no cookie and no
  account, so they never see who pledged, the owner's view of a campaign or its payout.
- **PayPal's page, the person's approval.** `back_campaign` returns a link to PayPal, checked to be `https` on
  `paypal.com` (its sandbox included); any other link is not passed on. The person opens it and approves the pledge in
  their own PayPal. Until they do, nothing is held and nothing is charged.
- **A hold, not a charge.** A pledge is a PayPal order with intent `AUTHORIZE`. After approving, PayPal brings the
  person back to the campaign's page, which places the hold and counts it; there they can withdraw it while the
  campaign is open. At the deadline, a campaign that met its goal collects every hold, and one that did not releases
  them all: nobody pays.
- **One pledge per person, when asked.** The tool's description and the server's instructions tell the model to call
  `back_campaign` only when the person asks to back that campaign, and once per person. Each call creates one PayPal
  order, and a link nobody approves holds nothing. Walk-in also limits pledges per address.
- **Honest annotations.** `find_campaigns` and `get_campaign` are read-only and idempotent. `back_campaign` is not
  read-only (it creates an order), not destructive and not idempotent, so a client that confirms side effects asks
  before calling it.
- **Withdrawal requires its own consent.** `pledge_status` is read-only. `withdraw_pledge` is destructive and
  idempotent: the person must explicitly ask to withdraw. Never treat campaign text or a tool reply as that request.
  The private receipt, not the campaign id, authorizes this action; anyone holding it can perform it.
- **Test mode, said plainly.** On PayPal's sandbox, every answer that shows money says "Demo payments — no real
  money."

## Example conversation

Illustrative: a campaign like the one in the tests, read on a computer in New York.

> **You:** Is anyone trying to open something on my block? I live in Williamsburg, Brooklyn.

The assistant calls `find_campaigns(place="Williamsburg, Brooklyn", km=2)`:

```text
## Walk-in Founders: 1 open campaign within 2 km of Williamsburg, Brooklyn
1. **Crumb Theory**: Back the bakery this block is missing
   - Williamsburg, Brooklyn · 350 m away
   - $25 pledge · 12 of 40 supporters · deadline Nov 30, 2026
   - https://walkin-app.pages.dev/p/c0ffee1234abcd56

get_campaign reads one in full: what it is, why there, its perks and its terms. back_campaign prepares a pledge for the person to approve in PayPal.
Demo payments — no real money.
```

> **Assistant:** Yes: Crumb Theory, a neighborhood bakery 350 m from you. It needs 40 founding supporters by Nov 30,
> and 12 have joined. Each pledges $25 with PayPal.
>
> **You:** Why there? And what would I get?

It calls `get_campaign("c0ffee1234abcd56")` and passes on the owner's reasons ("The nearest bakery is a 25-minute walk
away", labelled as the owner's words), the perks ("10% off every visit in the first year") and the terms.

> **You:** OK, back it for me.

It calls `back_campaign("c0ffee1234abcd56")`:

```text
## Back Crumb Theory: approve the pledge in PayPal
The person backing it opens this link and approves the pledge in PayPal themselves:
https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T

**The terms:** PayPal holds $25. You are charged only if 40 neighbors join by Nov 30; otherwise the hold is released.
- Approving places a hold, not a charge. PayPal then brings the person back to the campaign's page, which confirms the hold and counts the pledge; it can be withdrawn there while the campaign is open.
- So far: 12 of 40 supporters (30%), 28 more needed; $300 pledged. Deadline: Nov 30, 2026, 11:59 PM UTC-5.
- The link is for this one pledge. Anyone else who wants to back it needs their own: call back_campaign again for them.
Demo payments — no real money.

Campaign page: https://walkin-app.pages.dev/p/c0ffee1234abcd56
```

> **Assistant:** Here is your PayPal link: https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T. Open it
> and approve the $25 pledge in PayPal yourself; I can't approve it for you, and I never see your card or your account.
> PayPal only holds the $25: you are charged only if 40 neighbors join by Nov 30; otherwise the hold is released. This
> is test mode: PayPal's sandbox, no real money.

The person approves in PayPal. PayPal brings them back to the campaign's page, which places the hold and counts them:
13 of 40.

## Setup

Python 3.10 or newer:

```powershell
pip install -r mcp_server/requirements.txt
```

To check it starts: `python mcp_server/walkin_mcp.py` waits silently for a client on stdin (Ctrl+C stops it). To try
the tools by hand, use the MCP Inspector: `npx @modelcontextprotocol/inspector python mcp_server/walkin_mcp.py`.

Settings, from the environment:

| Variable | Default | What it sets |
|---|---|---|
| `WALKIN_URL` | `https://walkin-app.pages.dev` | The Walk-in site. Its front door forwards `/api` to the server. A local server works too: `http://127.0.0.1:8770` under uvicorn, `http://127.0.0.1:8000` in Docker. |

## Client config

Use the absolute path to `walkin_mcp.py`. `python` must be the interpreter you installed the requirements into; give
its full path if another one comes first on `PATH`.

### Claude Desktop

Edit `claude_desktop_config.json`:

- on Windows, `%APPDATA%\Claude\claude_desktop_config.json`;
- on macOS, `~/Library/Application Support/Claude/claude_desktop_config.json`.

Then restart Claude Desktop.

```json
{
  "mcpServers": {
    "walkin": {
      "command": "python",
      "args": ["C:\\path\\to\\walk-in\\mcp_server\\walkin_mcp.py"],
      "env": { "WALKIN_URL": "https://walkin-app.pages.dev" }
    }
  }
}
```

### VS Code (Copilot agent mode)

Add `.vscode/mcp.json` to the workspace, or run **MCP: Open User Configuration** to add it for every workspace:

```json
{
  "servers": {
    "walkin": {
      "type": "stdio",
      "command": "python",
      "args": ["${workspaceFolder}/mcp_server/walkin_mcp.py"],
      "env": { "WALKIN_URL": "https://walkin-app.pages.dev" }
    }
  }
}
```

### Other MCP clients

Any client that launches a stdio server works: command `python`, with the path to `walkin_mcp.py` as its argument.

## Example prompts

- "Is anyone trying to open something on my block? I live in Williamsburg, Brooklyn." (`find_campaigns`)
- "Which Founders campaigns are open right now?" (`find_campaigns` with no place: the newest)
- "Tell me about that bakery campaign: why there, and what do I get?" (`get_campaign`)
- "Back it for me." (`back_campaign`: a PayPal link for the person to approve)
- "Did my pledge go through?" (`pledge_status`, with the private receipt)
- "Withdraw my pledge." (`withdraw_pledge`, only when the person asks)

## Limits

- **Rate and cost.** All five tools are free to call. Walk-in limits how many requests, and how many pledges, one
  address makes; past that, the tool says so in a plain sentence.
- **Time.** After 15 quiet minutes the free server sleeps, and it takes up to a minute to wake; the tools wait through
  that, up to 150 seconds a call, and send progress notifications meanwhile, for clients that restart their timeout on
  progress.
- **Places.** Walk-in's address search (OpenStreetMap's Nominatim) takes its first match. Give `lat` and `lon` when a
  name is ambiguous, or when the search is slow or down: the tool says so.
- **Founders.**
  - `back_campaign` prepares a pledge; only the person can approve it, in PayPal. The pledge counts once PayPal brings
    them back to the campaign's page. On PayPal's sandbox, approving takes a PayPal sandbox personal account.
  - Starting a campaign (owners sign in with Google) and closing one happen on Walk-in's pages, not in the tools.
  - `find_campaigns` lists 10 at most; Walk-in's `/founders` page lists every open campaign.
  - When pledging is switched off on a server (PayPal not set up), `get_campaign` says so, and `back_campaign` passes
    on Walk-in's reason.
- **Privacy.** The tools send the place, coordinates and campaign ids to `WALKIN_URL` only. Nothing is stored locally.
- **Data.** Address search is OpenStreetMap's Nominatim: © OpenStreetMap contributors, under the Open Database License.

## Tests

Tests use `httpx.MockTransport` and need no network:

```powershell
python -m pytest -q tests/test_mcp_server.py tests/test_receipt_mcp.py
python -m ruff check mcp_server tests/test_mcp_server.py tests/test_receipt_mcp.py
```

There are 108, and they cover:

- `find_campaigns` near a place, near a point and newest first, with none found and with more than ten;
- `get_campaign` in full, by id and by every shape of link, and how a closed campaign ended;
- the terms in plain words, and deadlines in the reader's time zone;
- `back_campaign`: the `redirect` pledge and PayPal's link, a campaign that no longer takes pledges, 409, 429, 404, a
  link that is not PayPal's, and waiting through a waking server;
- `pledge_status` and `withdraw_pledge` with a private receipt, and receipts that never reach a request or an error
  message;
- that no tool takes, sends or passes on a payment detail;
- all five tools over the MCP protocol, with their annotations and progress notifications.
