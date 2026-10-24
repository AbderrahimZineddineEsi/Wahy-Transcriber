# Review notes

Notes taken while reviewing the Laya stages. A repeated note gets ×2, ×3 … instead of a new entry.

**Progress**: stage 2 reviewed up to card 162 (2026-10-23). **Stage 3 finished.** Stage 4 started.

## 1. Hadith boundaries: matn-only findings are often incomplete

Pattern seen while reviewing: a hadith finding that catches only the **matn** is sometimes not a good finding.
Part of the **sanad** (e.g. «عن أبي هريرة قال: قال رسول الله ﷺ») is sometimes needed to understand the quote,
the sheikh says it, but the engine doesn't catch it.

This changes the goal for hadith. To do:
- Define the policy: when does the sanad / introduction belong to the hadith finding?
- **Engine**: change it so it can extend a hadith finding to the sanad part the sheikh said.
- **Laya**: train it to flag these as missing (boundary) parts.
- **Other models (JEV / Gemini …)**: prompt them to catch these missing parts.

## 2. New boundary label: the finding reaches PAST the quote ("Extra start" / "Extra end")

Seen on stage 1, card 74. The opposite of *Missing start*: the detection includes words **before** (or after) the
ayah that are not part of it (the sheikh's own words, a cue, the previous sentence…).

Idea: add it as a boundary answer for the AI review (Laya + models), next to Complete / Missing start / Missing end.
Name suggestions: **Extra start / Extra end** (alternatives: "Overshoot start", "Too long at start").

Open question (note 2): the labels can combine (missing start + extra end), so either a list of all combinations or two
separate questions (start: ok / missing / extra · end: ok / missing / extra).

## 3. Ayat quoted inside a hadith ×2

Seen on stage 1, card 92. A hadith that contains an ayah: should the ayah be its own finding? If it is, it cuts the
hadith finding in half.

To define:
- Policy: one hadith finding that contains the ayah, or a hadith finding + a nested ayah finding?
- Engine: make this an explicit exception (don't split the hadith around the ayah).
- Laya / models: how to label such a finding (hadith complete? ayah separate?).

Already in the code: engine v4 keeps a verse quoted inside a hadith as `embeddedQuran` on the hadith finding
(design point 4 in the header of `js/engine_v4.js`), so part of this exception may already exist; check v3 and the
GT extractor (which currently extracts the ayah on its own when the written text puts a [سورة: آية] ref inside the hadith).

×2 — stage 4, card 54: الأنعام:65 inside the hadith of Jabir (`binbaz_audio_1939|719-758|6:65`): the Prophet ﷺ answers each
part of the ayah as it is revealed («قل هو القادر على أن يبعث عليكم عذابا من فوقكم، **قال النبي ﷺ أعوذ بوجهك**، قال أو من
تحت أرجلكم…»). The engine found the ayah (VERIFIED) across the hadith's words; v4 did **not** set `embeddedQuran`.
Done (2026-10-24): new verdict **📖 Ayah inside a hadith** on stage 2 / 4 cards. Boundary is judged against the ayah;
exported to Laya as a real quote, tagged `in_hadith`; counted as a hit in the engine stats, shown separately.

## 4. Engine should handle حروف العلة (ا / و / ي) variations

Seen on stage 2, card 7 (صحيح البخاري 1283, «اتقي الله واصبري»). The ASR wrote «**اتق** الله واصبري»: the final ي of
«اتقي» was dropped, so the engine did not match that word and the finding starts at «الله». The sheikh said the word.
→ the engine's word matching should tolerate a long-vowel letter (ا و ي) being dropped / added / swapped
(اتق↔اتقي, يدعو↔يدعوا, …), the way it already tolerates other ASR noise.

Related labeller weakness found here: the automatic label said *Complete*, because for hadith I only count a cut start
when ≥2 words are missing; a single missing word («اتقي») is ignored. → lower that to 1 word when the word is a close
match (like here).

## 5. Laya should infer missing parts from cues and context, even when the ASR destroyed the words ×2

Seen on stage 2, card 13. The ASR produced garbage at the start of the quote, so the engine missing the start is
**not its fault** (labelled with the new "not the engine's fault" toggle). But a cue like «قال جل وعلا» right before
the garbled part still shows the quote started earlier → Laya should learn to answer *Missing start* from the cue +
garbled words, even though the words themselves are unreadable.

Impact:
- Training data: keep these as *Missing start* (your label wins over my automatic one).
- Automatic labeller: today it only says Missing start when the missing words are recognisable in the ASR, and it
  ignores cue words on purpose (note on «قال الله» verses) → for this case, a cue followed by unaligned/garbled words
  before the finding should also count as evidence.
- Prompt for JEV / Gemini: say that a citation cue followed by garbled words before the span means the quote likely
  started earlier.

×2 — stage 2, card 25 (the **end** side): الأنعام:116. After «قال جل وعلا» the engine caught only «وإن تطع أكثر»; the ASR
continues with garbled words «منه ذلك عن **شبيل الله**» = «من في الأرض يضلوك عن **سبيل الله**». Not the engine's fault,
but Laya should follow the ayah to the end of the sentence (cue at the start + garbled words that still echo the rest of
the verse, e.g. «سبيل الله») and answer *Missing end*. Same consequences as above, for the end of the span.

## 6. Engine and ASR word endings (end letters) ×6

Seen on stage 2, card 14: should be an easy detection for the engine but it got it wrong. → Look into how the engine
deals with ASR changes in the **last letters** of words (ة / ه / ا / ى / ي / tanwin endings).
Candidate example (my reconstruction of card 14, to confirm): الطلاق:12, ASR «… أحاط بكل شيء **علمه**» for «علما».
Related to note 4 (حروف العلة): both are ASR spelling variants the word matcher should tolerate.

×2 — stage 2, card 51: صحيح مسلم (2378) «من أكرم الناس…» (`binbaz_audio_571|2231-2273|OHD:Muslim:2378`).
Both ends are lost on a word ending:
- **end**: hadith «… خيارهم في الإسلام إذا **فَقِهُوا**», ASR «إذا **فقه**، وفقه بضم القاف…» → «فقهوا» lost its «وا», the
  engine stops at «إذا». → *Missing end*.
- **start**: hadith «**قِيلَ** يا رسول الله», ASR «قال **قل** يا رسول الله» → «قيل» lost its ي (also note 4). → *Missing start*.
Correct answer: *Missing both*. My automatic label said *Complete* (single-word misses ignored for hadith, see note 4).

×3 — stage 2, card 78: final alif «غَزَا» vs alif maqsura «غزى» should match easily but doesn't.
**Root cause found**: the engine's normaliser (`js/engine.js` line 174, `s.replace(/ى/g, "ي")`) turns every ى into ي,
so «غزى» → «غزي» while «غزا» / «غَزَا» → «غزا»: never an exact match (same for رمى/رما, سعى/سعا …).
→ fix idea: normalise a word-final ى **and** ا to one letter (or treat final ا / ى / ي as equal when matching words);
check it doesn't merge real pairs (e.g. على vs علا).

×4 — stage 2, card 110: الأنبياء:47 (`binbaz_audio_821|4133-4151|21:47`). The finding stops at «وكفى بنا»; the next ASR word
is «**حاسباً**» for the ayah's last word «**حَاسِبِينَ**» (ending ـاً vs ـين: singular/accusative vs plural). A further
stretch than ا/ى or a dropped letter — maybe doable for the engine (same stem «حاسب», different suffix), not sure.
Either way a **good Laya example** for *Missing end*: the stem clearly continues the ayah right after the span.

×5 — stage 3, card 57: فاطر:6, a **full 13-word ayah** (`binbaz_audio_820|Q|35:6|4064`), missed by **v4** (v3 caught it).
ASR «إن الشيطان لكم عدو **فاتخذه عدوها**، إنما **يدو حزبها ليكون** من أصحاب **السعيد**». Only 7 of 13 words match exactly,
and 5 of the 6 misses are endings: فاتخذوه→فاتخذه, عدوا→عدوها, حزبه→حزبها, ليكونوا→ليكون, السعير→السعيد (+ يدعو→يدو).
A long ayah with half its words exact should never be missed — see note 19 (v4 misses what v3 catches).

×6 — stage 3, card 72: النجم:23 (`binbaz_audio_571|Q|53:23|2382`), missed by both. ASR «ولقد **جاءها** من ربهم الهدى» vs
ayah «وَلَقَدْ **جَاءَهُم** مِّن رَّبِّهِمُ الْهُدَىٰ»: the pronoun suffix swapped (ـهم → ـها). Also a 5-word fragment of a long ayah,
so the "too short" threshold (note 17) adds to it: one ending mismatch is enough to drop it under the bar.
→ pronoun suffixes (ـه / ـها / ـهم / ـهن / ـكم …) are another ending family the word matcher should treat as near-matches.

## 7. Obvious missing end not detected (engine) — and not labelled (me)

Seen on stage 2, card 21: الأربعون النووية (19), «احفظ الله يحفظك…». The finding stops at «… تعرف إلى الله في الرخاء
يعرفك **في**» and the ASR right after continues the hadith word for word: «**الشدة، واعلم أن ما أخطأك لم يكن ليصيبك**»,
exactly the corpus words that follow. Obvious *Missing end*.
- **Engine**: study why it stopped there. Likely the takhrij in the middle («رواه الترمذي وقال حديث حسن صحيح، وفي رواية
  غير الترمذي…»): the book quotes a second riwaya after the takhrij and the engine treats the takhrij as the end.
- **My automatic label also said *Complete*** (wrong): my hadith region ends at the takhrij, so the words after it are
  not counted as part of the quote. → the hadith GT region must continue through «وفي رواية …» when the riwaya continues.

## 8. ASR writes «قُلْ» as «قال» — engine doesn't recognise it (pattern)

Seen on stage 2, card 24: يوسف:108 «**قُلْ** هَٰذِهِ سَبِيلِي أَدْعُو إِلَى اللَّهِ…». The ASR wrote «… سبحانه **قال** هذه سبيلي أدعوه لله…», so the
engine starts at «هذه» and drops the verse's first word «قل». This is a pattern (ASR hears/writes قل as قال), not a one-off.
→ study in the engine: allow «قال» to match a verse-initial «قل» (and the reverse), probably as a known ASR confusion.
Careful: «قال» is also the most common cue word (see notes 5 and the «قال الله» verses), so the rule must not turn every
«قال» before a verse into part of the verse — e.g. only when the verse itself starts with «قل».

## 9. Consecutive ayat: one finding per ayah, or the whole passage? (to define)

Seen on stage 2, card 30: العنكبوت:2, said right after «ألف لام ميم» (= العنكبوت:1 «الم») and followed by العنكبوت:3.
Question: when a finding is reviewed (by me, Laya or a model), is it judged alone, or together with the neighbouring ayat?

How it works today (checked in the code):
- **Each finding = one ayah, everywhere.** Missing start / end is measured inside *that* ayah only, so a neighbouring
  ayah said before/after is **not** a missing part (it is its own finding). Card 30 → *Complete*.
- **App** (`ai-verifier.js`): one request per finding. **Laya** gets the finding alone. **Gemini / JEV / chat** get the
  same finding **plus the neighbouring findings within 12 words** as context (`neighbor_findings` + a "merge?" question),
  when the "suggest merges" rule is on (default: on). Grouping consecutive ayat into one block is display-only.
- **This notebook**: every model gets the finding alone (no neighbour context) → stage-5 results for Gemini/JEV are not
  exactly what the app sends. To fix for parity if we keep the app's behaviour.

Decide: keep one-ayah findings (+ neighbours as context), or review consecutive ayat as one passage?

Also seen on card 30: the engine did **not** detect العنكبوت:1, because the ASR spells the letters out («ألف لام ميم»
for «الم»). → engine: map spelled-out muqatta'at (ألف لام ميم, حا ميم, …) to the letters.

## 10. Showcase examples (engine doing well)

Findings worth keeping to show how good the engine is.

- **Stage 2, card 32** — الفرقان:68, full ayah, VERIFIED, no mistake, despite heavy ASR noise
  (lesson «03 من حديث (أن امرأة من جهينة…)», `binbaz_audio_565`, at 2:02; label key `binbaz_audio_565|215-235|25:68`).
  - ASR:    «والذي لا **يدون** مع الله إلهاً آخر، ولا **يقتل النسلة** حرم الله إلا بالحق ولا يزنون، ومن يفعل ذلك **يلقى أذاماً**»
  - Ayah:   «وَالَّذِينَ لَا يَدْعُونَ مَعَ اللَّهِ إِلَٰهًا آخَرَ وَلَا يَقْتُلُونَ النَّفْسَ الَّتِي حَرَّمَ اللَّهُ إِلَّا بِالْحَقِّ وَلَا يَزْنُونَ وَمَن يَفْعَلْ ذَٰلِكَ يَلْقَ أَثَامًا»
  - Survives: يدعون→يدون, يقتلون النفس التي→يقتل النسلة, أثاما→أذاما.

## 11. ASR hallucinated ENGLISH in the middle of an Arabic lesson

Seen on stage 2, card 54: البقرة:286 (`binbaz_audio_571|2582-2586|2:286`, at 27:18). Right after
«لا يكلف الله نفسه إلا **وإنه**» (= «نفسا إلا **وسعها**») the ASR writes:
«… فالأِعِي **there's what i live well there's what you sing from ive have loved to know what you can sell**».
The Groq request already forces `language="ar"`, so this is a known Whisper failure: on unclear audio (old tape, noise,
crosstalk) it can hallucinate English. Count so far: 35 English words in 3 of the 15 lessons.

Card 54 itself: *Real quote · Missing end* («وسعها» garbled into «وإنه»), *not the engine's fault*.

To do:
- ASR quality check: flag lessons / stretches with Latin-script runs (and other hallucination signs, e.g. repeated loops).
- Decide what to do with them: re-transcribe that stretch (local whisper / another model), or mark it as unusable.
- App: the same can happen in real lectures → the app could warn about or hide Latin-script runs in an Arabic transcript.

- **Stage 2, card 73** — الإخلاص:4, full ayah, despite a badly misheard key word
  (lesson «التوحيد فضله وأنواعه وحكمه», `binbaz_audio_820`, at 8:28; label key `binbaz_audio_820|928-932|112:4`).
  - ASR:  «ولم يكن له **كبول** أحد»
  - Ayah: «وَلَمْ يَكُن لَّهُ **كُفُوًا** أَحَدٌ»
  - Survives: كفوا→كبول, and a short (5-word) ayah, where there is little context to lean on.

- **Stage 2, card 97** — الشورى:25, full ayah (12 words), VERIFIED, with three misheard words in one ayah
  (lesson «02 من: ( باب التوبة )», `binbaz_audio_561`, at 14:31; label key `binbaz_audio_561|1340-1352|42:25`).
  - ASR:  «وهو الذي يقبل التوبة عن عباده، **ويعبو** عن السيئات، **ويا له** ما **تفعلوا**»
  - Ayah: «وَهُوَ الَّذِي يَقْبَلُ التَّوْبَةَ عَنْ عِبَادِهِ **وَيَعْفُو** عَنِ السَّيِّئَاتِ **وَيَعْلَمُ** مَا **تَفْعَلُونَ**»
  - Survives: ويعفو→ويعبو, ويعلم→ويا له (one word split into two), تفعلون→تفعلوا, and still matched to the last word.

- **Stage 2, card 98** — الأنعام:101, VERIFIED, 16 of 18 words, through very heavy ASR noise
  (lesson «التوحيد فضله وأنواعه وحكمه», `binbaz_audio_820`, at 8:18; label key `binbaz_audio_820|902-914|6:101`).
  - ASR:  «بديع **السعر** أن يكون ولد ولم تكن له صاحبة، وخلق كل شيء بكل | **شهر**، وقال سبحانه…»
  - Ayah: «بَدِيعُ **السَّمَاوَاتِ وَالْأَرْضِ** أَنَّىٰ يَكُونُ لَهُ وَلَدٌ وَلَمْ تَكُن لَّهُ صَاحِبَةٌ وَخَلَقَ كُلَّ شَيْءٍ وَهُوَ بِكُلِّ **شَيْءٍ عَلِيمٌ**»
  - Survives: السماوات والأرض→السعر (two words collapsed into one). Not perfect: *Missing end* — «شيء عليم» became
    «شهر» right after the span. Good showcase of the **engine + Laya pair**: the engine finds the ayah, Laya fixes the end.

- **Stage 2, card 155** — العصر:2, full ayah, VERIFIED, short ayah with a word split by the ASR
  (lesson «01 من: ( باب الإخلاص وإحضار النية…)», `binbaz_audio_2950`, at 14:30; label key `binbaz_audio_2950|1515-1519|103:2`).
  - ASR:  «إن الإنسان **لا في** خسر»
  - Ayah: «إِنَّ الْإِنسَانَ **لَفِي** خُسْرٍ»
  - Survives: لفي split into «لا في» (one word → two, the second a common word) in a 4-word ayah, plus خسر without its case ending.

- **Stage 4, card 70** — صحيح مسلم (1893) «من دل على خير فله مثل أجر فاعله», the matn found to its last word through a mangled ending
  (lesson «01 من: ( باب الإخلاص وإحضار النية…)», `binbaz_audio_2950`, at 14:09; label key `binbaz_audio_2950|1468-1479|OHD:Muslim:1893a`).
  - ASR:    «صلى الله عليه وسلم من دل على خير فله مثل **أي فائلة**»
  - Hadith: «صلى الله عليه وسلم مَنْ دَلَّ عَلَى خَيْرٍ فَلَهُ مِثْلُ **أَجْرِ فَاعِلِهِ**»
  - Survives: أجر فاعله→«أي فائلة» (both closing words misheard) on a short, famous hadith; first hadith in the showcase.

## 12. Right words, wrong ayah: identical endings + a neighbouring ayah (MUST fix in engine)

Seen on stage 2, card 82 (`binbaz_audio_567|4027-4029|48:29`). The sheikh recites the end of **الأحزاب:35**
«والذاكرين الله كثيرا والذاكرات أعد الله لهم مغفرة وأجرا عظيما». The engine:
1. caught the first part as الأحزاب:35 (words 4008–4015),
2. lost «أعد الله لهم» (ASR «أعدى الله لهم»),
3. matched the last 3 words «مغفرة وأجرا عظيما» as a **separate** finding and gave it **الفتح:29** (same ending words).
Taken alone the 3 words are a correct quote; linked with the missing start it is the wrong ayah. Could not be labelled
with the current buttons (my automatic label said *Real quote*, flag `ref_differs`, GT ayah 33:35).

To do:
- **Engine (must)**: when several ayat match the same words, prefer the one that is the same as / adjacent to (same
  surah, ±1 ayah) a finding right before or after it. Here 33:35 was detected ~12 words earlier → this should extend
  that finding (or at least get its reference), not become الفتح:29.
- **Labels**: ✅ done (2026-10-23) — toggle **"Reference wrong / incomplete"** on stage 2 / 4 cards (see note 22).
  Card 82 can now be labelled: *Real quote · Complete* + reference wrong.
- **Laya**: think about sending more than one candidate reference (e.g. all ayat with this wording + the neighbour's
  ayah) so it can judge "is this a quote, and of which ayah". Check the cost: more text in a 1024-token state.

## 13. First letters: «ال» and prefix letters (و ف ب ك ل) dropped / added / swapped by the ASR ×6

Seen on stage 2, card 84: ASR «**مهتدون**» vs ayah «**الْمُهْتَدُونَ**» — should be an easy match for the engine.
Checked: the engine's normaliser keeps «ال» as part of the word («مهتدون» → `مهتدون`, «المهتدون» → `المهتدون`,
«والمهتدون» → `والمهتدون`), so these are different words to it and the match fails.
→ new rule: when comparing a transcript word with a verse word, treat a missing / extra «ال» (also after و / ف / ب / ك / ل:
وال، فال، بال، كال، لل) as a near-match instead of a mismatch. Same family as notes 4 and 6 (ASR spelling variants).

×2 — stage 2, card 89: ASR «**المتقين**» vs ayah «**لِلْمُتَّقِينَ**» (ل + ال → «لل»). Engine tokens: `المتقين` vs `للمتقين` →
mismatch. The problem is the **first letters** in general, not only «ال»: a prefix letter (و ف ب ك ل) dropped or added, and
«ال» ↔ «لل». → compare words after stripping these prefixes (with a small penalty), instead of requiring the full word.

×3 — stage 2, card 91: the reverse direction — ASR «**الحساب**» (extra «ال») vs ayah «**حِسَابٍ**» (no «ال»). The rule has to
work both ways: «ال» added by the ASR as well as dropped.

×4 — **stage 3** (missed GT), card 4: البقرة:21 (`binbaz_audio_182|Q|2:21|304`). ASR «يا أيها الناس **عبدوا** ربكم» vs ayah
«يَا أَيُّهَا النَّاسُ **اعْبُدُوا** رَبَّكُمُ»: the initial alif (همزة الوصل) dropped. **v4 missed it, v3 caught it** → whatever v3 does
here (fuzzy first letters?) is worth comparing. → define the first-letter rules as one set: «ال», prefix letters,
and the hamzat-wasl alif (ا at the start of imperative verbs / «اسم» / «ابن» …).

×5 — stage 3, card 6: ASR «**نحافظين**» vs ayah «**لَحَافِظِينَ**»: the first letter is **replaced** (لام التوكيد ل → ن), not
dropped or added. So the first-letter rules also need: a one-letter prefix (ل / و / ف / ب) misheard as another letter,
treated as a near-match when the rest of the word is identical.

×6 — stage 4, card 127 (truly weird case, worth studying): صحيح مسلم (2699) «**ومن** سلك طريقاً يلتمس فيه علماً سهل الله له به طريقاً
إلى الجنة» (`binbaz_audio_561|2705-2715|OHD:Muslim:2699a`). The sheikh says «يقول صلى الله عليه وسلم **من** سلك طريقاً…»: the
finding starts at «سلك» and drops «من», right after a perfect cue. Tested:
- said «**من** سلك…» → span starts at «سلك» (qSeg 45)
- said «**ومن** سلك…» → span starts at «ومن» (qSeg 44)
So the only cause is the prefix «و»: the hadith text has «ومن» (the sentence is taken from the middle of a long hadith,
where it continues with «و»), the sheikh starts his quote without it. Made worse because «من» is a very common word with
a tiny weight, so the alignment gains nothing by extending to it. → a quote taken from the middle of a hadith very
often drops the joining «و» / «ف»: the first-letter rule must cover the **first word of a span** in particular.

## 14. ⚠ IMPORTANT — parenthetical phrases (جمل اعتراضية) must not affect a finding ×2

Seen on stage 2, card 87: رياض الصالحين (357), the story of عيينة بن حصن and عمر (`binbaz_audio_567|2279-2325|…:357`).
The finding starts at «… **الله عنه** حتى هم أن يوقع به…», cutting the honorific in half: the ASR right before it is the
same hadith («… ما تعطينا الجزل ولا تحكم فينا بالعدل، فغضب عمر **رضي**»), so the start was lost at «رضي الله عنه».

Principle: parenthetical phrases are added by the speaker or present only in the corpus (honorifics «رضي الله عنه»,
«صلى الله عليه وسلم», «عز وجل», «سبحانه وتعالى», «تعالى»; short asides «يعني», «أي», «قال»…). They should be skipped
transparently: never split, end, or shorten a finding, and never count as missing / extra words.

How the engine handles gaps today (to study):
- v4: extra transcript words between two matched words are *priced* (open 1.6 + 0.7 per word), allowed up to
  `maxTGap` (12 by default, **10 in the app**); a gap of ≥ 3 words is reported as commentary (`segmentGapMin`).
- v3: `EXEGETICAL_MARKERS` list; for hadith the allowed transcript gap is only **6** words.
- Honorific / isnad words get a very low weight (`CITATION_AND_ISNAD_WORDS`, formula multipliers), so the local
  alignment may prefer to start or stop on them, as on card 87.
→ make known parenthetical phrases free to skip (zero gap cost, both when added in the speech and when missing from it),
and never let a finding boundary fall inside one.

×2 — stage 4, card 66: جامع الترمذي (1987) «وأتبع السيئة الحسنة تمحها وخالق الناس بخلق حسن» (`binbaz_audio_567|6933-6945|…:1987`).
The sheikh inserts his explanation in the middle: «… تمحوها **الحسنة يمحو الله بها السيئات** وخالق الناس بخلق حسن». Here the
engine handled it well: one finding in 2 segments around the inserted words.
Done (2026-10-24): new toggle **"Sheikh's words inside the quote"** on stage 2 / 4 cards (independent of verdict and
boundary). The engine report shows how many of these quotes the engine split around the inserted words; the training
row keeps the flag `has_insertion`.

## 15. Words completely removed by the ASR

Seen on stage 2, card 115: فصلت:33 (`binbaz_audio_2950|1447-1454|41:33`). ASR: «قال تعالى ومن أحسن وقول ممن دعا إلى الله
وعمل | سبحانه قال هذه سبيلي…». The rest of the ayah «**صالحا وقال إنني من المسلمين**» is simply absent from the transcript
(deleted by the ASR, not misspelled), so the finding ends at «وعمل».

How the engine deals with deletions today (to study):
- A deletion **inside** a quote: v4 lets a few verse words be skipped between two matched words (`maxVGap`: 3 by default,
  **2 in the app**); a longer deletion splits the quote into two findings, or drops the weaker part.
- A deletion at the **end / start**: there is nothing left to match, so the engine cannot recover it → *Missing end*,
  *not the engine's fault*; only Laya can flag it, from context (the ayah stops mid-sentence at «وعمل», and the
  sheikh moves on to the next citation «سبحانه قال…»).
→ check whether `maxVGap = 2` in the app is too strict for ASR deletions inside a quote, and how a split quote is shown.
Related: note 5 (Laya infers missing parts from context).

## 16. Short quote through very noisy ASR: engine should still catch it (borderline)

Seen on stage 3, card 15: النحل:74 «فَلَا تَضْرِبُوا لِلَّهِ الْأَمْثَالَ» (`binbaz_audio_821|Q|16:74|2291`), missed by **both** engines.
ASR: «… ولم يكن له كفوا أحد، **ولا اقتربوا الله الأمثال**، كل هذا نفي مجمل…». Word by word:
- «ولا» ↔ «فلا» — first letter swapped (note 13)
- «اقتربوا» ↔ «تضربوا» — really garbled
- «الله» ↔ «لله» — first letters ال / لل (note 13)
- «الأمثال» ↔ «الأمثال» — exact
Today only 1 of 4 words matches exactly, too little for a 4-word fragment. With the first-letter rules of note 13, 3 of 4
would match → the engine could catch it. Context helps too: it comes in a list of cited verses (right after الإخلاص:4).
Labelled *Engine should catch it* (borderline: the ASR is very noisy).

## 17. What the engine considers "too short": short quotes are rejected even when rare ×3

Seen on stage 3, card 21: آل عمران:19 «إِنَّ الدِّينَ عِندَ اللَّهِ الْإِسْلَامُ» (`binbaz_audio_2950|Q|3:19|979`). The ASR is **exact**
(«… هي الإسلام، إن الدين عند الله الإسلام، هي الإيمان…»), yet **both** engines missed it.
Tested directly:
- without a cue: v3 missed · v4 missed
- with «قال تعالى» before it: v3 **caught** (VERIFIED, score 16.1) · v4 **still missed**
Why (v4, `js/engine_v4.js`): a Quran finding needs score ≥ 14 (`th.QURAN.cand`). The relaxed thresholds
(`completeVerse`: 13, or 10 with a cue) only apply when the **whole** ayah is said and the ayah is 3–10 words long
(`_thr`). Here it is 5 words out of a 26-word ayah, made of common words (الدين، عند، الله، الإسلام: low weight), so
the score stays under 14 — and in v4 a cue does not lower the threshold for fragments at all.
→ ideas: let a cue lower the threshold for fragments too (as v3 effectively does); and/or a list of well-known standalone
fragments of long ayat (إن الدين عند الله الإسلام، لا إكراه في الدين، وما أوتيتم من العلم إلا قليلا …) treated like
complete short verses.

×2 — stage 3, card 50: طه:41 «وَاصْطَنَعْتُكَ لِنَفْسِي» (`binbaz_audio_1937|Q|20:41|1520`), a **complete 2-word ayah**, exact in the
ASR («… أو يتأول قوله لكلمه موسى **واصطنعتك لنفسي**، فيقول معناه…»), missed by both engines — although «واصطنعتك» is
an extremely rare word (only here in the Quran).
Tested:
- as said (cue «قوله» before it) → v3 missed · v4 missed
- with «قال تعالى» → v3 VERIFIED · v4 CANDIDATE
- with no cue → missed by both
Why: v4 `_passesGuards` (`js/engine_v4.js` ~line 795): an ayah of ≤ 2 words is accepted **only with a cue**
(`if (unit.normWords.length <= 2) return cue && t.coverage >= 0.99`), whatever the rarity of its words; and «قوله» is not
treated as a cue here. → too strict: let rarity count (a very rare word, or a high score, should pass without a cue),
and add «قوله» / «في قوله» to the cues.

×3 — stage 3, card 73: الزمر:62 «اللَّهُ خَالِقُ كُلِّ شَيْءٍ» (`binbaz_audio_1939|Q|39:62|2130`), **exact** in the ASR, missed by both.
The sheikh chains short Quranic phrases about Allah («إن ربكم الله، **الله خالق كل شيء**، الرحمن الرحيم، ملك…»).
Tested: as said → v3 missed · v4 missed; with «قال تعالى» → v3 الرعد:16 AMBIGUOUS · v4 الرعد:16 CANDIDATE.
Two problems at once: a 4-word fragment of a 9-word ayah made of very common words (too short, no cue), **and** a
phrase that exists in several ayat (الرعد:16, الزمر:62 …), so even when caught the reference is a guess (the GT says
الزمر:62, the engine picks الرعد:16). → for multi-home phrases, catching the quote matters more than the exact ayah:
accept it as a quote and mark the reference as ambiguous (list all homes), instead of rejecting it.

## 18. One ayah word split into two by the ASR («لب المرصاد»)

Seen on stage 3 (card 35, and a second time in another lesson): الفجر:14 «إِنَّ رَبَّكَ **لَبِالْمِرْصَادِ**», cued by «وقال تعالى» /
«ويقول جل وعلا», missed by **both** engines. The ASR wrote «إن ربك **لب المرصاد**»: the only problem is an extra space.
Tested directly with the same cue:
- «وقال تعالى إن ربك **لب المرصاد**» → v3 missed · v4 missed
- «وقال تعالى إن ربك **لبالمرصاد**» → v3 **VERIFIED** · v4 **VERIFIED**
So the space alone costs the whole finding. The engines claim to handle "fused/split ASR tokens" (v4 header reuses
this from engine.js) and it worked for «لفي» → «لا في» (showcase card 155), but not here: probably because «لب» is not a
real word, and the split leaves only 2 matched words («إن ربك») in a 3-word ayah.
→ engine: try joining two adjacent transcript words when the joined form matches a verse word (and splitting one word
into two), at least for words inside a candidate's region.
Found in v3: `isFusedTwoToOneMatch(w1, w2, target)` (`js/engine.js` line 181) already does exactly this join check, but it
is only used when **extending** an island that already exists (lines 787–789). Here the island «إن ربك» is too weak to
exist in the first place, so the join is never tried → use the join check earlier (when seeding / scoring), not only
when extending.
Also a limitation of my GT aligner: one GT word vs two ASR words is not paired, so the card highlights only «إن ربك».

## 19. Regressions: v4 misses what v3 catches

Track every missed GT that v3 caught and v4 did not (the stage 3 card header says "caught by v3"):
- stage 3, card 4 — البقرة:21 «يا أيها الناس عبدوا ربكم» (initial alif dropped, note 13)
- stage 3, card 57 — فاطر:6, full 13-word ayah, 7/13 words exact, the rest mostly word endings (note 6)
→ compare how v3 and v4 score these (v3 seems more tolerant of word-level ASR variants); the automatic recall table
already shows v4 ahead overall (Quran 69% vs 58%), so the goal is to keep v4's gains and add v3's tolerance.

## 20. Short ayah right after another ayah: neighbour context should rescue it (chain failure)

Seen on stage 3, card 67: الانفطار:11 «كِرَامًا كَاتِبِينَ» (`binbaz_audio_821|Q|82:11|2782`), a 2-word ayah, missed by both engines.
ASR: «… ما يلفظ من قول إلا لديه رقيب عتيد [ق:18 ✔ caught], وإن عليكم **نحافظين** [الانفطار:10 ✘ missed] **كراما كاتبين**
[الانفطار:11 ✘ missed]». Alone it is too short (≤ 2 words needs a cue, note 17), but it directly follows its own previous
ayah — that context should be enough.
The engine already has the mechanism: v4's **neighbour probe** (`js/engine_v4.js` ~line 671) tests ayah ± 1 right next
to an accepted ayah, made exactly for short verses of common words. It did not fire because الانفطار:10 was itself missed
(«نحافظين» for «لحافظين», first-letter swap — note 13, stage 3 card 6). One miss caused the next one.
→ fixing note 13 likely recovers both. Also consider letting the neighbour probe start from a *near-miss* candidate, not
only from an accepted ayah. Related: note 12 (prefer the adjacent ayah), note 9 (consecutive ayat).
Labelled *Unsure* in stage 3 (cards are rated one finding at a time).

## 21. Stage 3 verdict: most missed GT is due to ASR problems

Stage 3 (missed GT) is finished. **Verdict: most missed GT quotes are ASR problems, not engine problems.**
Even among the cards labelled *Engine should catch it*, most are really ASR-garbled: the label was a deliberate
stretch ("an ideal engine could still get this").
→ When fixing the engine from these notes, do **not** aim at 100 % of the stage 3 misses: that is too much to handle with
the engine alone. Fix the clear, repeated patterns (notes 4, 6, 13, 14, 17, 18) and leave heavily garbled cases to Laya /
better ASR. The "recall excl. not-its-fault" number in the engine report is therefore an optimistic target, not a goal.

## 22. Decision: boundary is relative to the SHOWN reference + a "Reference wrong / incomplete" toggle

Seen on stage 4, card 11: the story of the man who killed 100 (`binbaz_audio_561|3648-3655|OHD:IbnMajah:2622`). The engine
picked **سنن ابن ماجه (2622)**, whose version continues «قال إبليس أنا أولى به»; the sheikh tells the other version
(«تقول إنه ما عمل خيراً… فأرسل الله ملكاً يحكم بينهم», the Muslim/Bukhari one). Against Ibn Majah nothing is missing;
in reality the quote goes on.
Decision (option "in the middle"):
- **Boundary** is always judged against the reference shown on the card, because that is all Laya sees → *Complete*
  here (labelling *Missing end* would teach Laya to see words that are not in its input).
- New toggle **"Reference wrong / incomplete"** (enabled for *Real quote*): the words are a real quote but the shown
  ayah / riwaya is not the best match (other ayah with the same words, other riwaya, or the quote continues beyond
  this reference). Counted in the engine report as "real quotes with a wrong / incomplete reference" (an engine
  reference-choice problem), and kept as a flag `ref_issue` on the training row so these can be filtered later.

## 23. ⚠ Pattern: findings that are only sanad / narrator names / sahabah / takhrij → key Laya training

Seen on stage 4, card 14: رياض الصالحين (357) (`binbaz_audio_567|2155-2164|OHD:RiyadSalihin:357`). The finding is only the
chain: «**وعن ابن عباس رضي الله عنهما قال قدم عيينة بن**», right after a takhrij («رواه الترمذي وقال حديث حسن صحيح»).
Labelled *Not a quote*. Expected to be a very common pattern: the engine detects part of the **sanad**, **narrator /
sahabi names**, or part of the **takhrij**, without the matn.
- **Laya**: very important training material — these are exactly the false findings Laya must learn to reject.
- **Engine**: maybe fixable later (v4 already has guards: `nasab` count, «حدثنا / أخبرنا» before the span, low weight for
  isnad words) — to look at once Laya handles it.
Related: note 1 (sometimes part of the sanad IS needed with the matn) — the line between the two needs defining.

## 24. ⚠ Pattern: hadith quoted with a part skipped in the middle (abridged)

Seen on stage 4, card 18: صحيح البخاري (4423) «إن بالمدينة أقواماً…» (`binbaz_audio_2950|2871-2881|OHD:Bukhari:4423`).
The sheikh says «… إن في المدينة أقواماً ما سرتم مسيراً ولا قطعتم وادياً إلا وهم معكم، **حبسهم العذر**» (ASR «حبسهم العزو»):
he skips the middle «قالوا يا رسول الله وهم بالمدينة قال وهم بالمدينة» and jumps to the end «حبسهم العذر».
The engine stops at «معكم», so the part after the skip is left out (and «إن» at the start too).
- **Engine**: in the app v4 can only skip 2 corpus words between matched words (`maxVGap`, see note 15); an abridgement
  skips ~8. Idea: allow a long *corpus-side* skip when the later part is a strong, in-order match of the same hadith
  (abridging a hadith is normal in a lesson, often marked «… الحديث» / «إلى آخره»).
- **Laya**: learnable — the skipped-to words are in `unmatched_corpus_suffix_words` (the 10 words after the match include
  «حبسهم») and right after the span in the transcript → *Missing end*. Card 18: *Real quote · Missing both*.
- Defines a policy question too: when the speaker abridges, is the result one finding with a gap, or two findings?

## 25. A takhrij AFTER the text («متفق عليه»، «رواه البخاري»…) is a very strong hadith cue

Seen on stage 4, card 20: صحيح مسلم (2964), the story of the leper, the bald man and the blind man
(`binbaz_audio_571|327-395|OHD:Muslim:2964`). The finding ends «… فقد رضي الله عنك وسخط على صاحبيك» and the next words are
«**متفق عليه**، والناقة العشراء…». The engine reports **no cue** for it (`hasCitationCue: false`).
Why: both engines only look for cues in the **8 words before** the finding (`_hasCitationCue`, `js/engine.js` ~line 663).
«رواه البخاري / رواه مسلم» are in v3's cue list but only checked *before* the span, and «متفق عليه» is only used to know
where a hadith text ends (`WV4_TAKHRIJ_TAILS`), never as evidence.
→ engine: treat a takhrij right **after** a candidate (متفق عليه، رواه البخاري / مسلم / الترمذي …، أخرجه …) as a strong hadith
cue (raise the score / band, and it also confirms the end of the hadith = *Complete* at the end).
→ Laya: the takhrij is in `context_after` / `immediate_transcript_after`, so Laya can learn it as a cue already.

## 26. ⚠ Pattern: a hadith told by its meaning (رواية بالمعنى) — new verdict "Quoted by meaning"

Seen on stage 4, card 23: hadith of the three men in the cave, رياض الصالحين (12) (`binbaz_audio_2950|6020-6075|OHD:RiyadSalihin:12`).
The sheikh tells the story mixing the hadith's words with his own («ولم يستطيعوا زحزحتها ولا دفعها… عرفوا أنه لن ينجيهم إلا الله…»):
not a verbatim quote, not ordinary speech.
Why it matters: this must be **detected** — show the sheikh's speech **and** extract the original hadith next to it. A
student of knowledge needs exactly this.
Done (2026-10-24): new verdict **≈ Quoted by meaning** on stage 2 / 4 cards (no boundary; the reference toggle stays available).
It counts as a useful finding (a hit) in the engine precision, shown separately in the stats.
Open: Laya's verdict question only has CORRECT / FALSE / NOT_SURE, so these labels are **kept but not exported** to Laya
training yet, and are left out of the stage 5 model comparison. To use them: add a 4th option (e.g. `PARAPHRASE`) to
the verdict question in the app (`ai-verifier.js`, canonical questions) and in the training export, at the same time.

## 27. «وفي رواية» should be a STRONG hadith cue (it is one, but weak)

Seen on stage 4, card 58: صحيح البخاري (1458) (`binbaz_audio_961|563-569|OHD:Bukhari:1458`): «… فإن معناها توحيده، **وفي رواية**
فليكن أول ما تدعوهم إليه عبادة الله». Checked: «وفي رواية» **is** already a cue (`js/engine.js` line 151, list with
«قال رسول الله», «بعض رواياته»…) and the engine did set `cue: true` here — yet the finding is only **CANDIDATE**.
In v4 a cue only adds a small bonus (`cueBonus: 3`) and lowers the threshold a little.
→ give cue strength levels: «وفي رواية», «وفي لفظ», «قال رسول الله ﷺ», a takhrij right after (note 25) are near-certain
hadith markers and should weigh much more than a generic «قال». Related: notes 17 (cue rules for short quotes), 25.

## 28. ⭐ IMPORTANT IDEA — dhikr should be a check AFTER detection, with an editable list (not a search target)

Seen on stage 4, card 108: «**بسم الله الرحمن الرحيم**» at the start of the lesson («… رحمه الله تعالى في كتابه رياض الصالحين،
بسم الله الرحمن الرحيم، الحمد لله الواحد القهار…»), reported as الفاتحة:1 (AMBIGUOUS). It is the book's opening formula,
not a quotation of al-Fatiha → labelled *Not a quote*.

The idea (change of design):
- Today dhikr / adhkar are **searched like ayat and hadith** (the app's Adhkar studio list, 42 built-in entries, matched
  as their own corpus units, with priority QURAN > HADITH > ADHKAR).
- Instead: dhikr is **not something to look for**. It becomes a **check done after a finding** is detected: if a finding
  (or its core) is one of the common phrases, classify it as dhikr / formula instead of a quote.
- The list must be **editable and manageable** (add / remove phrases as patterns appear in reviews), initially filled
  with the most used phrases: سبحان الله، الحمد لله، بسم الله الرحمن الرحيم، الله أكبر، لا إله إلا الله، أستغفر الله،
  لا حول ولا قوة إلا بالله، إن شاء الله، صلى الله عليه وسلم، جزاك الله خيرا، رحمه الله، رضي الله عنه …
Already in the engine, close to this idea but baked into the scoring: v3 `QUARANTINED_FORMULAS` (basmala, hamdala,
khutbat al-haja, إن شاء الله، سبحان الله …) and v4 formula weight multipliers (`formulaMul` 0.20 / 0.05).
→ move these lists out of the engines into one editable list, applied as a post-detection classifier.
Exceptions to the rule (also from card 108): the dhikr check must not override a real recitation. If the formula is
part of a longer quote, it stays a quote. Example: when the sheikh recites **the whole Fatiha**, «بسم الله الرحمن الرحيم»
is its first ayah (الفاتحة:1), not a dhikr. → the check should look at the neighbours: a list phrase directly followed
(or preceded) by the next (previous) ayah of the same surah, or inside a longer finding, keeps its quote verdict.

## 29. "Not a quote" can look exactly like the quote: the sheikh explaining with the text's words (needs more thinking)

Seen on stage 4, card 112/113: صحيح مسلم (157a) (`binbaz_audio_561|1557-1563|OHD:Muslim:157a`): «… **يعني** تطلع الشمس من
مغربها، متى طلعت من مغربها لم تقبل التوبة…». The words match the hadith («تطلع الشمس من مغربها فإذا طلعت من مغربها»), but
the sheikh is **explaining** (after «يعني»), not quoting → labelled *Not a quote*.
- The verdict cannot come from word overlap alone: the context decides (explanation markers «يعني»، «أي»، «معناه»، «المراد»,
  the speaker re-using the text right after quoting it, …).
- **Prompt (JEV / Gemini) and Laya**: must be told that a sheikh explaining with the text's own words is *not* a quote
  in some cases. The app already has an optional prompt rule close to this (`explainingRepeat`, off by default: "repeats
  one or two words of the text to explain them") — too narrow for full-sentence explanations like this one.
- The line between this, *Quoted by meaning* (note 26) and a real quote needs a clear definition → **to think about later**.
