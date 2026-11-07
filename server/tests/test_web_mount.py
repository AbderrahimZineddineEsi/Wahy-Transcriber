"""The server also serves the built web app (F-127: one process, one port)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from wahy.main import create_app


def make_dist(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>wahy</html>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path / "secret.txt").write_text("not for the browser")
    return dist


def test_serves_the_page_assets_and_falls_back_to_the_index(settings, tmp_path):
    dist = make_dist(tmp_path)
    with TestClient(create_app(settings, web_dir=dist)) as client:
        assert client.get("/").text == "<html>wahy</html>"
        assert client.get("/assets/app.js").text == "console.log(1)"
        assert client.get("/lectures/12/verify").text == "<html>wahy</html>"   # a browser-side route
        assert client.get("/api/health").status_code == 200                     # the API still wins


def test_unknown_api_paths_stay_404_and_cannot_escape_the_folder(settings, tmp_path):
    dist = make_dist(tmp_path)
    with TestClient(create_app(settings, web_dir=dist)) as client:
        assert client.get("/api/nope").status_code == 404
        assert "not for the browser" not in client.get("/%2e%2e/secret.txt").text
        assert "not for the browser" not in client.get("/../secret.txt").text


def test_without_a_build_there_is_no_page(settings, tmp_path):
    with TestClient(create_app(settings, web_dir=tmp_path / "missing")) as client:
        assert client.get("/").status_code == 404
