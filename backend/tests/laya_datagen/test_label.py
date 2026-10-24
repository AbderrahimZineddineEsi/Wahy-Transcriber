from backend.laya_datagen.align import Alignment
from backend.laya_datagen.gt_parse import GTDoc, HadithRegion, QuranSpan
from backend.laya_datagen.label import DocCtx, label_detection


def ctx(gt_tokens, quran=(), hadith=(), tash=None, asr=None, unit=None):
    asr = asr or list(gt_tokens)
    gt = GTDoc(tokens=list(gt_tokens), roles=["sheikh"] * len(gt_tokens), tashkeel=tash or [False] * len(gt_tokens),
               quran=list(quran), hadith=list(hadith))
    n = len(asr)
    al = Alignment(list(range(n)), list(range(n)), [True] * n)
    return DocCtx(gt, al, asr, list(range(n + 1)), lambda t: t.split(), lambda uid: unit)


def det(ws, we, src="QURAN", canon="", unit="93:11", qseg=None):
    return {"wordStartIdx": ws, "wordEndIdx": we, "sourceType": src, "canonicalText": canon, "unitId": unit,
            "qSegments": qseg or [[0, 4]]}


V = "وأما بنعمة ربك فحدث".split()


def test_pos_strong_and_wrong_id_and_ref_differs():
    toks = ["قال"] + V + ["ثم", "كلام"]
    span = QuranSpan("93:11", 1, 5, 0, 4, 4, 4)
    c = ctx(toks, quran=[span])
    assert label_detection(det(1, 4, canon=" ".join(V)), c).tier == "pos_strong"
    other = label_detection(det(1, 4, canon="كلام مختلف تماما هنا"), c)
    assert (other.tier, other.verdict) == ("wrong_id", "FALSE")
    same_text_other_ref = label_detection(det(1, 4, canon=" ".join(V), unit="9:9"), c)
    assert same_text_other_ref.verdict == "CORRECT" and same_text_other_ref.flags == ["ref_differs"]


def test_boundary_missing_start_needs_asr_evidence():
    u = "وأما بنعمة ربك فحدث".split()
    toks = ["وأما"] + u[1:] + ["x"]                       # speaker said the whole ayah
    span = QuranSpan("93:11", 0, 4, 0, 4, 4, 4)
    c = ctx(toks, quran=[span], unit=u)
    d = det(1, 3, canon=" ".join(u), qseg=[[1, 4]])      # detection starts at word 1; 'وأما' sits right before it
    assert label_detection(d, c).boundary == "MISSING_START"
    c2 = ctx(["zzz"] + u[1:] + ["x"], quran=[span], unit=u)   # ASR garbled the missing word: nothing to see
    assert label_detection(d, c2).boundary == "COMPLETE_SPAN"


def test_neg_weak_silent_and_asr_mismatch():
    plain = "ان الله غفور رحيم كما قال الشيخ".split()
    c = ctx(plain)
    assert label_detection(det(0, 3, canon="ان الله غفور رحيم"), c).tier == "neg_weak"
    tash = ctx(plain, tash=[True] * len(plain))
    assert label_detection(det(0, 3, canon="ان الله غفور رحيم"), tash).tier == "silent"
    # engine matched a verse but the GT words are something else entirely
    assert label_detection(det(0, 3, canon="شيء اخر لا علاقة"), c).tier == "asr_mismatch"


def test_hadith_region_and_silent():
    toks = "والله اني لاستغفر الله واتوب اليه في اليوم اكثر من سبعين مرة".split()
    c = ctx(toks, hadith=[HadithRegion(0, len(toks))], unit=toks)
    d = det(0, len(toks) - 1, src="HADITH", canon=" ".join(toks), unit="h1")
    lab = label_detection(d, c)
    assert (lab.tier, lab.boundary) == ("pos_strong", "COMPLETE_SPAN")
    assert label_detection(d, ctx(toks)).tier == "silent"


def test_hadith_missing_end_when_matn_continues_in_asr():
    toks = "والله اني لاستغفر الله واتوب اليه في اليوم اكثر من سبعين مرة".split()
    c = ctx(toks, hadith=[HadithRegion(0, len(toks))], unit=toks)
    d = det(0, 7, src="HADITH", canon=" ".join(toks[:8]), unit="h1")     # engine stopped after «في اليوم»
    assert label_detection(d, c).boundary == "MISSING_END"


def test_unalignable():
    c = ctx(["a", "b", "c", "d"])
    c.al.asr2gt = [-1, -1, -1, -1]
    assert label_detection(det(0, 3), c).tier == "unalignable"


def test_cue_words_are_not_boundary_evidence():
    u = "قال الله هذا يوم ينفع".split()
    toks = ["قال", "الله"] + u[2:]                 # speaker's «قال الله» cue directly before the detection
    span = QuranSpan("5:119", 0, 5, 0, 5, 5, 5)
    c = ctx(toks, quran=[span], unit=u)
    d = det(2, 4, canon=" ".join(u[2:]), unit="5:119", qseg=[[2, 5]])
    assert label_detection(d, c).boundary == "COMPLETE_SPAN"
