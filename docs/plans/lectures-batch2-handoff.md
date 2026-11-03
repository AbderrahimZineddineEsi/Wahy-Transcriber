# Handoff: fetch lecture batch 2 (download + transcribe only)

**For:** a fresh Claude Code session (Opus, medium effort). Read this file, then do the work. Keep the user's style rules: clear adult-level explanations, no jargon walls.

## Why

Laya (the local quote verifier) needs about 400–500 "not a quote" (FALSE) training cards. It has about 130. Batch 1 (25 lectures, 9.2 h of audio, 717 findings labelled by Sonnet) gave only 72 FALSE, because engine v4 is strict.

Another session is building **engine v5 and a "loose" profile** right now (`docs/plans/engine-v5-handoff.md`). The loose profile will produce more borderline findings, so more negatives. This session prepares the **audio and transcripts** it will run on. **Do not run the engine or Sonnet here**: findings depend on the engine, and v5 isn't finished.

## Hard constraints

- **Don't touch the files the v5 session is editing:** `js/**`, `index.html`, `backend/laya_datagen/engine_bridge.py`, `backend/laya_datagen/js/harness.js`, `backend/laya_datagen/engine_eval.py`, `pipeline.py`, `label.py`. If you think one of them needs a change, write it down in your final report instead.
- **Don't edit `notebooks/data/laya_autolabel.ipynb` or `notebooks/data/laya_review.ipynb`.** Create a new notebook.
- **API keys** live in the gitignored `.env` (`GROQ_API_KEY`, ...). Never print or commit them. If Groq answers with an auth or quota error that waiting doesn't fix, stop and tell the user to provide a new Groq key.
- **No git commits** unless the user asks.
- **Don't reuse lectures.** Skip every video id already in `lectures.YOUTUBE`, every Bin Baz lesson in `lectures.BINBAZ` and `lectures.REVIEWED`.

## What exists (reuse it, don't rewrite it)

| Piece | Where | What it does |
|---|---|---|
| Lecture lists | `backend/laya_datagen/lectures.py` | `YOUTUBE` (sheikh → video ids), `BINBAZ` (lesson URLs), `REVIEWED` (Bin Baz ids never to reuse) |
| YouTube download | `sources/youtube.py` → `download(video_id, sheikh)` | mono 64k mp3 at `data/laya_datagen/cache/audio/yt_<id>.mp3` + `lectures/yt_<id>/meta.json`; cached |
| Bin Baz | `sources/binbaz.py` → `get_lesson(url)`, `download_mp3(lesson)`, `usable_lessons(series_url, n)` | polite (2.5 s between requests), HTML cached; `download_mp3` rejects HTML pages served as mp3 |
| Speech-to-text | `asr.py` → `transcribe(path, backend="groq", model="whisper-large-v3-turbo")` | cached by the audio's hash, so a re-run never re-transcribes |
| Readable copies | `youtube.save_transcript(doc_id, asr, meta)` | `lectures/<id>/transcript.txt` + `words.json` (timestamps) |
| Reference loop | `notebooks/data/laya_autolabel.ipynb`, cell 4 | the batch-1 download → transcribe loop (copy its shape, minus the `pipeline.process_*` calls) |

Note: yt-dlp warns that no JavaScript runtime is available. Downloads still work, so ignore it. Some videos fail with a 403 error; replace them with another video.

## The task

### 1. Choose the lectures

Add `YOUTUBE_2` and `BINBAZ_2` to `lectures.py` (keep batch 1 untouched), with a one-line title comment per video like batch 1 has.

**Sheikhs (12):** the 10 from batch 1 plus 2 new ones.

| key | sheikh |
|---|---|
| ibn_uthaymeen | محمد بن صالح العثيمين |
| al_fawzan | صالح الفوزان |
| aziz_farhan_al_anzi | عزيز فرحان العنزي |
| al_albani | محمد ناصر الدين الألباني |
| saleh_al_sheikh | صالح آل الشيخ |
| abdulrazzaq_al_badr | عبد الرزاق البدر |
| sulayman_al_ruhayli | سليمان الرحيلي |
| saleh_al_osaimi | صالح العصيمي |
| abdussalam_al_shuwayer | عبد السلام الشويعر |
| mohammed_meziane | محمد مزيان |
| **saleh_sindi** (new) | صالح سندي |
| **saeed_ruslan** (new) | محمد سعيد رسلان |

**How many:** 3 videos per returning sheikh and 4 per new sheikh, so 38 videos. Each should be **8–35 minutes long**: the user prefers many short videos to a few long ones. Add **8–10 new Bin Baz lessons** that have a written transcript, because their ground truth lets the loose profile's precision be measured. Find them with `usable_lessons`, and prefer short radio or phone talks. The target is roughly **15–18 h of new audio**.

**What to pick, because it affects how many negatives the batch yields:**
- **Prefer hadith and text commentaries:** شرح رياض الصالحين, بلوغ المرام, الأربعين النووية, عمدة الأحكام, كتاب التوحيد, شرح صحيح البخاري/مسلم, and tafsir lessons. They are full of quotes, and they also contain narrator chains, the sheikh explaining with the text's own words, and partial echoes, which is exactly where the negatives come from.
- **Mix in some khutbas and admonitions (مواعظ)** for variety in speaking style. Two of the four videos for each new sheikh can be khutbas.
- **Avoid** edited clips with background music or nasheeds, compilations of several speakers, Q&A-only fatwa clips under 5 minutes, re-uploads of a batch-1 video, and non-Arabic dubbing.
- **Prefer** official channels or well-known lesson archives.
- **Check before adding:** use `yt_dlp` with `extract_info(..., download=False)` to confirm the duration, the title and that the video is available. Use `ytsearch` queries or web search to find candidates.

### 2. Create a notebook: `notebooks/data/laya_lectures.ipynb`

The notebook downloads and transcribes, and nothing more. Suggested cells:
1. A title, plus a markdown note on what the notebook does and that findings and labelling come later with engine v5.
2. **Setup**, the same as the autolabel notebook's setup but without the engine bridge.
3. **Download + transcribe** batch 2, both YouTube and Bin Baz. Wrap each lecture in a try/except that prints `✘ <id>: <error>` and continues; everything is cached, so a re-run resumes where it stopped. For Bin Baz, also check that the written text and the speech roughly line up (the batch-1 gate lives in `pipeline.process_cached`; don't call it here, just log the word counts).
4. **An inventory table:** source, sheikh, title, minutes, ASR word count and status. Show totals per sheikh and grand totals of lectures and hours.
5. A markdown "next step" cell: run engine v5 (normal and loose profiles) on batches 1 and 2, then Sonnet labels the new findings.

Add a `RUN_DOWNLOADS = True` switch in Setup. When it is False, the inventory comes only from what's already on disk.

### 3. Run it

Run the cells yourself (with nbconvert if it's installed, or by executing the cell sources in order in Python). **Groq free-tier limits:** whisper allows only a few hours of audio per hour and per day. When you hit a 429 or rate-limit error, report how far you got. The user can re-run the notebook later, and caching makes that cheap. Don't loop with sleeps for hours.

### 4. Report back (short)

- What was fetched, per sheikh: the number of videos and minutes.
- Total hours, and anything that failed and why.
- Whether Groq limits stopped the run, and how to resume it (re-run cell 3).
- Any lecture you weren't sure about (for example possible music, or doubts that it's the right speaker).

## Done means

- `lectures.py` has `YOUTUBE_2` and `BINBAZ_2`.
- `notebooks/data/laya_lectures.ipynb` exists and runs top to bottom.
- Audio and transcripts are in `data/laya_datagen/lectures/` and the cache.
- The inventory shows about 15 h or more of new audio, or the report says plainly that Groq limits stopped the run and how much remains.
- No engine or Sonnet calls were made.
