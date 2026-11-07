"""Gemini as a teacher: the app's Gemini verifier (wahy/core/ai/gemini.py: batches, free-tier pacer, Retry-After,
request log) with the teacher's own system prompt."""
from __future__ import annotations

from wahy.core.ai.gemini import GeminiOptions

from .base import Teacher

# the datagen's teacher prompt; core/ai adds "Write the `reason` field in Arabic, one short sentence."
SYSTEM = ("أنت مدقق شرعي ولغوي خبير في تفريغ المحاضرات الإسلامية. مهمتك التمييز بدقة بين الاقتباس الفعلي "
          "(آية أو حديث نبوي أو ذكر) وبين الكلام العادي للشيخ الشارح الذي تتشابه كلماته لفظياً مع الحديث أو الآية.")


class GeminiTeacher(Teacher):
    name = "gemini"
    provider = "gemini"
    batch_size = 5

    def __init__(self, model: str = "gemini-3.5-flash-lite", free_tier: bool = True, rpm: int = 12):
        super().__init__(model)
        self.free_tier, self.rpm = free_tier, rpm

    def options(self) -> GeminiOptions:
        return GeminiOptions(model=self.model, free_tier=self.free_tier, rpm=self.rpm, batch_size=self.batch_size,
                             system_prompt=SYSTEM)
