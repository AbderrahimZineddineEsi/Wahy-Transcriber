import random

from backend.laya_datagen.align import align
from backend.laya_datagen.gt_parse import locate_ayah, parse_gt


def norm_words(words):
    import re
    return [[re.sub(r"[ً-ْٰـ،.:؛]", "", w)] if re.sub(r"[ً-ْٰـ،.:؛\[\]\d\-]", "", w) else [] for w in words]


def test_locate_ayah_partial_and_noise():
    u = "وأما بنعمة ربك فحدث".split()
    window = "قال تعالى وأما بنعمة ربك فحدث ثم".split()
    assert locate_ayah(window, u) == (2, 6, 0, 4, 4)
    assert locate_ayah("لا علاقة له بالموضوع إطلاقا".split(), u) is None
    # speaker quoted only the middle of the ayah
    assert locate_ayah("بنعمة ربك فحدث".split(), u)[2:4] == (1, 4)


def test_parse_quran_ref_multi_ayah_and_unresolved_ref():
    names = {"93": "الضحى", "2": "البقرة"}
    units = {"93:10": "وأما السائل فلا تنهر".split(), "93:11": "وأما بنعمة ربك فحدث".split()}
    text = "فقال وَأَمَّا السَّائِلَ فَلا تَنْهَرْ وَأَمَّا بِنِعْمَةِ رَبِّكَ فَحَدِّثْ [الضحى: 10-11] ثم كلام [صحيح البخاري: 5] آخر"
    doc = parse_gt([("sheikh", text)], norm_words, names, lambda ids: {i: units[i] for i in ids if i in units})
    assert [(q.unit_id, q.u_start, q.u_end) for q in doc.quran] == [("93:10", 0, 4), ("93:11", 0, 4)]
    q0, q1 = doc.quran
    assert doc.tokens[q0.gt_start:q0.gt_end] == units["93:10"] and q1.gt_start == q0.gt_end
    assert doc.unresolved_refs == ["[صحيح البخاري: 5]"]
    assert doc.tashkeel[q0.gt_start] and not doc.tashkeel[0]


def test_hadith_region_inside_numbered_paragraph():
    book = [("book", "1/13- وعن أبي هريرة قال: سمعت رسول الله ﷺ يقول: والله إني لأستغفر الله وأتوب إليه في اليوم أكثر من سبعين مرة رواه البخاري.")]
    doc = parse_gt(book, norm_words, {}, lambda ids: {})
    r = doc.hadith[0]
    assert doc.tokens[r.gt_start] == "والله" and doc.tokens[r.gt_end - 1] == "مرة" and r.gt_end - r.gt_start == 12


def test_no_hadith_region_without_numbered_intro():
    doc = parse_gt([("sheikh", "قال النبي: كلام طويل جدا جدا جدا جدا جدا رواه مسلم")], norm_words, {}, lambda ids: {})
    assert doc.hadith == []


def test_alignment_survives_asr_noise():
    rnd = random.Random(1)
    gt = [f"w{rnd.randrange(400)}x{i % 7}" for i in range(1200)]
    asr = []
    for t in gt:
        r = rnd.random()
        if r < 0.05:
            continue                      # deletion
        asr.append(t + "z" if r < 0.12 else t)   # substitution-like noise (fuzzy)
        if rnd.random() < 0.03:
            asr.append("zzfill")          # insertion
    al = align(asr, gt)
    ok = sum(1 for i, j in enumerate(al.asr2gt) if j >= 0 and (asr[i] == gt[j] or asr[i] == gt[j] + "z"))
    wrong = sum(1 for i, j in enumerate(al.asr2gt) if j >= 0 and not (asr[i] == gt[j] or asr[i] == gt[j] + "z"))
    assert ok / len(asr) > 0.9 and wrong / len(asr) < 0.01
    ca, cg = al.coverage()
    assert ca > 0.9 and cg > 0.85


def test_unrelated_docs_do_not_align():
    a = [f"a{i}" for i in range(500)]
    b = [f"b{i}" for i in range(500)]
    al = align(a, b)
    assert al.n_anchors == 0 and al.coverage() == (0.0, 0.0)
