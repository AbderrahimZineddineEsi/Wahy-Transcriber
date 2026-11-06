from pathlib import Path

from wahy.core.settings import Settings


def test_every_path_lives_in_the_data_folder_unless_set(tmp_path):
    s = Settings(data_dir=tmp_path, _env_file=None)
    assert s.db_path == tmp_path / "wahy.db"
    assert s.corpus_path == tmp_path / "corpus.json"
    assert s.media_dir == tmp_path / "media"
    other = Settings(data_dir=tmp_path, corpus_path=Path("/elsewhere/corpus.json"), _env_file=None)
    assert other.corpus_path == Path("/elsewhere/corpus.json")


def test_environment_variables_set_paths(tmp_path, monkeypatch):
    monkeypatch.setenv("WAHY_DATA_DIR", str(tmp_path / "d"))
    monkeypatch.setenv("WAHY_DB_PATH", str(tmp_path / "x.db"))
    s = Settings(_env_file=None)
    assert s.data_dir == tmp_path / "d"
    assert s.db_path == tmp_path / "x.db"


def test_keys_come_from_the_env_file_and_are_never_shown(tmp_path):
    env = tmp_path / ".env"
    env.write_text("GEMINI_API_KEY=gem-secret-123\nGROQ_API_KEY=   \nUNRELATED=1\n", encoding="utf-8")
    s = Settings(data_dir=tmp_path, _env_file=env)
    assert s.key("gemini") == "gem-secret-123"
    assert s.key("groq") is None                       # blank counts as not set
    assert s.key_status() == {"groq": False, "gemini": True, "openrouter": False, "jev": False}
    assert "gem-secret-123" not in repr(s) and "gem-secret-123" not in str(s.model_dump())


def test_the_environment_wins_over_the_env_file(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("OPENROUTER_API_KEY=from-file\n", encoding="utf-8")
    monkeypatch.setenv("OPENROUTER_API_KEY", "from-shell")
    assert Settings(data_dir=tmp_path, _env_file=env).key("openrouter") == "from-shell"
