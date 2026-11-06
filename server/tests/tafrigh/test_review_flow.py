"""Human review queue: why an item is queued, and confirm / correct really take it out."""

from wahy.features.tafrigh.pipeline import TafrighPipeline
from wahy.features.tafrigh.review_queue import ReviewQueueManager
from wahy.features.tafrigh.schemas import PipelineConfig

from .helpers import unsure_jev


def run_three():
    pipe = TafrighPipeline(PipelineConfig(model_candidate="jev_hybrid"), adapters={"jev": unsure_jev()})
    return pipe.run(raw_text="هذه جملة أولى في الدرس. وهذه جملة ثانية فيه. وهذه ثالثة وأخيرة.")


def test_low_confidence_items_say_why_and_leave_the_queue_once_reviewed():
    res = run_three()
    mgr = ReviewQueueManager(res.segments)
    items = mgr.get_items()
    assert len(items) == 3
    assert "low_confidence" in items[0].reasons and items[0].tag_probabilities == {"paragraph": 0.57, "continuation": 0.43}

    mgr.confirm_decision(items[0].segment_id)
    from wahy.features.tafrigh.models import StructuralTag
    mgr.correct_decision(items[1].segment_id, corrected_tag=StructuralTag.CONTINUATION)
    left = mgr.get_items()
    assert [i.segment_id for i in left] == [items[2].segment_id]
    assert res.segments[1].final_decision.tag == StructuralTag.CONTINUATION


def test_bookkeeping_flags_alone_do_not_queue_a_sentence():
    res = run_three()
    for s in res.segments:
        s.final_decision.confidence = 0.95
    res.segments[0].review_flags += ["FROM_SPLIT", "UNRELIABLE_TIMESTAMP_MAPPING"]
    res.segments[1].review_flags += ["FROM_SPLIT", "MODEL_ERROR"]
    items = ReviewQueueManager(res.segments).get_items()
    assert [i.segment_id for i in items] == [res.segments[1].id] and items[0].reasons == ["MODEL_ERROR"]
