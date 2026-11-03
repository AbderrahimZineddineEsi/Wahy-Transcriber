# Tafrigh with API models + AI verifier fixes (2026-10-29)

Tafrigh is now aimed at API models (Gemini, DeepSeek, any OpenRouter chat model). JEV still works and got a cheaper
option. Laya's verifier prompt is untouched.

## Sentence mode vs window mode — measured

Same Bin Baz lecture (`binbaz_audio_1821`), `gemini-3.1-flash-lite` direct, gated typo fixes.

| | requests | input tokens / sentence | output tokens / sentence | wall time | labels |
|---|---|---|---|---|---|
| old prompt, sentence mode (40 sent.) | 42 | 1,352 | 271 | 183 s | 39 paragraph, 2 comment |
| old prompt, window 20 (40 sent.) | 2 | 357 | 166 | 19 s | 38 paragraph, 2 comment |
| **new prompt, window 20 (40 sent.)** | **2** | **195** | **135** | **31 s** | 27 continuation, 11 paragraph, 2 comment |
| new prompt, window 10 (40 sent.) | 4 | 265 | 175 | 144 s* | 26 cont., 10 par., list intro + item |
| new prompt, sentence mode (20 sent.) | 24 | 1,565 | 266 | 423 s* | 12 cont., 8 par., 2 comment, 2 splits |

\* free-tier rate limiting (the first request waited 54 s).

The two modes agree on 16 of 18 shared sentences. Sentence mode found two extra sensible splits (the opening
formula | «أما بعد»); the disagreements were two items the window called list items without a list intro (flagged
for review). **Window mode is the default now**: ~8× fewer input tokens per sentence, ~2× fewer output tokens,
~10× fewer requests, same layout. Sentence mode is still the only mode for JEV / Laya.

The old prompt was the real problem in both modes: it never said the sentences are pause-cut fragments, so almost
everything became its own paragraph.

## Bugs found (and fixed)

Tafrigh
- Window size was fixed at 20 (no UI field). Now 2–40, default 15.
- A window reply with one missing id, another order, or one invalid field (`"level": "2"`, an unknown comment kind)
  re-sent the whole window, then redid every sentence one by one. Now answers are matched by id (or by position
  when renumbered), fields are cleaned one by one, and only a left-out sentence gets its own request.
- A sentence to split inside a window was re-asked with no context. Now the window's answer is used and the pieces
  are classified with their neighbours.
- Allowed tags were frozen at the window's start (the first window could not use "continuation").
- A heading's parent came from the model (it cannot know segment ids), so most level-2 headings fell back to
  "paragraph". The parent now comes from the outline.
- ~40 % of good typo fixes were rejected because the model's word index was one word off. An edit now moves to
  its quoted words only when they occur once in the sentence (or once within 3 words of the index).
- Progress: frozen during each window, then a jump; no final event. Now the bar has a striped "in flight" part,
  request counts (sent / expected), a live waiting timer, and the cost so far.
- The run report counted log lines as requests and showed $0 for windowed runs. Now cost and tokens come from
  the adapters, per purpose and model.
- Results were never saved (`tafrighResult` was a run field nobody wrote). Tafrigh runs are now saved per
  lecture like editor runs: picker, rename, save as new version (the server copies the run too), delete;
  review edits autosave.

AI verifier
- The "الطلبات" metric added up every request since the page was opened, across lectures. Now it counts the open
  run's requests.
- The progress label showed findings only. Now: `مقتبسات 7/16 • طلبات 2/5`.
- Gemini batches: an answer whose `finding_id` did not match gave **every finding of the batch the first
  finding's verdict** (reproduced on the committed code: FALSE / CORRECT / NOT_SURE saved as FALSE / FALSE / FALSE).
  Now: by id, then by position, else an error for that finding only.
- Passages were Laya-only. Now an option (on by default) for Gemini / OpenRouter / JEV.
- New system prompt for Gemini / OpenRouter chat; instructions now come before the finding, so providers that
  cache a repeated prefix (DeepSeek, Gemini) bill most of each request at the cached price.

## Live costs on OpenRouter (2026-11-02)

Same lecture. Per input sentence; costs are what OpenRouter charged. The running total matched its billing
($0.1173 reported, $0.11740 billed).

| Setup | $ per sentence | time for 20 | typo fixes |
|---|---|---|---|
| DeepSeek v4.1 Flash, window 15, thinking off | **0.000077** | 7 s | yes, inline |
| JEV one request, typo fixes off | 0.00012 | 15 s | no |
| Gemini 3.1 Flash-Lite, window 15 | 0.00032 | 10 s | yes, inline |
| JEV one request + Gemini helper | 0.00048 | ~50 s | yes, helper |
| DeepSeek v4.1 Flash, window 15, thinking on | 0.00050 | 57 s | yes, inline |
| DeepSeek v4.1 Flash, sentence mode, thinking on | 0.00108 | not measured | yes, inline |

Label agreement over those 20 sentences: JEV one request vs three, 20/20 at half the cost. DeepSeek thinking off vs
on, 18/20. DeepSeek vs JEV, 12/20, and DeepSeek gave far fewer paragraph starts (2 vs 10). There are no reference
labels for tafrigh, so this table shows cost and agreement, **not which model labels better**.

Verifier, DeepSeek, 16 findings in 15 requests: thinking on $0.0083 / 153 s, off $0.0014 / 40 s, same verdicts 16/16.
All 16 were CORRECT, so this lecture did not test hard cases; thinking stays on by default in the verifier. About half
of the input tokens were billed as cached, so the repeated-prefix change works.

Found during these runs:
- **Regression from this work:** the new classifier prompt was also sent to helper requests, the helper answered in
  the `decisions` shape, and its typo fixes and split points were dropped. JEV / Laya paid for them and got nothing.
  Fixed with a helper prompt of its own, plus a test.
- Cost was added only after a reply parsed, so cut-off replies that were retried went uncounted (35 % of the spend).
- JEV's request count showed calls, not requests (23 vs 47).
- The estimate assumed 8 % of sentences need the helper; on this lecture it was over 80 %.
- Tafrigh tests read keys from the shell and could spend real credit. They now run without keys.
- The sentence-mode DeepSeek run's wall time was invalid (19,880 s, the process was suspended), so it is left out.

## How it was made

- Read the pipeline, adapters, app endpoints, and verifier code; ran the tafrigh tests (80 pass, 1 already failing:
  `test_review_endpoint_survives_a_server_reload` expects review actions to write training data, which the code no
  longer does).
- Scratch harness (`tfg_harness.py`, session scratchpad) runs `TafrighPipeline` on the first N sentences of a real
  lecture, records every progress event, flag, tag, and edit. Ran it before and after each change.
- Calibrated the estimator on the real run (system prompt ≈ 4 chars/token, Arabic payload ≈ 2).
- Node VM test of `ai-verifier.js` with a mocked `fetch` (passages, positional matching, request counts), plus
  the same scenario on the committed file to confirm the batch bug.
- Headless Chromium on the real app: estimate table, windowed run with progress sampling, save as new version +
  rename + reload, and a 16-finding Gemini verifier check.
- Tests added: windowed matching / left-out sentences / renumbered ids, heading repair, windowed progress, cost
  breakdown, edit relocation, `/api/tafrigh/estimate`, `/api/tafrigh/clone-run`.
