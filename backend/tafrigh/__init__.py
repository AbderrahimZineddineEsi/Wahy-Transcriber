"""
AI Tafrigh Phase package for Wahy-Transcriber.
Faithfully transforms ASR transcripts into clean, student-friendly transcriptions.
"""

__version__ = "0.1.0"

import pydantic
from pydantic import BaseModel

if not hasattr(BaseModel, "model_dump"):
    BaseModel.model_dump = lambda self, **kwargs: self.dict(**kwargs)
if not hasattr(BaseModel, "model_dump_json"):
    BaseModel.model_dump_json = lambda self, **kwargs: self.json(**kwargs)
if not hasattr(BaseModel, "model_validate"):
    BaseModel.model_validate = classmethod(lambda cls, obj, **kwargs: cls.parse_obj(obj, **kwargs))
if not hasattr(BaseModel, "model_validate_json"):
    BaseModel.model_validate_json = classmethod(lambda cls, json_data, **kwargs: cls.parse_raw(json_data, **kwargs))
