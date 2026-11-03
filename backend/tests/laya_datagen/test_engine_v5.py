"""Engine v5 regression cases: real ASR snippets from the reviewed Bin Baz lessons (docs/review-notes.md, note numbers
in each test). Word indices are positions in the snippet. v4 must keep its own behaviour (it is what v5 is measured
against), so a few v4 outputs are pinned too."""
import shutil

import pytest

from backend.laya_datagen.engine_bridge import EngineBridge, REPO_ROOT

HADITH = REPO_ROOT / "data" / "corpora" / "hadith_open_hadith_data.json"
pytestmark = pytest.mark.skipif(
    not shutil.which("node") or not (REPO_ROOT / "data" / "corpus.json").exists() or not HADITH.exists(),
    reason="needs node, data/corpus.json and the Open Hadith Data corpus",
)

FATIR_6 = "هذه الحالة جزاكم الله خيرا؟ نعم، وسألت كلها من الشيطان، إن الشيطان لكم عدو فاتخذه عدوها، إنما يدو حزبها ليكون من أصحاب السعيد، هو عدونا، لا يزال إيهة الإنسان يقول له يذكر كذا،"
FAJR_14 = "الثلاث التي يُباح بها الكذب، موفق الله جميعاً وقال تعالى إن ربك لب المرصاد، وقال تعالى يعلم خائنة الأعين وما تخفي الصدور،"
TAHA_41 = "إن الله حذر العباد غيره؟ أو يتأول قوله لكلمه موسى واصطنعتك لنفسي، فيقول معناه واصطنعتك لغيري من المخلوق، أو يقول أراد روح"
IMRAN_19 = "وهي تعبئها وصحبة ويتوحيد الله وطاعته، هذه العبادة، هي الإسلام، إن الدين عند الله الإسلام، هي الإيمان، قال تعالى يا أيها الذين آمنوا وآمنوا بالله"
NAJM_23 = "كله، إن الدين إن الله الإسلام، والإيمان دعوه سبون شعبه، ولقد جاءها من ربهم الهدى، ولكن بر من اتقى، إن الأمرار ما في نعيم، فهم"
INFITAR_10_11 = "يلفظ من قول إلا لديه رقم عتيك، وإن عليكم نحافظين كراما كاتبين على ونحفظين فجد رمك يا عبد الله أن تحرس على"
YUSUF_108 = "تعالى ومن أحسن وقول ممن دعا إلى الله وعمل سبحانه قال هذه سبيلي أدعوه لله على بصيره، أنا ومن اتبعني؟ قال النبي صلى الله عليه وسلم من دل على خير"
ANKABUT_1 = "وخير متنى، ويقول سبحانه ألف لام ميم، أحسب الناس ويتركوه، ويقولوا آمنا وهم لا يفتنون ولقد فتنل من قبلهم، فليعبن الله لينصدقوا، ولا يعبن الكاذبين،"
ANBIYA_47 = "الله سرع حساب، إن الله لا يظلم مثق لذلك الله، ونضع الموازين قصة يغلق قيامة فلا تظلم نفسي شيء، وإن كان مثق لحبة من خرق أتينا بها وكفى بنا حاسباً أنت يا عبد الله حاسب نفسك، هكذا أنت يا عمد"
MUSLIM_2699 = "له، وتشيعاً، وبالحديث الآخر يقول صلى الله عليه وسلم من سلك طريقاً يلتمس فيه علماً سهل الله له بك طريق الجنة، وبالحديث الآخر من يريد الله بخير يوقفه في الدين، فطلب"
AHZAB_35 = "في صفات المؤمنين وإن في أخلاقهم إن المسلمين والمسلمات والمؤمنين والقانتين والقانتات والصادقين والصادقات، إلى أن قال في آخرها والذاكرين الكثير والذاكرات أعدى الله لهم مغفرة وأجراً عظيمة والصدق من أهم خسار الدين، في"
MUSLIM_2378 = "هريرة رضي الله عنه قال قل يا رسول الله من أكرم الناس؟ قال أتقاهم، فقالوا ليس عن هذا نسألك، قال فيوسف نبي الله ابن نبي الله ابن نبي الله ابن خليل الله، قالوا ليس عن هذا نسألك، قال فعن معادن العرب تسألوني خيارهم في الجاهلية، خيارهم في الإسلام إذا فقه، وفقه بضم القاف على المشهور،"
BUKHARI_3124 = "أن نبي من الأنبياء من قبل نبينا عليه الصدوة رسول الله صلى الله عليه وسلم غزى جماعة من المشركين، فقال لقومه لا يتبعني رجل عقد على امرأة ولم يدخل بها،"
BUKHARI_1283 = "قوة إلا بالله وصلى الله وسلم عن نبينا محمد وعلى أمي ورسوله اتق الله واصبري، فقالت إليك عني فإنك لم تُصب بمصيبتي ولم تعرفه، فقيل لها إنه"
ZUMAR_62 = "يوجد ذات كل النصوص في ذات الله، إن ربكم الله، الله خالق كل شيء الرحمن الرحيم، ملك القدوس، كلها في ذات الله نعم رسول"
BUKHARI_1458 = "إله إلا الله، فإن معناها توحيدة، وفي رواية فليكن أول ما تدعوهم إليه عبادة الله، وذلك هو الكفر بالطاغوت والإيمان بالله، كما قال"
RIYAD_357 = "حسن صحيح وعن ابن عباس رضي الله عنهما قال قدم عيينة بن حصن فنزل على ابن أخيه الحر بن قيس وكان من النفر الذين يدنيهم عمر رضي الله عنه وكان القراء أصحاب مجلس عمر رضي الله عنه ومشاورته كهولاً كانوا أو شباناً فقال عينة لابن أخيه يا ابن أخي لك وجه عند هذا الأمير فاستأذن لي عليه، فاستأذن فأذن له عمر، فلما دخل قال هي يا ابن الخطاب، فوالله ما تعطينا الجزل ولا تحكم فينا بالعدل، فغضب عمر رضي الله عنه حتى هم أن يوقع به، فقال له الحر يا أمير المؤمنين، إن الله تعالى قال لنبيه صلى الله عليه وسلم خذ العفو وأمر بالعرف وأعرض عن الجاهلين، وإن هذا من الجاهلين، والله ما جاوزها عمر حين تلاها، وكان وقافاً عند كتاب الله تعالى، رواه البخاري وعن ابن مسعود رضي"


@pytest.fixture(scope="module")
def bridge():
    with EngineBridge(hadith_path=str(HADITH), extra_engine_files=["js/engine_v5.js"]) as b:
        yield b


def find(dets, unit):
    hit = [d for d in dets if d["unitId"] == unit or unit in (d.get("candidateRefs") or [])]
    assert hit, f"{unit} not found in {[(d['unitId'], d['wordStartIdx'], d['wordEndIdx']) for d in dets]}"
    return hit[0]


def span(d):
    return d["wordStartIdx"], d["wordEndIdx"]


def test_endings_and_dropped_letters_full_ayah(bridge):            # notes 6 / 19: فاطر:6, missed by v4
    assert not [d for d in bridge.detect("v4", FATIR_6.split()) if d["unitId"] == "35:6"]
    assert span(find(bridge.detect("v5", FATIR_6.split()), "35:6")) == (10, 22)


def test_word_split_in_two(bridge):                                  # note 18: «لب المرصاد» = «لبالمرصاد»
    assert span(find(bridge.detect("v5", FAJR_14.split()), "89:14")) == (10, 13)


def test_two_word_rare_ayah_with_qawl_cue(bridge):                   # note 17: طه:41 after «قوله»
    assert span(find(bridge.detect("v5", TAHA_41.split()), "20:41")) == (10, 11)


@pytest.mark.parametrize("text, unit, expected", [(IMRAN_19, "3:19", (10, 14)), (NAJM_23, "53:23", (10, 14))])
def test_fragment_of_common_words(bridge, text, unit, expected):     # notes 17 / 6: آل عمران:19, النجم:23
    assert span(find(bridge.detect("v5", text.split()), unit)) == expected


def test_consecutive_short_ayat(bridge):                             # notes 20 / 13: الانفطار:10-11 («نحافظين»)
    dets = bridge.detect("v5", INFITAR_10_11.split())
    assert span(find(dets, "82:10")) == (7, 9)
    assert span(find(dets, "82:11")) == (10, 11)


def test_qal_for_verse_initial_qul(bridge):                          # note 8: يوسف:108 «قال هذه سبيلي»
    assert span(find(bridge.detect("v4", YUSUF_108.split()), "12:108"))[0] == 11
    assert span(find(bridge.detect("v5", YUSUF_108.split()), "12:108"))[0] == 10


def test_spelled_out_muqattaat(bridge):                              # note 9: «ألف لام ميم» = العنكبوت:1
    assert span(find(bridge.detect("v5", ANKABUT_1.split()), "29:1")) == (4, 6)


def test_suffix_variant_at_the_end(bridge):                          # note 6: «حاسباً» for «حاسبين»
    assert span(find(bridge.detect("v5", ANBIYA_47.split()), "21:47")) == (10, 29)


def test_quote_from_mid_hadith_without_waw(bridge):                  # note 13: «من سلك» for «ومن سلك»
    assert span(find(bridge.detect("v5", MUSLIM_2699.split()), "OHD:Muslim:2699a"))[0] == 9


def test_identical_ending_takes_the_neighbouring_ayah(bridge):       # note 12: الأحزاب:35, not الفتح:29
    v4 = bridge.detect("v4", AHZAB_35.split())
    assert any(d["unitId"] == "48:29" for d in v4)
    v5 = bridge.detect("v5", AHZAB_35.split())
    assert [d["unitId"] for d in v5] == ["33:35", "33:35"]
    assert span(v5[1]) == (19, 27)


def test_hadith_word_endings(bridge):                                # notes 4 / 6: «فقه» (فقهوا), «اتق» (اتقي), «غزى» (غزا)
    assert span(find(bridge.detect("v5", MUSLIM_2378.split()), "OHD:Muslim:2378"))[1] == 49
    assert span(find(bridge.detect("v5", BUKHARI_1283.split()), "OHD:Bukhari:1283"))[0] == 12
    assert span(find(bridge.detect("v5", BUKHARI_3124.split()), "OHD:Bukhari:3124"))[0] == 15


def test_multi_home_phrase_is_kept_as_ambiguous(bridge):             # note 17: «الله خالق كل شيء» (الزمر:62 / الرعد:16 …)
    d = find(bridge.detect("v5", ZUMAR_62.split()), "الزمر: 62")
    assert d["isAmbiguous"]


def test_riwaya_cue_is_strong(bridge):                               # note 27: «وفي رواية»
    v4 = find(bridge.detect("v4", BUKHARI_1458.split()), "OHD:Bukhari:1458")
    v5 = find(bridge.detect("v5", BUKHARI_1458.split()), "OHD:Bukhari:1458")
    assert v5["hasCitationCue"] and v5["totalScore"] > v4["totalScore"]


def test_long_hadith_is_one_finding(bridge):                         # note 14: card 87, start inside «رضي الله عنه»
    v4 = [d for d in bridge.detect("v4", RIYAD_357.split()) if d["unitId"] == "OHD:RiyadSalihin:357"]
    assert len(v4) == 2
    v5 = [d for d in bridge.detect("v5", RIYAD_357.split()) if d["unitId"] == "OHD:RiyadSalihin:357"]
    assert [span(d) for d in v5] == [(2, 125)]
