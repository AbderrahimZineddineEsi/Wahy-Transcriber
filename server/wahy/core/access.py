"""A small access guard for a public link (the Colab notebook, F-130).

    WAHY_ACCESS_TOKEN=<random string>      # unset (the default, on a laptop): no guard at all

When a token is set, every request must carry it, otherwise it gets a 401 and never reaches a route:

    https://host/?token=<token>      the link the notebook prints: sets a cookie, redirects to the
                                     same page without the token in the address
    cookie  wahy_token=<token>       what the browser sends after that (HttpOnly, SameSite=Lax)
    header  X-Wahy-Token: <token>    for scripts (the notebook's own health check)

The token is compared in constant time. It is one shared secret for one person, not a user system.
Pure ASGI (not `BaseHTTPMiddleware`), so streamed responses such as the job event stream pass untouched.
"""

from __future__ import annotations

import hmac
from http.cookies import SimpleCookie
from urllib.parse import parse_qsl, urlencode

from starlette.types import ASGIApp, Message, Receive, Scope, Send

COOKIE = "wahy_token"
HEADER = "x-wahy-token"
QUERY = "token"
COOKIE_MAX_AGE_S = 30 * 24 * 3600

_DENIED_HTML = (
    "<!doctype html><meta charset=utf-8><title>Tadqeeq</title>"
    "<body style='font-family:sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem'>"
    "<h1>Access link needed</h1><p>This Tadqeeq is private. Open the full link printed in the Colab "
    "notebook (it ends with <code>?token=...</code>).</p>"
)


def token_matches(given: str | None, expected: str) -> bool:
    """Constant-time comparison; a missing or empty token never matches."""
    return bool(given) and hmac.compare_digest(given.encode(), expected.encode())  # type: ignore[union-attr]


class AccessGuard:
    def __init__(self, app: ASGIApp, token: str):
        if not token:
            raise ValueError("the access token cannot be empty")
        self.app = app
        self.token = token

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        cookie = SimpleCookie(headers.get("cookie", "")).get(COOKIE)
        query = dict(parse_qsl(scope.get("query_string", b"").decode("latin-1"), keep_blank_values=True))

        if token_matches(headers.get(HEADER), self.token) or token_matches(
                cookie.value if cookie else None, self.token):
            await self.app(scope, receive, send)
            return
        is_page_visit = scope["type"] == "http" and scope["method"] == "GET"
        if is_page_visit and token_matches(query.get(QUERY), self.token):
            await self._remember(scope, send, query)
            return
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        await self._deny(scope, send)

    async def _remember(self, scope: Scope, send: Send, query: dict[str, str]) -> None:
        """Valid token in the address: set the cookie and redirect to the same address without the token."""
        rest = urlencode([(k, v) for k, v in query.items() if k != QUERY])
        location = scope.get("root_path", "") + scope["path"] + (f"?{rest}" if rest else "")
        secure = "; Secure" if self._https(scope) else ""
        cookie = f"{COOKIE}={self.token}; Path=/; Max-Age={COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Lax{secure}"
        await self._respond(send, 303, [(b"location", location.encode()), (b"set-cookie", cookie.encode()),
                                       (b"cache-control", b"no-store")], b"")

    async def _deny(self, scope: Scope, send: Send) -> None:
        if scope["path"].startswith("/api"):
            body, kind = b'{"detail":"access token needed"}', b"application/json"
        else:
            body, kind = _DENIED_HTML.encode(), b"text/html; charset=utf-8"
        await self._respond(send, 401, [(b"content-type", kind), (b"cache-control", b"no-store")], body)

    @staticmethod
    def _https(scope: Scope) -> bool:
        forwarded = dict((k.lower(), v) for k, v in scope["headers"]).get(b"x-forwarded-proto", b"")
        return scope.get("scheme") == "https" or forwarded.split(b",")[0].strip() == b"https"

    @staticmethod
    async def _respond(send: Send, status: int, headers: list[tuple[bytes, bytes]], body: bytes) -> None:
        start: Message = {"type": "http.response.start", "status": status,
                          "headers": [*headers, (b"content-length", str(len(body)).encode())]}
        await send(start)
        await send({"type": "http.response.body", "body": body})
