# Day One

*A working name; the real README is written later.*

Neighbors pledge money to back a new place (a cafe, a gym, a bakery) before its owner signs the lease.
PayPal only holds each pledge: an Orders v2 order with intent AUTHORIZE. If the goal is met by the deadline,
every hold is captured and the owner is paid with PayPal Payouts; otherwise every hold is voided.
It talks to PayPal's sandbox only. The backend is FastAPI in [`app/`](app) with an Alembic-managed database,
and [`mcp_server/`](mcp_server) lets an AI assistant find and back campaigns. The web app is in `frontend/`.

## Run the backend tests

Python 3.12, PowerShell. Leave the `PAYPAL_*`, `LLM_*` and other key variables unset: the tests use fakes and need no network.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
$env:DATABASE_URL = "sqlite://"; $env:PYTHONHASHSEED = "0"
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check app tests mcp_server migrations
```

To start the server: `.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8770`, then open `http://127.0.0.1:8770/api/health`.
