"""
Tournament link: redeeming tickets minted by the tournaments server.

The tournaments server authorizes a player against one of its fixtures, mints a short-lived
single-use ticket, and redirects the player here. This package verifies that ticket, maps the
bearer onto a local user without ever matching on username, provisions the game room for the
fixture, and hands the browser a session.

See `tournaments-backgammon-messaging.md` for the design and the wire formats.
"""
