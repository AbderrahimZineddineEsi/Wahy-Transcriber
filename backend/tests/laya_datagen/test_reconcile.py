from backend.laya_datagen.reconcile import reconcile


def rec(tier, verdict, i=0):
    return {"id": f"r{i}", "doc_id": "d", "det": {"wordStartIdx": i, "wordEndIdx": i + 3, "unitId": "u"},
            "label": {"tier": tier, "verdict": verdict, "boundary": None, "flags": []}}


def t(v, p=0.95):
    others = {"CORRECT", "FALSE", "NOT_SURE"} - {v}
    return {"verdict": v, "probs": {v: p, **{o: (1 - p) / 2 for o in others}}}


def test_strong_gt_vs_confident_teacher_goes_to_review():
    r = [rec("pos_strong", "CORRECT", 0), rec("pos_strong", "CORRECT", 1)]
    s = reconcile(r, {"jev": [t("FALSE"), t("CORRECT")]}, humans={})
    assert [x["decision"] for x in r] == ["review", "accepted"] and s["review"] == 1


def test_silent_needs_two_confident_agreeing_teachers_and_never_not_sure():
    r = [rec("silent", None, 0), rec("silent", None, 1), rec("silent", None, 2)]
    out = {"jev": [t("CORRECT"), t("CORRECT"), t("NOT_SURE")], "gem": [t("CORRECT"), t("FALSE"), t("NOT_SURE")]}
    reconcile(r, out, humans={})
    assert r[0]["decision"] == "accepted" and r[0]["label"]["verdict"] == "CORRECT" and r[0]["label"]["tier"] == "teacher_consensus"
    assert r[1]["decision"] == "review" and r[2]["decision"] == "review" and r[2]["label"]["verdict"] is None


def test_human_wins_and_asr_mismatch_dropped():
    r = [rec("neg_weak", "FALSE", 0), rec("asr_mismatch", "FALSE", 1)]
    h = {"d|0-3|u": {"verdict": "NOT_SURE", "boundary": None}}
    reconcile(r, {"jev": [t("CORRECT"), t("FALSE")]}, humans=h)
    assert r[0]["label"]["verdict"] == "NOT_SURE" and r[0]["label"]["human"] and r[1]["decision"] == "dropped"
