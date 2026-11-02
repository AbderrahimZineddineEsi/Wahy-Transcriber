import pytest


@pytest.fixture(autouse=True)
def no_real_api_keys(monkeypatch):
    """A key in the shell must not turn these tests into paid requests: adapters read the environment."""
    for name in ("GEMINI_API_KEY", "OPENROUTER_API_KEY", "JEV_API_KEY"):
        monkeypatch.delenv(name, raising=False)
