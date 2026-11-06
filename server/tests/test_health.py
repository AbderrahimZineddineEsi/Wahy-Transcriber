"""The health route and the key routes behind the settings screen."""

import pytest

from wahy.core.settings import Settings, write_env_value


def test_health_lists_keys_gpu_engine_and_corpus(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["keys"] == {"groq": False, "gemini": False, "openrouter": False, "jev": False}
    assert body["gpu"]["waiting"] == [] and body["gpu"]["resident"] is None
    assert body["engine"]["running"] is False           # asking for health never starts the worker
    assert body["corpus"]["ready"] is False             # the temporary data folder has no corpus file
    assert body["running_jobs"] == 0


def test_a_saved_key_shows_as_set_and_is_never_returned(client, settings):
    secret = "gem-secret-987"
    saved = client.put("/api/settings/keys/gemini", json={"value": f"  {secret} "})
    assert saved.status_code == 200
    assert saved.json()["gemini"] is True
    assert client.get("/api/health").json()["keys"]["gemini"] is True
    assert secret not in saved.text and secret not in client.get("/api/health").text
    assert settings.key("gemini") == secret                    # usable at once, without a restart
    assert f"GEMINI_API_KEY={secret}" in settings.env_path.read_text(encoding="utf-8")


def test_a_saved_key_survives_a_restart(client, settings):
    client.put("/api/settings/keys/groq", json={"value": "gsk-abc"})
    again = Settings(data_dir=settings.data_dir, _env_file=settings.env_path)    # a fresh process reads .env
    assert again.key("groq") == "gsk-abc"


def test_an_empty_value_removes_the_key(client, settings):
    client.put("/api/settings/keys/groq", json={"value": "gsk-abc"})
    answer = client.put("/api/settings/keys/groq", json={"value": ""})
    assert answer.json()["groq"] is False
    assert "GROQ_API_KEY" not in settings.env_path.read_text(encoding="utf-8")


def test_an_unknown_provider_is_404(client):
    assert client.put("/api/settings/keys/nope", json={"value": "x"}).status_code == 404


def test_a_key_with_a_line_break_is_refused(client, settings):
    answer = client.put("/api/settings/keys/groq", json={"value": "abc\nOTHER=1"})
    assert answer.status_code == 422
    assert not settings.env_path.exists()


def test_write_env_value_keeps_other_lines_and_is_private(tmp_path):
    env = tmp_path / ".env"
    env.write_text("# note\nGROQ_API_KEY=old\nOTHER=1\n", encoding="utf-8")
    write_env_value(env, "GROQ_API_KEY", "new")
    write_env_value(env, "GEMINI_API_KEY", "g")
    assert env.read_text(encoding="utf-8") == "# note\nOTHER=1\nGROQ_API_KEY=new\nGEMINI_API_KEY=g\n"
    assert env.stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize("name", ["a\nb", "a\rb"])
def test_write_env_value_refuses_line_breaks(tmp_path, name):
    with pytest.raises(ValueError):
        write_env_value(tmp_path / ".env", "X", name)
