"""The API's endpoints, by resource. Each module has its router; app.main includes the first three, and
app.payments.founders installs the rest.

meta                the server's own facts: whether it is up and what it can reach (GET /api/health)
maps                the map's lookups: the area people can reach from a point, addresses both ways
account             public settings, sign-in and sign-out, the signed-in user, their campaigns, deleting the account
campaigns           Walk-in Founders' campaigns: finding them, pledging, withdrawing, the owner's close and cancel
business_campaigns  starting a campaign from the owner's description of the business, and the AI's draft of its words
receipts            a pledge's private receipt: reading it and withdrawing the pledge
hooks               PayPal's webhooks and the scheduled settlement
"""
