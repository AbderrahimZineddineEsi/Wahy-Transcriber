// Word sync: which word is being spoken at time t. The player asks this up to 60 times a second on a lecture of
// 20,000 words, so it is a binary search (about 15 steps) over the words' start times, not a scan.

export type Timed = { start: number; end: number };

/** The start times prepared for `wordAt`. ASR sometimes gives a word a start a little before the previous
 *  word's, which would break a binary search; a running maximum keeps the list sorted without moving any word
 *  later than the one before it. */
export function startTimes(words: readonly Timed[]): Float64Array {
  const starts = new Float64Array(words.length);
  let max = -Infinity;
  for (let i = 0; i < words.length; i++) {
    max = Math.max(max, words[i].start);
    starts[i] = max;
  }
  return starts;
}

/** The index of the word spoken at time `t`: the last word that has started. Between two words the earlier
 *  one stays lit, so the marker never flickers off during a short pause. -1 before the first word. */
export function wordAt(starts: Float64Array, t: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** How long a caption stays on screen after its last word ends (the old app's overlay did the same). */
export const CAPTION_HOLD_S = 0.3;

/** The caption on screen at time `t`, or -1 when none is (before the first one, or in a pause longer than
 *  the hold). Captions come in time order and never overlap. */
export function captionAt(captions: readonly Timed[], starts: Float64Array, t: number): number {
  const i = wordAt(starts, t);
  if (i < 0) return -1;
  return t <= captions[i].end + CAPTION_HOLD_S ? i : -1;
}

/** Reading progress, 0 to 1. */
export function progress(t: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.min(1, Math.max(0, t / duration));
}

/** 75.4 → "1:15", 3725 → "1:02:05" (Western digits, as the design asks). */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
