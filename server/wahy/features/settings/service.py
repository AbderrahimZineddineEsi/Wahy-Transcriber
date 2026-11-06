"""What the settings screen shows (health) and does (save an API key)."""

from __future__ import annotations

from wahy.core.engine import EngineClient
from wahy.core.gpu import GpuOwner, cuda_card
from wahy.core.jobs import JobRunner
from wahy.core.settings import KEY_FIELDS, Settings
from wahy.features.corpora.service import CorporaService
from wahy.features.settings.schemas import CorpusHealth, EngineHealth, GpuHealth, Health

ACTIVE = {"queued", "running", "pausing", "cancelling"}


class SettingsService:
    def __init__(self, settings: Settings, gpu: GpuOwner, engine: EngineClient, jobs: JobRunner,
                 corpora: CorporaService):
        self.settings, self.gpu, self.engine, self.jobs, self.corpora = settings, gpu, engine, jobs, corpora

    def health(self) -> Health:
        card, gpu, engine = cuda_card(), self.gpu.status(), self.engine.status()
        return Health(
            status="ok",
            keys=self.settings.key_status(),
            gpu=GpuHealth(card=card.name if card else None, total_mb=card.total_mb if card else None,
                          free_mb=card.free_mb if card else None, resident=gpu.resident,
                          in_use=gpu.in_use, waiting=gpu.waiting),
            engine=EngineHealth(running=engine.running, starts=engine.starts, calls=engine.calls),
            corpus=CorpusHealth(ready=self.settings.corpus_path.exists(),
                                hadith_source=self.corpora.active_source()),
            running_jobs=sum(1 for j in self.jobs.list(limit=100) if j.status in ACTIVE),
        )

    def set_key(self, provider: str, value: str | None) -> dict[str, bool]:
        if provider not in KEY_FIELDS:
            raise KeyError(provider)
        self.settings.set_key(provider, value)
        return self.settings.key_status()
