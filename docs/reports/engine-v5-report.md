# Engine v5 — report

Written 2026-10-24. Work plan: `docs/plans/engine-v5-handoff.md`; the problems come from `docs/review-notes.md` (note
numbers in brackets). All numbers come from `backend/laya_datagen/engine_eval.py` on the 15 hand-reviewed Bin Baz lessons
(583 GT quotes, 499 alignable) and can be re-run in `notebooks/data/laya_engine_v5.ipynb`.

## What was built

- **`js/engine_v5.js`** — a copy of `engine_v4.js` (class `WahyEngineV5`, own `WV5_*` names so both load in one page)
  with the fixes below. Each fix is a switch in `P.fix` (`params.v5 = {fix: {name: false}}` turns one off), so its effect
  can be measured alone. `engine.js` and `engine_v4.js` are untouched: v3 / v4 results are unchanged.
- **App wiring** — `rebuildMatcher()` builds v5 when `localStorage.wahyEngine = "v5"` (falls back to v3 like v4 does);
  new `activeEngineName()` in `state.js`; the two engine dropdowns and the Tafrigh re-run know v5; `index.html` loads
  `engine_v5.js` after `engine_v4.js` (script cache-buster bumped because `state.js` / `events.js` changed).
- **Profiles** — `localStorage.wahyEngineProfile = "loose"` (or `params.v5Profile`) selects the loose profile
  (deliverable 2); anything else is the normal profile, the app default.
- **Harness** — `EXPECTED_CLASS.v5`; engine names `v5:<profile>` (the app's profile switch), `v5/<tag>` + `opts`
  (v5 rebuilt with `params.v5 = opts`, for one-fix-off runs) and `v5@<tag>` (a saved copy of the file under another
  name). `EngineBridge.detect(engine, words, opts=None)`.
- **`engine_eval.py`** — loads the review bundles (cached v3 / v4), runs one more engine without re-running the others,
  verdict per finding (your labels > sprint > automatic GT label > Sonnet), recall / precision / boundary tables, and a
  v4 → v5 diff (GT gained / lost, findings added / dropped / re-spanned / re-referenced). Also loads the autolabel lecture
  sets (`load_lectures`) from what is already downloaded and transcribed.
- **`autolabel.run(..., store=...)`** — Sonnet labels of this evaluation go to `labels/sonnet_engine_eval.json`, never
  into Laya's `labels/sonnet.json`.
- **Tests** — `backend/tests/laya_datagen/test_engine_v5.py`: 15 regression cases from the notes, real ASR snippets.

## The fixes

| Switch | Notes | What it does |
|---|---|---|
| `variants` | 4, 6, 13, 19 | ASR spelling variants are near-matches: «ال» / و ف ب ك ل dropped, added, swapped, «لل» = «ال», hamzat al-wasl (عبدوا = اعبدوا), a misheard one-letter prefix (نحافظين = لحافظين), a long vowel dropped / swapped at the end (اتق = اتقي, غزى = غزا), pronoun / verb suffixes (حزبه = حزبها, ليكون = ليكونوا). A word missing from the corpus vocabulary also seeds candidates through its variants. Runs of "exact" words continue through near-matches of quality ≥ 0.85 (else the hadith guard rejects a quote the variants just found). |
| `qul` | 8 | «قال» counts as a verse-initial «قل» only when the next word continues the verse. |
| `free` | 14 | Honorifics and asides («رضي الله عنه», «صلى الله عليه وسلم», «عز وجل», «تعالى», «يعني» …) are skipped for free, in the speech and in a hadith's text, and do not count toward the gap limits. |
| `muq` | 9 | Spelled-out muqatta'at: «ألف لام ميم» = «الم», «حا ميم» = «حم» … |
| `fused` | 18 | Two ASR words whose join is a rare corpus word seed it («لب المرصاد» = «لبالمرصاد»). |
| `seed2` | 17 | A seed bigram credits both of its words, so a fragment of common words can become a candidate («إن الدين عند الله الإسلام», «ولقد جاءهم من ربهم الهدى»). |
| `cues` | 17, 25, 27 | «قوله» up to 4 words before = Quran cue; near-certain hadith cues get a bigger bonus (10 instead of 3): «وفي رواية» / «وفي لفظ», «قال رسول الله ﷺ» right before the span, a takhrij right after («متفق عليه», «رواه البخاري …»). |
| `short` | 17 | A complete 1–2 word ayah passes without a cue at score ≥ 15 (طه:41, الانفطار:11); a cue lowers the bar for a verse fragment (12 instead of 14). |
| `multi` | 17 | The same exact run of ≥ 4 words in several ayat is kept as a quote with an ambiguous reference («الله خالق كل شيء»). |
| `ref` | 12 | A verse finding within 15 words of another verse finding takes that ayah or the adjacent one when it explains the words about as well; if needed that ayah is aligned directly on the finding (الأحزاب:35 instead of الفتح:29). |
| `chain` | 20 | Two consecutive ayat that are each a near miss support each other; the neighbour probe also starts from a near miss. |
| `merge` | 14 | A quote longer than one alignment window (~80 words) is one finding instead of several overlapping ones; a finding never starts or ends inside an honorific (card 87). |

Not done (as the handoff says): 1, 2, 11, 21, 26 / 29, 28. Optional 15 / 24 (`maxVGap`): see the end.

## Results (15 reviewed Bin Baz lessons)

Verdicts: your labels (stages 2 / 4 and the negatives sprint) first, then the automatic GT label for findings on a marked
quote, then Sonnet (`labels/sonnet.json`, and `labels/sonnet_engine_eval.json` for the 245 spans only v4 / v5 produced
that nobody had labelled: 25 calls, ≈ $1.5 API-equivalent). After that, v4 and v5 have only 4–5 findings without a verdict.

| Engine | Recall Quran | Recall hadith | Recall all | GT caught (of 499) | Findings | Real quotes | Not quotes | Precision | GT findings with a complete span |
|---|---|---|---|---|---|---|---|---|---|
| v3 | 57.9 % | 97.2 % | 63.5 % | 317 | 719 | 370 | 9 | (340 unlabelled) | — |
| v4 | 69.2 % | 98.6 % | 73.3 % | 366 | 732 | 668 | 59 | **91.9 %** | 73.3 % |
| **v5** | **77.3 %** | 98.6 % | **80.4 %** | **401** | 813 | 730 | 77 | **90.5 %** | **79.3 %** |

- **+35 GT quotes, none lost**; hadith recall was already 98.6 %. "Real quotes" includes *quoted by meaning* and *ayah inside
  a hadith* (your "useful" verdicts).
- The 103 findings v5 adds: 78 real + 8 by meaning, **16 not quotes** (84 % precision). 12 of the 16 are short Quran
  look-alikes — the sheikh's own sentence sharing 3–6 words with a verse («يخرج من بيته», «أمر وأوصى ألا تعبدوا إلا إياه»),
  scoring just over the bar, mostly uncued; 2 are Nawawi's word glosses inside the Riyad text, 2 the author's own preface.
  This is exactly the "explaining with the text's words" pattern of note 29: Laya's job, not something a score separates.
- Spans: 98 v4 findings got a better span (61 missing sides extended, 0 sides cut; the 6 "complete side extended" cases
  checked by hand are 5 improvements — the text's own first / last words such as المائدة:119 «قال الله», الحجرات:13
  «أتقاكم» — and one extra word); 29 got another reference (mostly another riwaya of the same hadith; التحريم:6
  instead of البقرة:24 is a real fix).
- v3's precision is not comparable: 340 of its findings were never labelled (it was not reviewed).

### Each fix alone (v5 with that fix switched off → full v5)

| Fix | GT gained | Findings added (real / not) | Recall | Precision | Other |
|---|---|---|---|---|---|
| `variants` | +10 | 42 (36 / 5, 1 unlabelled) | +2.0 pts | −0.3 | 42 of the 61 extended sides; complete spans 76.6 → 79.3 % |
| `seed2` | +16 | 23 (18 / 5) | +3.2 pts | −0.9 | آل عمران:19, النجم:23, لقمان:13, يوسف:90, النساء:101, محمد:19 … |
| `cues` | 0 | 10 (10 / 0) | — | +0.2 | hadith after «قال ﷺ» / «وفي رواية» / before «متفق عليه» |
| `free` | +1 | 4 (4 / 0) | +0.2 pts | +0.3 | 17 better spans, 11 better references |
| `fused` | +2 | 2 (2 / 0) | +0.4 pts | +0.1 | الفجر:14 ×2 |
| `short` | +2 | 4 (2 / 2) | +0.4 pts | −0.2 | طه:41, الأعراف:54 «ألا له الخلق»; a stricter fragment bar loses the true ones first |
| `multi` | +2 | 1 (counted not a quote: right quote, first reference غافر:62 instead of الزمر:62) | +0.4 pts | −0.1 | |
| `merge` | 0 | −23 duplicate / overlapping findings | — | −0.1 | complete spans 76.8 → 79.3 % |
| `muq` | 0 | 1 (1 / 0) | — | +0.1 | العنكبوت:1 «ألف لام ميم» |
| `qul` | 0 | 0 | — | 0 | يوسف:108 starts at «قال» |
| `ref` | 0 | 0 | — | 0 | الأحزاب:35 tail no longer الفتح:29 |
| `chain` | 0 | 0 | — | 0 | no effect on these lessons (الانفطار:10–11 is also caught by `short`); kept, costs nothing |

Rule from the handoff — a fix stays only if it does not cost more precision than it gains in recall: **all 12 pass**. The
two that cost something (`seed2`, `short`) gain 4–8× more recall than they lose precision.

**Optional 15 / 24 (`maxVGap` 3 instead of the app's 2)**: 0 GT gained, 4 re-spans, precision −0.1 → not worth it; v5
keeps the app's slider value. An abridged hadith (note 24) needs a real "skip with «إلى أن قال» / «الحديث»" design.

### The regression cases of the notes (`test_engine_v5.py`)

Fixed: فاطر:6 (missed by v4, now VERIFIED), الفجر:14 «لب المرصاد» (both lessons), طه:41, آل عمران:19, النجم:23,
الانفطار:10–11, يوسف:108 («قال»), العنكبوت:1 («ألف لام ميم»), الأنبياء:47 (to «حاسباً»), Muslim 2699 (from «من»),
الأحزاب:35 (not الفتح:29), Muslim 2378 (to «فقه»), Bukhari 1283 (from «اتق»), «غزى» = «غزا» (Bukhari 3124), الزمر:62
(kept, ambiguous), «وفي رواية» weighs more, card 87 (one finding, not two).

Still missed: البقرة:21 in `binbaz_audio_182` (a 5-word fragment right after النساء:1, no seed at all: «عبدوا» is a known
word, so its variant «اعبدوا» is not looked up — doing that for known words made the engine 10× slower), النحل:74
(«اقتربوا» for «تضربوا»: too garbled), الأنعام:116 / 5 (garbled ends: Laya's job), «قيل» → «قل» (2-letter word, too short to
match safely). The `binbaz_audio_182` البقرة:21 is the only regression of note 19 left; فاطر:6 is fixed.

### Speed

Variant seeding and the two-word bigram credit create more candidates: a 4,000-word lesson takes ≈ 10 s in Node vs ≈ 4 s
for v4 (index build ≈ 6 s for both). Acceptable for the app; the first versions were 13× slower until variant seeding was
limited to words missing from the corpus vocabulary.

## Deliverable 2 — the loose profile

`WV5_PROFILES.loose` in `engine_v5.js`, selected by `localStorage.wahyEngineProfile = "loose"` (harness / notebook engine
name `v5:loose`); the app default stays normal. It lowers every acceptance bar: seed mass 6.5 → 5.0 (single seed 8.6 →
7.0), candidate thresholds Quran 14 → 9, hadith 22 → 15, dhikr 22 → 16, complete short verse 13 → 9 (cued 10 → 7), cued
fragment 12 → 8, uncued 2-word ayah 15 → 10, guards relaxed (Quran ≥ 2 matched / 1 content word, hadith ≥ 3 matched /
2 content / run of 2). VERIFIED / AMBIGUOUS bars are unchanged, so everything it adds is CANDIDATE.

On the 15 review lessons (its 688 new spans labelled by Sonnet, 69 calls ≈ $3.8 API-equivalent):

| Engine | Recall Quran | Recall all | GT caught | Findings | Real quotes | Not quotes | Precision |
|---|---|---|---|---|---|---|---|
| v5 | 77.3 % | 80.4 % | 401 | 813 | 735 | 77 | 90.5 % |
| **v5 loose** | **87.6 %** | **89.2 %** | **445** | 1,544 | 900 | **636** | 58.6 % |

- The findings only loose produces: 717 → 161 real (136 + 25 by meaning), **549 not quotes** (23 % precision): 351 Quran
  look-alikes, 198 hadith look-alikes. v4 gave 59 negatives on the same lessons. This is the negative source for Laya.
- How loose can the app run with Laya as the net: loose finds 9 of 10 marked quotes instead of 8, but 4 of 10 of its
  findings are not quotes, so Laya would have to reject ~40 % of what it is shown. Worth trying only once Laya rejects
  reliably; an intermediate profile (e.g. Quran 11–12) can be measured the same way in minutes.

On the lecture batches (`lectures.YOUTUBE` + `BINBAZ` = batch 1, `YOUTUBE_2` + `BINBAZ_2` = batch 2, all 71 transcribed):

| Batch | v4 findings | v5 findings | v5 loose findings | loose findings with no label yet |
|---|---|---|---|---|
| 1 (25 lectures, 717 Sonnet labels from v4) | 764 | 840 | 1,503 | 819 |
| 2 (46 lectures) | 914 | 968 | 2,029 | 1,969 |

The labelling pool = those **2,788** cards (findings on a quote marked in Bin Baz's written text are left out: their
automatic label is right). At the review lessons' rate (~75 % of loose-only findings are not quotes), labelling ~800 of
them should already give ~500 negatives — the fine-tune target (there were ~130). Cost per 10-card call ≈ 15–30 s and
≈ $0.055 API-equivalent: 800 cards ≈ 80 calls ≈ 30–40 min; all 2,788 ≈ 280 calls ≈ 2 h. Run: part 4 of
`notebooks/data/laya_engine_v5.ipynb` (`RUN_MODELS = True`, `N_CARDS`); answers go to `labels/sonnet.json` with Laya's other
labels.

## How v5 was made

**1. Read and map.** The handoff and the 29 review notes, then v4 (`engine_v4.js`) and the v3 helpers it reuses
(`engine.js`: normaliser, `matchWordWithQiraat`, `isFusedTwoToOneMatch`, cue lists). Each note was mapped to the place in
v4 that causes it: word matching (`_qual`), seeding (`_clusters` only tried fuzzy forms for words missing from the
vocabulary, and a bigram seed credited only its first word), alignment gaps (`bestPred`), guards / thresholds
(`_passesGuards`, `_thr`), and selection (`_finalize`: cues, neighbours).

**2. Copy, wire, measure the baseline.** `engine_v5.js` = v4 renamed (`WV5_*`, `WahyEngineV5`) so both can load in one
page; wired into `rebuildMatcher()`, the dropdowns, `index.html` and the harness. `engine_eval.py` was written to load the
15 review lessons with their cached v3 / v4 records and re-run only v5, so each change costs one v5 run (~2 min). Baseline
reproduced the handoff numbers (v4 Quran 69.2 %, hadith 98.6 %).

**3. Fix in batches, each behind a switch.** Batch 1: spelling variants, «قال»/«قل», free parentheticals, muqatta'at,
split words. Batch 2: cue strength, short verses, two-word bigram seeds. Batch 3: neighbour reference, near-miss chain,
merging split findings, multi-home phrases, profiles. After each batch: the regression snippets (step 4) and a full run.

**4. Regression snippets.** The exact cases of the notes were cut out of the real ASR (10 words around the GT quote, by
their label keys) and run through v3 / v4 / v5 side by side, and with one fix switched off at a time, to see which
change does what. Debugging a miss meant printing v5's internal candidates (alignment score, coverage, exact run,
group, threshold) for that snippet. These became `test_engine_v5.py`.

**5. Problems met on the way, and what they changed.**
- Variant seeding from every word made v5 13× slower (41,000 candidate clusters instead of 4,400): limited to words
  missing from the corpus vocabulary (≈ 6 s, same findings).
- The variant «اتق» = «اتقي» broke v4's "3 exact words in a row" hadith guard (near-matches broke the run) and lost
  Bukhari 1283: runs now continue through near-matches ≥ 0.85.
- «متفق عليه» inside the span (the Riyad text carries the takhrij) was invisible to an "after the span" check: the
  check also looks at the span's last 3 words.
- الأحزاب:35's head and tail were one seed cluster, so the tail never had a 33:35 candidate: the neighbour rule aligns
  the neighbour's ayah directly.
- A lesson of batch 2 (1821) silently joined the review set once the lecture session downloaded it: the evaluation is
  pinned to `lectures.REVIEWED`.
- Tried and dropped: variant seeding for rare known words (no gain, +50 % time), a stricter fragment bar (13: loses the
  true finding first), `maxVGap` 3 (no gain).

**6. Precision without hand labels.** Findings keep their label when the span is the same (label key =
`doc|words|unit`). New spans were labelled by Sonnet with the existing blind-tested setup: `autolabel.run(...,
store="sonnet_engine_eval")` → `claude -p --model sonnet --effort high --tools "" --json-schema …`, 10 cards per call,
prompt = `agent_eval_files/instructions.md` (the labelling guide) + the same card text as the blind test (speech with the
span marked, Bin Baz's written text, the corpus text), answer = verdict + boundary + one-line reason.

**7. Each fix alone.** 12 runs of v5 with one switch off (`v5/-<fix>` with `opts={"fix": {fix: False}}`), on a frozen
copy of the engine file so later edits could not mix in; run 2–3 at a time (each harness ≈ 1.7 GB; three at once made the
machine swap). Their diffs against full v5 give the per-fix table.

**8. Checks before calling it done.** `pytest backend/tests/laya_datagen` (40 tests, incl. the 15 new ones; v3 / v4
results pinned); the final file gives exactly the measured findings; the app itself (served by `uvicorn`, driven
headless with Playwright): the dropdown builds `WahyEngineV5`, the three engine selects list v5 and stay in sync, no
console error, v5 finds الفجر:14 «لب المرصاد» where v4 does not.

**Tools used.** Reusable: `engine_eval.py` (load / add_engine / report / boundaries / diff / unlabelled /
load_lectures), `notebooks/data/laya_engine_v5.ipynb` (re-runs all of it), `test_engine_v5.py`. Throwaway session scripts
(not kept): a dev loop printing the report + a diff file, the snippet extractor and side-by-side runner, a Node script
dumping v5's internal candidates for one snippet, a profiler counting clusters / alignments, and the ablation runner.
