from backend.laya_datagen import cards, sprint


def rec(i, span="قال تعالى إنما الأعمال بالنيات", band="VERIFIED", tier="silent", n=6, cue=True):
    return {"doc_id": "d", "cases": [], "label": {"tier": tier},
            "det": {"wordStartIdx": i * 100, "wordEndIdx": i * 100 + n - 1, "unitId": f"u{i}", "confidenceBand": band,
                    "hasCitationCue": cue},
            "envelope": {"state": {"matched_span_in_lecture": span, "immediate_transcript_before": ""}}}


def t(v, p_false=0.0):
    return {"verdict": v, "probs": {"CORRECT": 1 - p_false, "FALSE": p_false, "NOT_SURE": 0.0}}


def test_narrator_chain_is_most_suspicious():
    chain = rec(0, span="حدثنا محمد بن بشار قال حدثنا يحيى عن الأعمش", band="CANDIDATE", cue=False, n=9)
    assert sprint.suspicion(chain)[0] > sprint.suspicion(rec(1))[0]
    assert "narrator chain" in sprint.suspicion(chain)[1]


def test_queues_are_disjoint_and_frozen(tmp_path, monkeypatch):
    monkeypatch.setattr(cards, "LABELS_DIR", tmp_path)
    pool = [rec(i, band="CANDIDATE" if i % 3 == 0 else "VERIFIED") for i in range(30)]
    gem = [t("FALSE", 0.9) if i < 4 else t("CORRECT") for i in range(30)]
    jev = [t("CORRECT") for _ in range(30)]
    q = sprint.build_queues(pool, gem, jev, n_suspicious=5, n_random=5)
    sizes = {k: len(v) for k, v in q.items()}
    assert sizes == {"gemini": 4, "suspicious": 5, "random": 5}
    ids = [id(r) for v in q.values() for r in v]
    assert len(ids) == len(set(ids))

    # Gemini changes its mind on re-run: cards already queued stay where they were
    gem2 = [t("CORRECT") for _ in range(30)]
    q2 = sprint.build_queues(pool, gem2, jev, n_suspicious=5, n_random=5)
    assert [r["det"]["unitId"] for r in q2["gemini"]] == [r["det"]["unitId"] for r in q["gemini"]]
    assert {r["det"]["unitId"] for r in q2["random"]} == {r["det"]["unitId"] for r in q["random"]}


def test_ask_never_calls_a_model_when_calls_are_off(tmp_path):
    from backend.laya_datagen.cache import JsonCache
    from backend.laya_datagen.teachers.base import Teacher, ask

    class Fake(Teacher):
        name = "fake"
        calls_made = 0

        def _predict_uncached(self, envs):
            Fake.calls_made += len(envs)
            return [dict(t("CORRECT"), cost=0.0) for _ in envs]

    m = Fake("m")
    m.cache = JsonCache("fake", root=tmp_path)
    envs = [{"state": {"i": i}, "questions": {}} for i in range(3)]
    assert ask(m, envs, "fake", allow_calls=False) is None and Fake.calls_made == 0
    assert len(ask(m, envs, "fake", allow_calls=True)) == 3 and Fake.calls_made == 3
    assert len(ask(m, envs, "fake", allow_calls=False)) == 3 and Fake.calls_made == 3   # all cached now
    assert sprint.reviewer(None, "gemini", {}) is None and isinstance(sprint.results(None, {}, [], {}), str)
