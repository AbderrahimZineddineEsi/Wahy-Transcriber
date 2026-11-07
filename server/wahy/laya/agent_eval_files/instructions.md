# Blind labelling test — label 30 findings

You are labelling findings of a quote detector for Arabic Islamic lectures (here: lessons of Sheikh Ibn Baz).
The detector reads the speech-to-text transcript of a lesson and marks spans it thinks are a quotation of a Quran
verse, a hadith or a dhikr, with the reference it matched. Your job: judge each finding the way an expert human
reviewer would. Your answers are compared with a human expert's afterwards.

## How to work

- Everything you need is in this folder. **Do not read any file outside it**, and do not open `cards.json` or
  `answers.json` directly: use the tool.
- Work one card at a time, in order:
  1. `python3 label.py next` — shows the next card
  2. think, then `python3 label.py answer <card> <VERDICT> [<BOUNDARY>] "<short reason>"`
  3. repeat until it says all cards are answered. `python3 label.py status` shows progress.
- Answer every card. You can't listen to the audio (the human could); judge from the text.
- When done, write a short summary: how confident you were overall, and which cards were hardest and why.

## What a card shows

1. **What was said** — speech-to-text. The detected span is in ⟦ ⟧. The transcript is automatic: misspellings, missing
   or extra letters (ال، و، ف، ب، ل at the start; ة/ه/ا/ى/ي and pronoun endings at the end), one word split in two or two
   merged, and garbled words are normal. Judge what the speaker most likely said.
2. **Bin Baz written text at this spot** (only for Bin Baz lessons; other lectures have no written text, so the card
   skips this section) — the human transcript of the lesson, aligned to the speech. Words aligned with
   the detection are in ⟦ ⟧; a quote that the written text itself marks (with a verse reference) is in ⟪ ⟫. Not every
   quote is marked in the written text, so an unmarked spot is only weak evidence.
3. **Original text from the corpus** — the verse / hadith the detector matched, with the matched part in ⟦ ⟧.

## Verdict (choose one)

- **CORRECT** — a real quote: the speaker recites / quotes this verse, hadith or dhikr (verbatim, allowing ASR noise),
  in its own right.
- **IN_HADITH** — a verbatim verse quoted *inside* a hadith (the hadith itself contains the verse). Boundary is judged
  against the verse.
- **PARAPHRASE** — the speaker tells the hadith / verse **by its meaning**, mixing its words with his own (رواية بالمعنى):
  not verbatim, but clearly this text. No boundary.
- **FALSE** — not a quote. Typical cases:
  - the span is only the **chain of narrators** (سند: «حدثنا فلان عن فلان بن فلان»), names of narrators / companions,
    or the **takhrij** («رواه البخاري», «متفق عليه»), without the actual text (matn);
  - the sheikh **explaining** with the text's own words («يعني …»، «أي …»، «معناه …», repeating a word or two of the verse
    to explain it) rather than quoting it;
  - ordinary speech that happens to share words with the corpus text; a common formula used as speech (e.g. the
    basmala opening a book or lesson, «إن شاء الله», «الحمد لله» in passing) — unless it is part of a real recitation
    (e.g. the whole Fatiha recited: then the basmala is its first verse);
  - the speaker quotes a **different** text that merely shares some words with the reference shown.
- **NOT_SURE** — only when the evidence really doesn't allow a decision.

If the words are a real quote but another verse / riwaya would be a better reference (same words exist elsewhere,
another version of the hadith), it is still **CORRECT**.

## Boundary (only for CORRECT and IN_HADITH)

Did the detected span ⟦ ⟧ capture all the words of this quote **that the speaker actually said** here?

- **COMPLETE_SPAN** — nothing said was cut off.
- **MISSING_START** — the speaker said words of this reference right **before** the span (possibly garbled by the ASR)
  that the detector left out.
- **MISSING_END** — the same, right **after** the span.
- **MISSING_BOTH** — both.

Rules:
- Only words actually said count. The rest of a verse the speaker did **not** say is not missing.
- Judge against the **reference shown**: words that belong to a different (e.g. the neighbouring) verse are not missing
  from this one — a neighbouring verse is its own finding.
- A citation cue («قال تعالى»، «قال رسول الله ﷺ») is not part of the quote. Honorifics and short asides inside or around
  a quote («رضي الله عنه»، «صلى الله عليه وسلم»، «عز وجل»، «يعني») are neither missing nor extra.
- Garbled words still count as said: a cue followed by garbled words that clearly echo the start of the text, or garbled
  words right after the span that echo how the text continues, mean the quote is longer than the span.
- If the speaker skips part of a hadith and then continues with its later words, those later words are part of the
  quote (missing if the span stops before them).
- For hadith, the narrator chain is part of the quote only when the reference text itself includes it and the speaker
  says it.
