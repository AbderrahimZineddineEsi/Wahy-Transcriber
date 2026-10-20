# Tafrigh Multi-Run Comparison Report



## Configuration & Aggregate Performance

| Metric / Configuration | 20261020_002442_sample_dars_run1_candidateA_per_sentence_gated | 20261020_002442_sample_dars_run2_candidateA_windowed_gated | 20261020_002442_sample_dars_run3_candidateA_per_sentence_always_correct | 20261020_002442_sample_dars_run4_candidateB_jev_independent_parallel | 20261020_002442_sample_dars_run5_candidateB_jev_independent_sequential | 20261020_002442_sample_dars_run6_candidateB_jev_split_as_tag |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| Model Candidate | gemini_all | gemini_all | gemini_all | jev_hybrid | jev_hybrid | jev_hybrid |
| Processing Mode | per_sentence | windowed | per_sentence | per_sentence | per_sentence | per_sentence |
| JEV Layout | independent_questions | independent_questions | independent_questions | independent_questions | independent_questions | split_as_tag_option |
| Total Sentences | 10 | 10 | 10 | 10 | 10 | 10 |
| Wall-Clock Time (s) | 0.0 | 0.0 | 0.0 | 0.01 | 0.01 | 0.02 |
| Total Cost ($) | $0.000000 | $0.000000 | $0.000000 | $0.000000 | $0.000000 | $0.000000 |
| Cost per 100 Sentences ($) | $0.0000 | $0.0000 | $0.0000 | $0.0000 | $0.0000 | $0.0000 |
| Fallback Rate | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| Failure Rate | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |


### Per-Segment Disagreements
*Zero disagreements found across all segments!*

