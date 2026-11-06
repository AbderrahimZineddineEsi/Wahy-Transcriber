import { memo, useRef, useState, type Dispatch, type MouseEvent } from "react";
import { useI18n } from "../../shell/i18n";
import { useToasts } from "../../shell/toasts";
import type { ViewFinding, Word } from "../lectures/view/model";
import { useAddQuote, useUndo, type SourceType } from "./api";
import { litRange, type BoardAction, type BoardState } from "./board";
import { DhikrDialog, WordsDialog } from "./dialogs";

type BoardProps = {
  words: readonly Word[];
  /** the editable findings, in word order */
  list: readonly ViewFinding[];
  /** word → index into `list`, or -1 */
  at: Int32Array;
  chunks: { first: number; last: number }[];
  state: BoardState;
  dispatch: Dispatch<BoardAction>;
  /** a word was clicked (the video may follow) */
  onWord: (i: number) => void;
};

/** F-051: every word of the lecture as a button-like chip, quotes in their colour. Click the first and the last
 *  word of a missed quote (or drag across it) to select it; click a quote to inspect it. The board is drawn in
 *  chunks, and a chunk renders again only when the selection inside it changes, so a 2-hour lecture stays quick
 *  while the pointer moves. */
export function WordBoard({ words, list, at, chunks, state, dispatch, onWord }: BoardProps) {
  const drag = useRef<number | null>(null);
  const dragged = useRef(false);
  const lit = litRange(state);
  const sel = list.find((f) => f.id === state.finding) ?? null;

  const wordOf = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    return el ? Number(el.dataset.i) : null;
  };
  return (
    <div
      className="board"
      data-testid="board"
      onMouseDown={(e) => {
        drag.current = wordOf(e);
      }}
      onMouseUp={(e) => {
        const to = wordOf(e);
        if (drag.current !== null && to !== null && to !== drag.current) {
          dispatch({ type: "drag", from: drag.current, to });
          dragged.current = true;
        }
        drag.current = null;
      }}
      onClick={(e) => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        const i = wordOf(e);
        if (i === null) return;
        dispatch({ type: "click", i, findingId: at[i] >= 0 ? list[at[i]].id : null });
        onWord(i);
      }}
      onMouseOver={(e) => {
        if (state.anchor === null) return;
        const i = wordOf(e);
        if (i !== null) dispatch({ type: "hover", i });
      }}
    >
      {chunks.map((c) => {
        const clip = lit && lit.hi >= c.first && lit.lo <= c.last ? lit : null;
        const anchor = state.anchor !== null && state.anchor >= c.first && state.anchor <= c.last ? state.anchor : null;
        const fsel = sel && sel.end >= c.first && sel.start <= c.last && !state.range ? sel : null;
        return (
          <Chunk
            key={c.first}
            first={c.first}
            last={c.last}
            words={words}
            list={list}
            at={at}
            lo={clip?.lo ?? -1}
            hi={clip?.hi ?? -1}
            preview={clip?.preview ?? false}
            anchor={anchor}
            selStart={fsel?.start ?? -1}
            selEnd={fsel?.end ?? -1}
          />
        );
      })}
    </div>
  );
}

type ChunkProps = {
  first: number;
  last: number;
  words: readonly Word[];
  list: readonly ViewFinding[];
  at: Int32Array;
  lo: number;
  hi: number;
  preview: boolean;
  anchor: number | null;
  selStart: number;
  selEnd: number;
};

const Chunk = memo(function Chunk({ first, last, words, list, at, lo, hi, preview, anchor, selStart, selEnd }: ChunkProps) {
  const out = [];
  for (let i = first; i <= last; i++) {
    const f = at[i] >= 0 ? list[at[i]] : null;
    const inRange = i >= lo && i <= hi;
    const cls = ["bw", f ? f.kind : "", i >= selStart && i <= selEnd ? "fsel" : "", inRange ? (preview ? "preview" : "rsel") : "", anchor === i ? "anchor" : ""]
      .filter(Boolean)
      .join(" ");
    out.push(
      <span key={i} className={cls} data-i={i} data-f={f?.id ?? undefined}>
        {words[i].text}
      </span>,
      " ",
    );
  }
  return (
    <div className="chunk" style={{ containIntrinsicSize: `auto ${Math.ceil((last - first + 1) / 9) * 2.6}em` }}>
      {out}
    </div>
  );
});

type BarProps = {
  words: readonly Word[];
  state: BoardState;
  dispatch: Dispatch<BoardAction>;
  lectureId: number;
  hasMedia: boolean;
  onPlay: (a: number, b: number) => void;
};

/** F-055: what can be done with the selected words. */
export function SelectionBar({ words, state, dispatch, lectureId, hasMedia, onPlay }: BarProps) {
  const { t } = useI18n();
  const toasts = useToasts();
  const [dialog, setDialog] = useState<null | "words" | "dhikr">(null);
  const addQuote = useAddQuote(lectureId);
  const undo = useUndo(lectureId);
  if (state.anchor !== null && !state.range) {
    return (
      <div className="seltool" role="status">
        <span className="px-2">{t("edit.anchor", { word: words[state.anchor]?.text ?? "" })}</span>
        <button className="btn small" onClick={() => dispatch({ type: "clear" })}>
          {t("edit.cancel")}
        </button>
      </div>
    );
  }
  if (!state.range) return null;
  const [a, b] = state.range;
  const kind = (k: SourceType) => dispatch({ type: "kind", kind: k });
  return (
    <>
      <div className="seltool" role="toolbar" aria-label={t("edit.selection")} data-testid="seltool">
        <span className="px-2">{t("edit.selected", { n: b - a + 1 })}</span>
        <button className="btn small" onClick={() => kind("QURAN")}>
          {t("edit.asVerse")}
        </button>
        <button className="btn small" onClick={() => kind("HADITH")}>
          {t("edit.asHadith")}
        </button>
        <button className="btn small" onClick={() => kind("ADHKAR")}>
          {t("edit.asDhikr")}
        </button>
        <button className="btn small" onClick={() => setDialog("words")}>
          {t("edit.editWords")}
        </button>
        <button className="btn small" onClick={() => setDialog("dhikr")}>
          {t("edit.saveDhikr")}
        </button>
        {hasMedia && (
          <button className="btn small" onClick={() => onPlay(a, b)}>
            {t("edit.listen")}
          </button>
        )}
        <button className="btn small" onClick={() => dispatch({ type: "clear" })}>
          {t("edit.cancel")}
        </button>
      </div>
      {dialog === "words" && (
        <WordsDialog lectureId={lectureId} words={words} range={state.range} hasMedia={hasMedia} onPlay={() => onPlay(a, b)} onClose={() => setDialog(null)} onDone={() => dispatch({ type: "clear" })} />
      )}
      {dialog === "dhikr" && (
        <DhikrDialog
          text={words.slice(a, b + 1).map((w) => w.text).join(" ")}
          onClose={() => setDialog(null)}
          onSaved={(dhikr) =>
            // the old app also marked the words as that dhikr at once
            addQuote.mutate(
              { start: a, end: b, unit_id: dhikr.id, source_type: "ADHKAR", ref: dhikr.ref, qiraah: "hafs" },
              {
                onSuccess: (done) => {
                  toasts.success(t("edit.dhikrSaved", { ref: dhikr.ref }), { label: t("undo.action"), run: () => undo.mutate() });
                  dispatch({ type: "selectFinding", id: done.finding_id ?? null });
                },
              },
            )
          }
        />
      )}
    </>
  );
}
