import { useState, type Dispatch } from "react";
import { useI18n, type MessageKey } from "../../shell/i18n";
import { useToasts } from "../../shell/toasts";
import type { Word } from "../lectures/view/model";
import { clockText } from "../lectures/view/sync";
import { useAddQuote, useSuggestions, useUndo, type SourceType, type Suggestion } from "./api";
import type { BoardAction } from "./board";

const KINDS: SourceType[] = ["QURAN", "HADITH", "ADHKAR"];
const KIND_KEY: Record<SourceType, MessageKey> = { QURAN: "kindOne.quran", HADITH: "kindOne.hadith", ADHKAR: "kindOne.dhikr" };
const KIND_CLASS: Record<SourceType, string> = { QURAN: "quran", HADITH: "hadith", ADHKAR: "dhikr" };
/** The Qira'at the engine knows (engine/src/v3.js QIRAAT_CATALOG); their names are Arabic in both languages. */
const QIRAAT: [string, string][] = [
  ["hafs", "رواية حفص عن عاصم"],
  ["warsh", "رواية ورش عن نافع"],
  ["qaloon", "رواية قالون عن نافع"],
  ["doori", "رواية الدوري عن أبي عمرو"],
  ["shubah", "رواية شعبة عن عاصم"],
  ["khalaf", "رواية خلف عن حمزة"],
  ["soosi", "رواية السوسي عن أبي عمرو"],
  ["ibn_kathir", "قراءة ابن كثير المكي"],
  ["ibn_amir", "قراءة ابن عامر الشامي"],
  ["kisai", "قراءة الكسائي الكوفي"],
];
const OUTSIDE = "OUTSIDE_CORPUS";

type Props = {
  lectureId: number;
  words: readonly Word[];
  range: [number, number];
  kind: SourceType | null;
  dispatch: Dispatch<BoardAction>;
};

/** F-052, F-053: find the reference of the selected words and insert them as a missed quote. The closest
 *  references are ranked on the server (the engine's word weights); the best one is chosen unless nothing matched,
 *  and then "outside the sources" is. */
export function MissedQuoteStudio({ lectureId, words, range, kind: askedKind, dispatch }: Props) {
  const { t } = useI18n();
  const toasts = useToasts();
  const [a, b] = range;
  const text = words.slice(a, b + 1).map((w) => w.text).join(" ");
  const [kind, setKind] = useState<SourceType>(askedKind ?? "QURAN");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [outsideRef, setOutsideRef] = useState("");
  const [qiraah, setQiraah] = useState("hafs");
  const suggestions = useSuggestions(text, kind, query, true);
  const hits = suggestions.data ?? [];
  const best = hits[0] && hits[0].score > 0 ? hits[0].unitId : OUTSIDE;
  const chosen = picked ?? (suggestions.data ? best : null);
  const unit = hits.find((h) => h.unitId === chosen) ?? null;
  const addQuote = useAddQuote(lectureId);
  const undo = useUndo(lectureId);

  const insert = () => {
    const outside = chosen === OUTSIDE || !unit;
    addQuote.mutate(
      { start: a, end: b, unit_id: outside ? null : unit!.unitId, source_type: kind, ref: outside ? outsideRef.trim() : "", qiraah },
      {
        onSuccess: (done) => {
          const ref = outside ? outsideRef.trim() || t("studio.outside") : unit!.displayRef;
          toasts.success(t("studio.added", { ref }), { label: t("undo.action"), run: () => undo.mutate() });
          dispatch({ type: "selectFinding", id: done.finding_id ?? null });
        },
      },
    );
  };

  return (
    <section className="panel" data-testid="studio">
      <div className="panel-h">
        <h3 className="font-semibold">{t("studio.title")}</h3>
        <span className="flex-1" />
        <span className="mono text-xs text-ink-3" dir="ltr">
          {clockText(words[a]?.start ?? 0)} – {clockText(words[b]?.end ?? 0)}
        </span>
      </div>
      <div className="panel-b flex flex-col gap-3">
        <div className="quote" data-testid="studio-words">
          {text}
        </div>
        <div className="row gap-2 text-s">
          <label className="row gap-1">
            {t("studio.from")}
            <input
              className="input mono h-8 w-20"
              type="number"
              min={1}
              max={words.length}
              value={a + 1}
              aria-label={t("studio.from")}
              onChange={(e) => dispatch({ type: "setRange", start: Number(e.target.value) - 1, end: b, count: words.length })}
            />
          </label>
          <label className="row gap-1">
            {t("studio.to")}
            <input
              className="input mono h-8 w-20"
              type="number"
              min={1}
              max={words.length}
              value={b + 1}
              aria-label={t("studio.to")}
              onChange={(e) => dispatch({ type: "setRange", start: a, end: Number(e.target.value) - 1, count: words.length })}
            />
          </label>
          <button className="btn small ghost" onClick={() => dispatch({ type: "clear" })}>
            {t("studio.reset")}
          </button>
        </div>

        <div className="field">
          <span className="label">{t("studio.kind")}</span>
          <div className="seg" role="group" aria-label={t("studio.kind")}>
            {KINDS.map((k) => (
              <button
                key={k}
                aria-pressed={kind === k}
                onClick={() => {
                  setKind(k);
                  setPicked(null);
                }}
              >
                {t(KIND_KEY[k])}
              </button>
            ))}
          </div>
        </div>
        {kind === "QURAN" && (
          <label className="field">
            <span className="label">{t("studio.qiraah")}</span>
            <select className="input" value={qiraah} onChange={(e) => setQiraah(e.target.value)}>
              {QIRAAT.map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span className="label">{t("studio.search")}</span>
          <input
            className="input"
            type="search"
            value={query}
            placeholder={t("studio.searchHint")}
            onChange={(e) => {
              setQuery(e.target.value);
              setPicked(null);
            }}
          />
        </label>

        <div className="results" role="radiogroup" aria-label={t("studio.results")} data-testid="suggestions">
          {suggestions.isPending && !suggestions.data && <span className="text-s text-ink-3">{t("studio.searching")}</span>}
          {hits.slice(0, 8).map((h) => (
            <label key={h.unitId} className="result">
              <input type="radio" name="studio-unit" checked={chosen === h.unitId} onChange={() => setPicked(h.unitId)} />
              <span className="t" title={h.words.join(" ")}>
                {snippet(h)}
              </span>
              <span className={`kchip ${KIND_CLASS[kind]}`}>{h.displayRef}</span>
            </label>
          ))}
          <label className="result">
            <input type="radio" name="studio-unit" checked={chosen === OUTSIDE} onChange={() => setPicked(OUTSIDE)} />
            <span className="t">{t("studio.outside")}</span>
            <span />
          </label>
        </div>

        {chosen === OUTSIDE ? (
          <label className="field">
            <span className="label">{t("studio.outsideRef")}</span>
            <input className="input" value={outsideRef} placeholder={t("studio.outsideRefHint")} onChange={(e) => setOutsideRef(e.target.value)} />
          </label>
        ) : (
          unit && (
            <div className="field">
              <span className="label">
                {t("studio.preview", { ref: unit.displayRef, n: unit.matched.length, of: unit.words.length })}
              </span>
              <div className="quote" data-testid="studio-preview">
                {unit.words.map((w, k) => (
                  <span key={k}>
                    <span className={unit.matched.includes(k) ? "hit" : undefined}>{w}</span>{" "}
                  </span>
                ))}
              </div>
            </div>
          )
        )}

        <div className="row">
          <button className="btn primary" disabled={addQuote.isPending || chosen === null} onClick={insert}>
            {t("studio.insert")}
          </button>
          <button className="btn ghost" onClick={() => dispatch({ type: "clear" })}>
            {t("edit.cancel")}
          </button>
        </div>
      </div>
    </section>
  );
}

/** About 12 words of the unit around its first matched word. */
function snippet(h: Suggestion): string {
  const first = h.matched[0] ?? 0;
  const from = first > 6 ? first - 3 : 0;
  const to = Math.min(h.words.length, from + 12);
  return `${from > 0 ? "… " : ""}${h.words.slice(from, to).join(" ")}${to < h.words.length ? " …" : ""}`;
}
