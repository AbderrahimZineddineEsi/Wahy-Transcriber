"""The access guard for a public link (F-130): without WAHY_ACCESS_TOKEN nothing changes, with it every request
needs the token (link, cookie or header)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from wahy.core.access import AccessGuard, token_matches
from wahy.core.settings import Settings
from wahy.main import create_app

TOKEN = "s3cret-token-value"


def guarded(tmp_path, token: str | None = TOKEN) -> TestClient:
    dist = tmp_path / "dist"
    dist.mkdir(exist_ok=True)
    (dist / "index.html").write_text("<html>wahy</html>")
    settings = Settings(data_dir=tmp_path / "data", env_path=tmp_path / ".env", _env_file=None,
                        WAHY_ACCESS_TOKEN=token)
    return TestClient(create_app(settings, web_dir=dist), follow_redirects=False)


def test_no_token_configured_means_no_guard(tmp_path):
    with guarded(tmp_path, token=None) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/").status_code == 200


def test_a_blank_token_does_not_lock_or_open_anything_by_accident(tmp_path):
    with guarded(tmp_path, token="   ") as client:      # blank = no guard, not "the empty string is the password"
        assert client.get("/api/health").status_code == 200


def test_requests_without_the_token_are_refused(tmp_path):
    with guarded(tmp_path) as client:
        api = client.get("/api/health")
        assert api.status_code == 401 and api.json() == {"detail": "access token needed"}
        page = client.get("/")
        assert page.status_code == 401 and "Access link needed" in page.text and "wahy</html>" not in page.text
        assert client.post("/api/settings/laya/unload").status_code == 401
        assert client.get("/api/health", headers={"x-wahy-token": "wrong"}).status_code == 401
        assert client.get("/api/health", params={"token": "wrong"}).status_code == 401
        client.cookies.set("wahy_token", TOKEN[:-1])
        assert client.get("/api/health").status_code == 401


def test_the_link_sets_a_cookie_and_hides_the_token_from_the_address(tmp_path):
    with guarded(tmp_path) as client:
        first = client.get("/lectures/3", params={"token": TOKEN, "tab": "edit"})
        assert first.status_code == 303
        assert first.headers["location"] == "/lectures/3?tab=edit"          # token gone, other query kept
        cookie = first.headers["set-cookie"]
        assert f"wahy_token={TOKEN}" in cookie and "HttpOnly" in cookie and "SameSite=Lax" in cookie
        assert "Secure" not in cookie                                         # plain http on a laptop
        page = client.get("/")                                                # the TestClient kept the cookie
        assert page.status_code == 200 and "wahy</html>" in page.text
        assert client.get("/api/health").status_code == 200


def test_the_cookie_is_secure_behind_an_https_tunnel(tmp_path):
    with guarded(tmp_path) as client:
        first = client.get("/", params={"token": TOKEN}, headers={"x-forwarded-proto": "https"})
        assert "Secure" in first.headers["set-cookie"]


def test_a_script_can_use_the_header(tmp_path):
    with guarded(tmp_path) as client:
        assert client.get("/api/health", headers={"x-wahy-token": TOKEN}).status_code == 200


def test_the_token_in_the_address_does_not_unlock_a_post(tmp_path):
    with guarded(tmp_path) as client:
        # only a page visit (GET) may trade the link for a cookie
        assert client.post("/api/settings/laya/unload", params={"token": TOKEN}).status_code == 401


def test_token_matches_is_strict():
    assert token_matches(TOKEN, TOKEN)
    assert not token_matches(None, TOKEN) and not token_matches("", TOKEN) and not token_matches("x", TOKEN)


def test_an_empty_token_cannot_build_a_guard():
    import pytest
    with pytest.raises(ValueError):
        AccessGuard(lambda *a: None, "")
