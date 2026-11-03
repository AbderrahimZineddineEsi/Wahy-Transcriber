### verdict · you
| model | cards | verdict accuracy | not-a-quote recall | not-a-quote precision | real wrongly rejected | AUC | ECE | boundary accuracy |
|---|---|---|---|---|---|---|---|---|
| before: soft_asis (app) | 198 | 91.4 % [87–95] | 77.8 % [59–89] | 65.6 % [48–80] | 6.4 % [4–11] | 0.944 | 0.084 | 44.8 % [37–53] |
| v3_single | 198 | 86.4 % [81–90] | 70.4 % [52–84] | 50.0 % [35–65] | 11.1 % [7–17] | 0.920 | 0.068 | — |
| v3_mixed | 198 | 90.9 % [86–94] | 77.8 % [59–89] | 63.6 % [47–78] | 7.0 % [4–12] | 0.945 | 0.077 | — |
| 7 shallow fields (LR) | 198 | 83.8 % [78–88] | 66.7 % [48–81] | 43.9 % [30–59] | 13.5 % [9–19] | 0.857 | 0.040 | — |
| Gemini (cached) | 147 | 89.8 % [84–94] | 41.7 % [24–61] | 100.0 % [72–100] | 0.0 % [0–3] | 0.708 | 0.102 | 50.0 % [40–60] |
| JEV (cached) | 147 | 86.4 % [80–91] | 20.8 % [9–40] | 100.0 % [57–100] | 0.0 % [0–3] | 0.604 | 0.136 | 52.9 % [43–62] |
| Laya (base) (cached) | 111 | 54.0 % [45–63] | 88.9 % [56–98] | 14.0 % [7–25] | 48.0 % [39–58] | 0.704 | 0.460 | 30.4 % [22–40] |
| span length only (LR) | 198 | 79.3 % [73–84] | 29.6 % [16–48] | 26.7 % [14–44] | 12.9 % [9–19] | 0.723 | 0.109 | — |

### verdict · you + Sonnet
| model | cards | verdict accuracy | not-a-quote recall | not-a-quote precision | real wrongly rejected | AUC | ECE | boundary accuracy |
|---|---|---|---|---|---|---|---|---|
| before: soft_asis (app) | 1243 | 90.9 % [89–92] | 92.4 % [90–94] | 88.6 % [86–91] | 10.4 % [8–13] | 0.960 | 0.082 | 70.8 % [67–74] |
| v3_single | 1243 | 89.7 % [88–91] | 91.6 % [89–94] | 87.1 % [84–90] | 11.9 % [10–15] | 0.958 | 0.070 | — |
| v3_mixed | 1243 | 90.1 % [88–92] | 90.0 % [87–92] | 88.9 % [86–91] | 9.8 % [8–12] | 0.965 | 0.073 | — |
| 7 shallow fields (LR) | 1243 | 85.5 % [83–87] | 89.3 % [87–92] | 81.5 % [78–84] | 17.8 % [15–21] | 0.932 | 0.035 | — |
| Gemini (cached) | 180 | 90.0 % [85–94] | 38.5 % [22–57] | 90.9 % [62–98] | 0.7 % [0–4] | 0.689 | 0.100 | 51.9 % [43–60] |
| JEV (cached) | 180 | 87.2 % [82–91] | 19.2 % [9–38] | 83.3 % [44–97] | 0.7 % [0–4] | 0.593 | 0.128 | 54.9 % [46–63] |
| Laya (base) (cached) | 111 | 54.0 % [45–63] | 88.9 % [56–98] | 14.0 % [7–25] | 48.0 % [39–58] | 0.704 | 0.460 | 30.4 % [22–40] |
| span length only (LR) | 1243 | 81.7 % [79–84] | 78.7 % [75–82] | 81.5 % [78–84] | 15.7 % [13–19] | 0.890 | 0.042 | — |

### verdict · Sonnet · other lectures
| model | cards | verdict accuracy | not-a-quote recall | not-a-quote precision | real wrongly rejected | AUC | ECE | boundary accuracy |
|---|---|---|---|---|---|---|---|---|
| before: soft_asis (app) | 596 | 90.9 % [88–93] | 91.4 % [87–94] | 88.7 % [84–92] | 9.4 % [7–13] | 0.957 | 0.074 | 82.4 % [78–86] |
| v3_single | 596 | 90.6 % [88–93] | 91.8 % [88–94] | 87.8 % [83–91] | 10.3 % [7–14] | 0.961 | 0.075 | — |
| v3_mixed | 596 | 89.9 % [87–92] | 88.8 % [84–92] | 88.8 % [84–92] | 9.1 % [6–13] | 0.965 | 0.076 | — |
| 7 shallow fields (LR) | 596 | 86.6 % [84–89] | 91.8 % [88–94] | 80.9 % [76–85] | 17.6 % [14–22] | 0.941 | 0.057 | — |
| span length only (LR) | 596 | 81.9 % [79–85] | 80.9 % [76–85] | 79.1 % [74–84] | 17.3 % [14–22] | 0.897 | 0.051 | — |

### verdict · written text
| model | cards | verdict accuracy | not-a-quote recall | not-a-quote precision | real wrongly rejected | AUC | ECE | boundary accuracy |
|---|---|---|---|---|---|---|---|---|
| before: soft_asis (app) | 280 | 90.4 % [86–93] | 83.3 % [44–97] | 16.1 % [7–33] | 9.5 % [7–14] | 0.843 | 0.073 | 62.4 % [56–68] |
| v3_single | 280 | 91.8 % [88–94] | 83.3 % [44–97] | 18.5 % [8–37] | 8.0 % [5–12] | 0.818 | 0.085 | — |
| v3_mixed | 280 | 91.4 % [88–94] | 83.3 % [44–97] | 17.9 % [8–36] | 8.4 % [6–12] | 0.809 | 0.073 | — |
| 7 shallow fields (LR) | 280 | 92.9 % [89–95] | 83.3 % [44–97] | 20.8 % [9–40] | 6.9 % [4–11] | 0.904 | 0.051 | — |
| span length only (LR) | 280 | 82.9 % [78–87] | 83.3 % [44–97] | 9.6 % [4–21] | 17.2 % [13–22] | 0.919 | 0.169 | — |

### verdict by context · you
| model | inside a passage of consecutive verses (acc · real rejected) | next to a verse of the same surah (<= 3 ayat away) (acc · real rejected) | short (1-3 words) and isolated (acc · real rejected) | short (1-3 words) with a same-surah verse around (acc · real rejected) | has any neighbour finding (<= 40 words) (acc · real rejected) | no neighbour finding (acc · real rejected) |
|---|---|---|---|---|---|---|
| before: soft_asis (app) | 100.0 % [76–100] · 0/12 | 81.8 % [52–95] · 2/11 | 69.2 % [42–87] · 3/7 | 100.0 % [51–100] · 0/4 | 93.3 % [88–96] · 5/120 | 87.3 % [77–93] · 6/51 |
| v3_single | 91.7 % [65–99] · 1/12 | 81.8 % [52–95] · 2/11 | 69.2 % [42–87] · 4/7 | 100.0 % [51–100] · 0/4 | 91.1 % [85–95] · 9/120 | 76.2 % [64–85] · 10/51 |
| v3_mixed | 100.0 % [76–100] · 0/12 | 90.9 % [62–98] · 1/11 | 69.2 % [42–87] · 4/7 | 100.0 % [51–100] · 0/4 | 94.8 % [90–97] · 4/120 | 82.5 % [71–90] · 8/51 |

### verdict by span length · you
| model | 1-3 words (acc · real rejected) | 4-8 words (acc · real rejected) | 9+ words (acc · real rejected) |
|---|---|---|---|
| before: soft_asis (app) | 76.5 % [53–90] · 3/11 | 85.3 % [76–92] · 7/60 | 98.1 % [93–99] · 1/100 |
| v3_single | 76.5 % [53–90] · 4/11 | 76.0 % [65–84] · 13/60 | 95.3 % [89–98] · 2/100 |
| v3_mixed | 76.5 % [53–90] · 4/11 | 85.3 % [76–92] · 7/60 | 97.2 % [92–99] · 1/100 |

### verdict by context · you + Sonnet
| model | inside a passage of consecutive verses (acc · real rejected) | next to a verse of the same surah (<= 3 ayat away) (acc · real rejected) | short (1-3 words) and isolated (acc · real rejected) | short (1-3 words) with a same-surah verse around (acc · real rejected) | has any neighbour finding (<= 40 words) (acc · real rejected) | no neighbour finding (acc · real rejected) |
|---|---|---|---|---|---|---|
| before: soft_asis (app) | 95.4 % [87–98] · 3/65 | 79.5 % [66–89] · 7/33 | 91.9 % [89–94] · 23/39 | 82.6 % [63–93] · 3/14 | 91.0 % [89–93] · 57/510 | 90.3 % [86–93] · 12/152 |
| v3_single | 96.9 % [89–99] · 2/65 | 84.1 % [71–92] · 6/33 | 92.1 % [89–94] · 26/39 | 91.3 % [73–98] · 2/14 | 90.5 % [88–92] · 63/510 | 86.6 % [82–90] · 16/152 |
| v3_mixed | 95.4 % [87–98] · 3/65 | 86.4 % [73–94] · 5/33 | 91.6 % [88–94] · 24/39 | 87.0 % [68–95] · 3/14 | 90.3 % [88–92] · 51/510 | 89.1 % [84–92] · 14/152 |

### verdict by span length · you + Sonnet
| model | 1-3 words (acc · real rejected) | 4-8 words (acc · real rejected) | 9+ words (acc · real rejected) |
|---|---|---|---|
| before: soft_asis (app) | 91.4 % [88–94] · 26/53 | 84.9 % [81–88] · 37/256 | 97.6 % [96–99] · 6/353 |
| v3_single | 92.1 % [89–94] · 28/53 | 82.2 % [78–85] · 44/256 | 96.0 % [94–98] · 7/353 |
| v3_mixed | 91.4 % [88–94] · 27/53 | 83.6 % [80–87] · 33/256 | 96.5 % [94–98] · 5/353 |