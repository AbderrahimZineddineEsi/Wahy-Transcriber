# Laya envelope v2 (run 3)

What a laya_v2 checkpoint reads, why each change was made, and how the app and the training data stay identical.
Written 2026-10-27. Code: `js/ai-verifier.js` (section 1a', `buildLayaV2Requests`), `backend/laya_datagen/laya_v2.py`,
`backend/laya_datagen/kaggle/{train_ddp,eval_laya}.py`. Tests: `backend/tests/laya_datagen/test_laya_v2.py`.

## Why

Two problems seen in the app with the run-1 model (`laya-wahy-soft_asis`):

1. **Short verses inside a recitation are rejected.** الواقعة 89 «فروح وريحان وجنة نعيم» was called *not a quote*
   (P = 0.63) between verses 88 and 90, both accepted; عبس 35-36 «وأمه وأبيه», «وصاحبته وبنيه» likewise. In the training
   data, 86 % of Quran findings of 1–3 words are *not a quote*, so Laya learned "short ⇒ coincidence". The prompt already
   held verse 88 word for word in `context_before`; the model did not use it.
2. **The boundary head never learned** (runs 1–2): 81 % of the boundary labels are `COMPLETE_SPAN`, `MISSING_BOTH` has 20
   training examples (1.4 %), and every model answered "complete" (balanced accuracy 0.25–0.35; the no-model rule 0.51).

Measured before changing anything (scripts in the session, numbers below):

| check | result |
|---|---|
| verse 89, today's prompt | FALSE, P(real) 0.28 |
| + the engine's neighbours listed (no verdicts) | **real, 0.68** |
| + neighbours *and* their Laya verdict | real, 0.63 (verdicts add nothing) |
| + an abstract "recitation 56:84-95" field | FALSE, 0.34 (an untrained field is not read) |
| verses 88–90 sent as one finding | **real, 0.87** |
| labelled chains of consecutive verses (149) | 146 all real, 0 all fake, 3 mixed |
| short verses (1–3 words) inside chains | 66 / 66 real |
| "not a quote" with a same-surah verse ≤ 3 ayat away | 13 (vs 488 real): the shortcut is 97 % right |
| merged passages over 1024 tokens | 24 / 149 as the state was; 2 without the duplicate verse text; 0 at 2048 |
| single findings over 1024 tokens (today) | 73, up to 3,180 tokens (their end, `context_after` included, was cut) |

## What changed

| | v1 | v2 |
|---|---|---|
| unit | one finding | one **passage**: consecutive verses of one surah, ≤ 2 words apart (option `passages`); a run longer than 6 verses is cut into equal parts (7 → 4 + 3, 13 → 5 + 4 + 4), never leaving one verse alone |
| context | the span ± 25 words | + `neighbor_findings`: the nearest finding / passage before and after (≤ 40 words away) with its reference, `same_surah`, `ayah_distance`, the words between, its span — **no verdicts** (option `neighbours`) |
| field order | corpus text before the span | lecture fields first, then the boundary evidence, then the corpus text (a long hadith can no longer push the span out) |
| verse text | in `canonical_corpus_text` **and** `quran_neighboring_context.current_ayah_text` | once |
| boundary | one 4-way choice | two yes/no questions: `start_missing`, `end_missing` |
| boundary evidence | – | `prefix_words_heard` / `suffix_words_heard` = "n of 2": the 2 corpus words next to the span, heard right there? (the rule of `eval_laya.rule_boundary`, Levenshtein ≥ 0.75) |
| max_len | 1024 | 2048 (from the checkpoint's config; short inputs cost the same, measured) |
| engine score / band | removed before sending | not in the state |

State key order (v2): `source_type, candidate_reference, has_citation_cue, context_before, matched_span_in_lecture,
context_after, immediate_transcript_before, unmatched_corpus_prefix_words, prefix_words_heard, immediate_transcript_after,
unmatched_corpus_suffix_words, suffix_words_heard, [verses_in_passage], [neighbor_findings], canonical_corpus_text,
[quran_neighboring_context]`.

Why no verdicts in `neighbor_findings`: sending Laya's earlier answers makes the result depend on the order of the
findings and lets one mistake spread to the next ones; the measurement above shows the verdicts add nothing over the bare
fact "verse 88 was found right before".

Why two yes/no questions and not "complete / cut off": the auto-heal feature needs to know which side to extend, and with
two questions `MISSING_BOTH` is just "yes, yes" instead of a class with 20 examples. Each question has 130–170 "yes"
answers in train (9–12 %); a "yes" weighs `--noul-true-weight` (3) in the loss.

## One builder for the app and the data

`buildLayaV2Requests(detections, words, options, targets)` in `js/ai-verifier.js` is the only code that builds a v2 state.
The datagen runs it through `backend/laya_datagen/js/harness.js` (`EngineBridge.laya_v2`) on the detections already in
the inventory, so a training row and the app's request for the same finding are byte-identical. `options` =
`{passages, neighbours}`, as the checkpoint was trained.

A checkpoint trained by `train_ddp.py --cfg-extra` carries `wahy_envelope: 2` and `wahy_envelope_options` in its
`rl_agent_config.json`. The backend reports them (`/api/laya/status` → `envelope`), and the app picks the builder:
version 1 (run-1/2 models, the base model) gets the v1 envelope exactly as before, version 2 gets passages / neighbours
per its options. A passage's answer goes to each verse card in it: the verdict to all, *start cut off* to the first,
*end cut off* to the last, combined into the usual 4-class `boundaryStatus` (independent yes/no); the raw yes/no
probabilities are kept on the card (`boundaryStartMissingP` / `boundaryEndMissingP`) for auto-heal.

## The dataset (`data/laya_datagen/datasets/laya_v2/`, built by `laya_v2.build()`)

Same labels and split as laya_v1 (`laya_dataset.assign_splits`). One folder per variant (`train / val / test.jsonl`):

| variant | passages (D) | neighbours (A) | counterfactual boundary rows |
|---|---|---|---|
| `base` | – | – | – |
| `passages` | ✓ | – | – |
| `neighbours` | – | ✓ | – |
| `both` | ✓ | ✓ | – |
| `both_synth` | ✓ | ✓ | ✓ train only |

* **Passage labels:** the verdict is the verses' common label. A passage mixing real and fake verses is dropped from
  train / val (2 passages, 6 verses) and kept in test, where each verse is scored on its own. A label counts only in
  the engine run it was given in (the same span found by another engine is another finding). *start cut off* comes from
  the first verse's label, *end cut off* from the last's.
* **Counterfactual rows** (`both_synth`): a real, complete quote whose first or last 1–3 span words are exactly its corpus
  words (same normalisation as the evidence) is re-sent with those words moved out of the span; "cut off" is then true by
  construction. At most 700 (≈ 2× the real "yes" answers). Risk: real misses come from ASR garbling the edge words, these
  are clean — this is why it is its own variant.
* `v1_test.jsonl` + `v1_baselines.json`: the old test file, for the "before" line. `test_verse_flags.json`: the context of
  every test verse (in a passage, same-surah verse around, short, any neighbour), so every model is sliced the same way.

Built 2026-10-27 (rows / labelled verses / passages; every variant has exactly laya_v1's verses):

| variant | train | val | test |
|---|---|---|---|
| `base`, `neighbours` | 2,863 / 2,863 / – | 515 / 515 / – | 1,523 / 1,523 / – |
| `passages`, `both` | 2,728 / 2,857 / 105 | 496 / 515 / 20 | 1,470 / 1,523 / 43 |
| `both_synth` | 3,428 / 3,609 / 146 (+ 700 counterfactual) | as `both` | as `both` |

Yes/no answers in train (`both`): *start cut off* 157 yes of 1,300, *end cut off* 125 of 1,297; `both_synth` 490 / 1,996
and 493 / 1,993. Passage sizes (all splits, `both`): 2 verses 111, 3: 31, 4: 15, 5: 8, 6: 3. State tokens: median 454–638, p99 ≤ 1,128; at 2048 only the 1–3 longest hadith rows per file lose the
end of their (now last) corpus text. Laya's own reader loads every file with nothing skipped.

## Scoring

`eval_laya.per_verse` turns every result into one line per labelled verse: a v2 passage's answers are spread over its
verses as in the app, a v1 model's 4-class boundary gives the yes/no numbers. All runs and the old model are therefore
scored on the same cards with the same metrics, plus the slices *by context* (the short-verse failure) and *start / end
cut off* balanced accuracy and AUC.
