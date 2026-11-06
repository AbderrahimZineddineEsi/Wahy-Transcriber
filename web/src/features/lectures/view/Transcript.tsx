import { memo, useEffect, useLayoutEffect, useRef, type MouseEvent, type RefObject } from "react";
import type { Clock } from "./clock";
import type { Paragraph, ViewFinding, Word } from "./model";
import { wordAt } from "./sync";

const BRACKETS: Record<ViewFinding["kind"], [string, string]> = { quran: ["﴿", "﴾"], hadith: ["«", "»"], dhikr: ["«", "»"] };

type Props = {
  paragraphs: Paragraph[];
  words: readonly Word[];
  onWord: (i: number, el: HTMLElement, quoteKey: string | null) => void;
  onRef: (key: string, el: HTMLElement) => void;
  onWordDoubleClick: (i: number, el: HTMLElement) => void;
};

/** The annotated transcript (F-031). It renders once per change of the paragraphs (a filter, the script,
 *  an edited word); playing the media never re-renders it: the marker, the played words, search hits and the
 *  open quote are classes changed by hand (the hooks below). Clicks are handled once, on the container. */
export const Transcript = memo(function Transcript({ paragraphs, words, onWord, onRef, onWordDoubleClick }: Props) {
  const handle = (e: MouseEvent<HTMLDivElement>, double: boolean) => {
    const target = e.target as HTMLElement;
    const ref = target.closest<HTMLElement>("[data-ref]");
    if (ref && !double) return onRef(ref.dataset.ref!, ref);
    const w = target.closest<HTMLElement>("[data-i]");
    if (!w) return;
    const i = Number(w.dataset.i);
    if (double) onWordDoubleClick(i, w);
    else onWord(i, w, w.closest<HTMLElement>("[data-f]")?.dataset.f ?? null);
  };
  return (
    <div className="transcript" data-testid="transcript" onClick={(e) => handle(e, false)} onDoubleClick={(e) => handle(e, true)}>
      {paragraphs.map((p) => (
        <ParagraphView key={p.key} p={p} words={words} />
      ))}
    </div>
  );
});

const ParagraphView = memo(function ParagraphView({ p, words }: { p: Paragraph; words: readonly Word[] }) {
  return (
    <p data-first={p.first} data-last={p.last} style={{ containIntrinsicSize: `auto ${Math.ceil((p.last - p.first + 1) / 11) * 2.8}em` }}>
      {p.pieces.map((piece) => {
        if (piece.type === "word") {
          return (
            <span key={piece.i}>
              <span className="w" data-i={piece.i}>
                {words[piece.i].text}
              </span>{" "}
            </span>
          );
        }
        const f = piece.f;
        const [open, close] = BRACKETS[f.kind];
        return (
          <span key={`q${f.start}`}>
            <span className={`f ${f.kind}${f.verdict === "bad" ? " bad" : ""}`} data-f={f.key} data-kind={f.kind} data-verdict={f.verdict}>
              <span className="br">{open}</span>
              {piece.tokens.map((tok, k) => (
                <span key={k}>
                  <span className="w" data-i={tok.i}>
                    {tok.text}
                  </span>
                  {k < piece.tokens.length - 1 ? " " : ""}
                </span>
              ))}
              <span className="br">{close}</span>
              <button type="button" className="ref" data-ref={f.key} aria-label={f.ref}>
                <span className={`vd ${f.verdict}`} />
                {f.ref}
                {f.ambiguous ? " ·؟" : ""}
              </button>
            </span>{" "}
          </span>
        );
      })}
    </p>
  );
});

/** Every element of word i (a word in standard script can show as several source words, or none); for each
 *  word the nearest word at or before it that has an element, so the marker always lands somewhere; and the
 *  paragraphs, with the paragraph of each word. */
type Index = { els: HTMLElement[][]; owner: Int32Array; paras: { el: HTMLElement; first: number; last: number }[]; paraOf: Int32Array };

const EMPTY: Index = { els: [], owner: new Int32Array(0), paras: [], paraOf: new Int32Array(0) };

function buildIndex(root: HTMLElement, count: number): Index {
  const els: HTMLElement[][] = Array.from({ length: count }, () => []);
  root.querySelectorAll<HTMLElement>("[data-i]").forEach((el) => {
    const i = Number(el.dataset.i);
    if (i >= 0 && i < count) els[i].push(el);
  });
  const owner = new Int32Array(count);
  let last = -1;
  for (let i = 0; i < count; i++) {
    if (els[i].length) last = i;
    owner[i] = last;
  }
  const paraOf = new Int32Array(count).fill(-1);
  const paras = Array.from(root.querySelectorAll<HTMLElement>("p[data-first]"), (el, k) => {
    const p = { el, first: Number(el.dataset.first), last: Number(el.dataset.last) };
    for (let i = p.first; i <= p.last && i < count; i++) paraOf[i] = k;
    return p;
  });
  return { els, owner, paras, paraOf };
}

const visibleIn = (el: HTMLElement, scroller: HTMLElement) => {
  const r = el.getBoundingClientRect();
  const s = scroller.getBoundingClientRect();
  return r.top >= s.top + 24 && r.bottom <= s.bottom - 24;
};

type MarkerOptions = {
  root: RefObject<HTMLElement | null>;
  scroller: RefObject<HTMLElement | null>;
  clock: Clock;
  starts: Float64Array;
  paragraphs: Paragraph[];
  follow: boolean;
  hits: readonly number[];
  selectedKey: string | null;
};

/** F-032: the spoken word gets the marker, the words already spoken their full colour, and with auto-follow
 *  the reader scrolls to keep the marker in view. Nothing here goes through React: per frame it is one binary
 *  search and a few class changes. "Already spoken" is marked per paragraph (`done`) for the paragraphs before
 *  the current one, and per word (`played`) only inside the current one, so even a jump from the first word
 *  to the last of a 2-hour lecture touches a few hundred elements, not 20,000. */
export function useTranscriptMarks({ root, scroller, clock, starts, paragraphs, follow, hits, selectedKey }: MarkerOptions) {
  const index = useRef<Index>(EMPTY);
  const cur = useRef(-1);
  const followRef = useRef(follow);
  followRef.current = follow;

  // After each render of the transcript: index the elements again and paint the position from scratch.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    index.current = buildIndex(el, starts.length);
    el.querySelectorAll(".played, .now, .done").forEach((w) => w.classList.remove("played", "now", "done"));
    const at = cur.current;
    cur.current = -1;
    paint(at);
    // paint reads only refs
  }, [paragraphs, starts]); // eslint-disable-line react-hooks/exhaustive-deps

  function markWords(from: number, to: number, on: boolean) {
    const { els } = index.current;
    for (let i = Math.max(0, from); i <= to && i < els.length; i++) els[i].forEach((w) => w.classList.toggle("played", on));
  }

  function paint(next: number) {
    const { els, owner, paras, paraOf } = index.current;
    const prev = cur.current;
    if (next === prev || !els.length) return;
    const prevPara = prev >= 0 ? paraOf[prev] : -1;
    const nextPara = next >= 0 ? paraOf[next] : -1;
    if (prevPara === nextPara) {
      if (next > prev) markWords(prev + 1, next, true);
      else markWords(next + 1, prev, false);
    } else {
      if (prevPara >= 0) markWords(paras[prevPara].first, prev, false);
      // paragraphs before the new one are done, the rest are not
      const lo = Math.min(prevPara, nextPara);
      const hi = Math.max(prevPara, nextPara);
      for (let k = Math.max(0, lo); k <= hi && k < paras.length; k++) paras[k].el.classList.toggle("done", k < nextPara);
      if (nextPara >= 0) markWords(paras[nextPara].first, next, true);
    }
    if (prev >= 0 && owner[prev] >= 0) els[owner[prev]].forEach((w) => w.classList.remove("now"));
    cur.current = next;
    root.current?.toggleAttribute("data-started", next >= 0);
    if (next < 0 || owner[next] < 0) return;
    const lit = els[owner[next]];
    lit.forEach((w) => w.classList.add("now"));
    const box = scroller.current;
    if (followRef.current && clock.get().playing && box && !visibleIn(lit[0], box)) {
      lit[0].scrollIntoView?.({ block: "center", behavior: "smooth" });
    }
  }

  useEffect(() => {
    const update = () => paint(wordAt(starts, clock.get().t));
    update();
    return clock.subscribe(update);
    // paint reads only refs
  }, [clock, starts]); // eslint-disable-line react-hooks/exhaustive-deps

  // F-034: search hits
  useLayoutEffect(() => {
    const { els } = index.current;
    hits.forEach((i) => els[i]?.forEach((w) => w.classList.add("hit")));
    return () => hits.forEach((i) => els[i]?.forEach((w) => w.classList.remove("hit")));
  }, [hits, paragraphs]);

  // the quote whose card is open
  useLayoutEffect(() => {
    if (!selectedKey) return;
    const el = root.current?.querySelector(`[data-f="${selectedKey}"]`);
    el?.classList.add("sel");
    return () => el?.classList.remove("sel");
  }, [selectedKey, paragraphs, root]);
}
