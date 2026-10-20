"""
Canonical Training-Data Store for Wahy-Transcriber AI Tafrigh Phase.
Maintains append-only JSONL of all decisions, preserving dynamic choices,
context shown, validation results, and review actions for future model fine-tuning.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

# Classical Islamic scholars to protect from anonymization
CLASSICAL_SCHOLARS = {
    "مالك", "الشافعي", "أحمد", "ابن حنبل", "أبو حنيفة", "البخاري", "مسلم",
    "الترمذي", "النسائي", "ابن ماجه", "ابن تيمية", "ابن القيم", "النووي",
    "ابن حجر", "الذهبي", "ابن كثير", "القرطبي", "الطبري", "البغوي",
    "الشوكاني", "السعدي", "ابن رجب", "ابن قدامة", "العز بن عبد السلام",
    "ابن عثيمين", "ابن باز", "الألباني", "ابن عبد البر", "مالك بن أنس",
}

# Regex for phone numbers, emails, and student question introductions
PHONE_RE = re.compile(r"(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}")
EMAIL_RE = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")
STUDENT_CALL_RE = re.compile(r"(?:الطالب|الأخ|السائل|أبو|أم)\s+([^\s,.:؛؟!]+)")


def anonymize_personal_details(text: str) -> str:
    """
    Scrubs attendee personal names and contact details while preserving
    classical religious scholarly names and terminology.
    """
    if not text:
        return text

    # Scrub phone numbers and emails
    clean = PHONE_RE.sub("[بيانات شخصية]", text)
    clean = EMAIL_RE.sub("[بيانات شخصية]", clean)

    # Scrub attendee names following inquiry cues
    def replace_attendee(match: re.Match) -> str:
        name = match.group(1).strip()
        # If the name is a classical scholar, keep it intact
        if any(scholar in name for scholar in CLASSICAL_SCHOLARS):
            return match.group(0)
        return match.group(0).replace(name, "[اسم طالب]")

    clean = STUDENT_CALL_RE.sub(replace_attendee, clean)
    return clean


class CanonicalTrainingRecord(BaseModel):
    record_id: str = Field(default_factory=lambda: f"rec_{uuid.uuid4().hex[:12]}")
    schema_version: str = "1.0"
    run_id: Optional[str] = None
    transcript_id: str = "default_transcript"
    segment_id: str
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    original_text: str
    source_pos: Dict[str, Any]
    context_shown: Dict[str, Any]
    dynamic_choice_list: List[Dict[str, Any]]
    raw_model_output: Optional[Any] = None
    parsed_model_output: Optional[Any] = None
    validation_result: Dict[str, Any]
    final_accepted_decision: Dict[str, Any]
    review_status: Dict[str, Any]
    privacy_metadata: Dict[str, Any] = Field(default_factory=lambda: {
        "consent_verified": True,
        "anonymized": True,
        "audio_stored": False,
    })


class TrainingStore:
    """Append-only canonical training data repository."""

    def __init__(self, store_path: Optional[str] = None) -> None:
        self.store_path = Path(store_path or "data/training_store/canonical_decisions.jsonl")
        self.store_path.parent.mkdir(parents=True, exist_ok=True)

    def append_record(self, record: CanonicalTrainingRecord) -> None:
        """Appends a single verified/captured record to the store."""
        # Ensure anonymization on personal details if text contains comments
        tag = record.final_accepted_decision.get("tag")
        if tag == "comment":
            record.original_text = anonymize_personal_details(record.original_text)

        with open(self.store_path, "a", encoding="utf-8") as f:
            f.write(record.model_dump_json() + "\n")

    def load_all_records(self) -> List[CanonicalTrainingRecord]:
        """Reads all records from the store."""
        if not self.store_path.exists():
            return []
        records: List[CanonicalTrainingRecord] = []
        with open(self.store_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    records.append(CanonicalTrainingRecord.model_validate_json(line))
        return records
