# Laya training data — loose labelling run + all labels by reviewer

Written 2026-10-25 after the run finished (re-run the inventory: part 5 of `notebooks/data/laya_engine_v5.ipynb`).

## The loose labelling run (Sonnet 5.5, high effort)
- Pool: all 2,788 loose-profile (`v5:loose`) findings on lecture batches 1 + 2 that had no label (712 new places + 107
  near-duplicates in batch 1, 1,969 in batch 2). **All 2,788 are labelled**, in `labels/sonnet.json` (backup from before
  the run: `labels/sonnet.backup-before-loose-2026-10-25.json`).
- Effort: chosen with a 100-card medium vs high test (88 % same verdict, 93 % same real / not; high right in 5 of the 7
  differences that matter, same cost); those 100 high answers are part of the 2,788.
- The run stopped once on the Claude session limit (after 2,000 cards, ~03:03) and resumed automatically after the reset.

### Run (the 2,688 cards labelled by the run itself)
calls 269, cards 2688 of 2688, time 47 min, cost $13.11, tokens out 329,380
### Precision per engine on the lectures (Sonnet + automatic labels)
| engine | batch | findings | real (incl. by meaning) | not a quote | unsure | unlabelled | precision |
|---|---|---|---|---|---|---|---|
| v4 | batch 1 | 764 | 691 | 72 | 0 | 1 | 90.6 % |
| v4 | batch 2 | 914 | 741 | 58 | 0 | 115 | 92.7 % |
| v5 | batch 1 | 840 | 743 | 94 | 0 | 3 | 88.8 % |
| v5 | batch 2 | 968 | 874 | 89 | 0 | 5 | 90.8 % |
| v5:loose | batch 1 | 1503 | 878 | 624 | 0 | 1 | 58.5 % |
| v5:loose | batch 2 | 2029 | 1074 | 955 | 0 | 0 | 52.9 % |
### The labelled loose pool by batch, type and source
| batch | type | source | CORRECT | FALSE | PARAPHRASE | IN_HADITH |
|---|---|---|---|---|---|---|
| batch 1 | ADHKAR | Bin Baz | 1 | 0 | 0 | 0 |
| batch 1 | HADITH | Bin Baz | 30 | 34 | 5 | 0 |
| batch 1 | HADITH | YouTube | 101 | 137 | 34 | 0 |
| batch 1 | QURAN | Bin Baz | 2 | 60 | 0 | 0 |
| batch 1 | QURAN | YouTube | 73 | 335 | 7 | 0 |
| batch 2 | ADHKAR | YouTube | 1 | 0 | 0 | 0 |
| batch 2 | HADITH | Bin Baz | 38 | 48 | 9 | 0 |
| batch 2 | HADITH | YouTube | 387 | 244 | 69 | 2 |
| batch 2 | QURAN | Bin Baz | 17 | 81 | 1 | 0 |
| batch 2 | QURAN | YouTube | 482 | 582 | 7 | 1 |

## All labels, by reviewer
Model answers (JEV / Gemini / base Laya / DeepSeek) are matched to findings through the envelope they were asked about:
374 of ~512 cached JEV / Gemini answers and 211 of 310 base-Laya answers match a finding we still have (the rest were asked
on older envelopes). Your stage 1 (GT check, 100) and stage 3 (missed GT, 131) answers are not finding labels.


| reviewer | answers | verdict CORRECT | verdict FALSE | verdict PARAPHRASE | verdict IN_HADITH | in review (15 Bin Baz lessons) | verdict NOT_SURE | in lectures batch 1 | in lectures batch 2 |
|---|---|---|---|---|---|---|---|---|---|
| You — stages 2 / 4 | 329 | 280 | 26 | 21 | 2 | 329 | 0 | 0 | 0 |
| You — negatives sprint | 111 | 57 | 29 | 24 | 0 | 111 | 1 | 0 | 0 |
| Automatic (Bin Baz written text) | 738 | 719 | 19 | 0 | 0 | 609 | 0 | 63 | 66 |
| JEV | 374 | 362 | 10 | 0 | 0 | 374 | 2 | 0 | 0 |
| Gemini | 374 | 343 | 29 | 0 | 0 | 374 | 2 | 0 | 0 |
| Laya (base) | 211 | 97 | 111 | 0 | 0 | 211 | 3 | 0 | 0 |
| DeepSeek | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Sonnet 5.5 — medium | 200 | 104 | 80 | 16 | 0 | 0 | 0 | 200 | 0 |
| Sonnet 5.5 — high | 4324 | 1969 | 2155 | 193 | 7 | 919 | 0 | 1436 | 1969 |
teacher caches: {'jev': 511, 'gemini': 513, 'laya': 310, 'orchat': 1}

## Usable for training Laya
One label per finding: you > Bin Baz's written text > Sonnet high > Sonnet medium; JEV, Gemini and base Laya are never
used. "Places" merges near-duplicate spans of the same quote. "Quoted by meaning" cannot be exported until Laya's verdict
question gets a 4th option.


| set | findings | places | real | not a quote | unsure | with a boundary |
|---|---|---|---|---|---|---|
| A · test = your labels | 395 | 386 | 339 | 55 | 1 | 282 |
| A · train = the rest | 4701 | 4554 | 2521 | 2180 | 0 | 2501 |
| B · test = 15 review lessons | 1723 | 1538 | 1077 | 645 | 1 | 1002 |
| B · train = lecture batches | 3480 | 3407 | 1886 | 1594 | 0 | 1884 |
| all usable | 5203 | 4945 | 2963 | 2239 | 1 | 2886 |
| quoted by meaning (not exportable yet) | 243 | 0 | 0 | 0 | 0 | 0 |
### By source
| source | verdict | findings |
|---|---|---|
| Automatic (Bin Baz written text) | CORRECT | 564 |
| Automatic (Bin Baz written text) | FALSE | 18 |
| Sonnet 5.5 — high | CORRECT | 1976 |
| Sonnet 5.5 — high | FALSE | 2155 |
| Sonnet 5.5 — medium | CORRECT | 84 |
| Sonnet 5.5 — medium | FALSE | 11 |
| You — negatives sprint | CORRECT | 57 |
| You — negatives sprint | FALSE | 29 |
| You — negatives sprint | NOT_SURE | 1 |
| You — stages 2 / 4 | CORRECT | 282 |
| You — stages 2 / 4 | FALSE | 26 |

**Is it enough?** The working target was 2–3k cards with ≥ 400–500 "not a quote". There are now **5,203 usable findings
(4,945 distinct places) with 2,239 "not a quote"** and 2,886 real quotes with a boundary label — enough to fine-tune.

Recommended split: **B** — test = the 15 reviewed Bin Baz lessons (score Laya on *your* labels there, the gold standard; train
on nothing from those lessons), train = the lecture batches: **3,480 findings, 1,594 not a quote, 1,884 with a boundary**.
Split A (your labels as test, everything else as train) leaks context, because your labels and the written-text / Sonnet
labels share the same lessons.

Caveat: the training labels are mostly Sonnet's (agreed with you on 58 / 60 cards in the blind tests) and the negatives are
mostly loose-profile Quran look-alikes from YouTube; spot-check a sample (`autolabel.spot_check`) before training.
