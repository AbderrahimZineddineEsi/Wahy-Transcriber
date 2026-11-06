"""Imports every table, so `Base.metadata` holds the whole schema (Alembic compares the migrations against
it). A new models.py must be added here."""

from wahy.core.ai.models import AiRequest
from wahy.core.db import Base
from wahy.core.jobs import Job
from wahy.features.corpora.models import CustomQuote, Dhikr
from wahy.features.detection.models import Finding
from wahy.features.lectures.models import Lecture, LectureVersion, Word
from wahy.features.settings.models import AppSetting
from wahy.features.training.models import Label
from wahy.features.verification.models import Verdict

__all__ = ["AiRequest", "AppSetting", "Base", "CustomQuote", "Dhikr", "Finding", "Job", "Label", "Lecture",
           "LectureVersion", "Verdict", "Word"]
