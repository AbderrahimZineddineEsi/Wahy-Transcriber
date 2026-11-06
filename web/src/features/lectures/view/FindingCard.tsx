import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useI18n, type MessageKey } from "../../../shell/i18n";
import { useToasts } from "../../../shell/toasts";
import { useExpand, useSetVerdict, type Verdict } from "../../verification/api";
import { isClipped, type ViewFinding, type Word } from "./model";
import { quoteText } from "./Player";

/** Where to put a floating box under `anchor`, inside the scrolling reader (so it scrolls with the text).
 *  The box hangs from the anchor's reading-start side: right in Arabic, left in English. */
export function placeUnder(anchor: HTMLElement, box: HTMLElement, rtl: boolean, width = 316): CSSProperties {
  const a = anchor.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const top = a.bottom - b.top + box.scrollTop + 8;
  const along = rtl ? b.right - a.right : a.left - b.left;
  const x = Math.max(12, Math.min(along, b.width - width));
  return rtl ? { top, right: x } : { top, left: x };
}

type CardProps = {
  f: ViewFinding;
  words: readonly Word[];
  lectureId: number;
  style: CSSProperties;
  hasMedia: boolean;
  standard: boolean;
  readOnly: boolean;
  onPlay: () => void;
  onClose: () => void;
};

/** F-033: the card of one quote: kind, reference, verdict and boundary, the other possible references, the
 *  text, and play / edit / verify. */
export function FindingCard({ f, words, lectureId, style, hasMedia, standard, readOnly, onPlay, onClose }: CardProps) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const others = f.candidates.filter((c) => c !== f.ref);
  const toasts = useToasts();
  const setVerdict = useSetVerdict(lectureId);
  const expand = useExpand(lectureId);
  const canAct = !readOnly && f.id !== null;
  const expandIt = () =>
    expand.mutate(f.id!, {
      onSuccess: (r) => {
        const added = r.added.start + r.added.end;
        toasts.success(r.changed ? t("card.expanded", { n: added }) : t("card.expandNothing"));
      },
    });
  return (
    <div className="pop" style={style} role="dialog" aria-label={f.ref} data-testid="finding-card">
      <button className="iconbtn x" title={t("card.close")} aria-label={t("card.close")} onClick={onClose}>
        ✕
      </button>
      <div className="row pe-8">
        <span className={`kchip ${f.kind}`}>{t(`kindOne.${f.kind}` as MessageKey)}</span>
        <b>{f.ref}</b>
      </div>
      <div className="row">
        <span className={`vchip ${f.verdict}`}>{t(`verdict.${f.verdict}` as MessageKey)}</span>
        {f.boundary && <span className="text-xs text-ink-3">{t(`boundary.${f.boundary}` as MessageKey)}</span>}
        {f.verifier && <span className="mono text-[11px] text-ink-3">{[f.verifier, f.model].filter(Boolean).join(" · ")}</span>}
      </div>
      {f.ambiguous && others.length > 0 && (
        <div className="text-s text-ink-2">{t("card.ambiguous", { n: f.candidates.length, list: others.join("، ") })}</div>
      )}
      <div className="quote">{quoteText(words, f, standard)}</div>
      {canAct && (
        <div className="row" role="group" aria-label={t("card.yourVerdict")}>
          <span className="text-xs text-ink-3">{t("card.yourVerdict")}</span>
          {(["CORRECT", "NOT_SURE", "FALSE"] as Verdict[]).map((v) => {
            const key = v === "CORRECT" ? "ok" : v === "FALSE" ? "bad" : "unsure";
            return (
              <button
                key={v}
                className="chip"
                style={{ color: `var(--wahy-${key})` }}
                aria-pressed={f.verdict === key && f.verifier === "human"}
                onClick={() => setVerdict.mutate({ findingId: f.id!, verdict: v })}
              >
                <span className="dot" />
                <span className="text-ink-2">{t(`verdict.${key}` as MessageKey)}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="row">
        {hasMedia && (
          <button className="btn small primary" onClick={onPlay}>
            {t("card.play")}
          </button>
        )}
        {canAct && (
          <>
            <Link className="btn small" to={`/lectures/${lectureId}/edit?finding=${f.id}`}>
              {t("card.edit")}
            </Link>
            {isClipped(f) && (
              <button className="btn small" disabled={expand.isPending} onClick={expandIt}>
                {t("card.expand")}
              </button>
            )}
            <Link className="btn small ghost" to={`/lectures/${lectureId}/verify?finding=${f.id}`}>
              {t("card.verify")}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

type EditProps = { word: Word; style: CSSProperties; busy: boolean; onSave: (text: string) => void; onCancel: () => void };

/** F-041: correct a word where it stands (double-click it). Enter saves, Escape cancels. */
export function WordEditor({ word, style, busy, onSave, onCancel }: EditProps) {
  const { t } = useI18n();
  const [text, setText] = useState(word.text);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean || clean === word.text) onCancel();
    else onSave(clean);
  };
  return (
    <form className="wordedit" style={style} onSubmit={submit} data-testid="word-editor">
      <input
        className="input h-8"
        aria-label={t("word.edit")}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      />
      <button type="submit" className="btn small primary" disabled={busy}>
        {t("word.save")}
      </button>
      <button type="button" className="btn small ghost" onClick={onCancel}>
        {t("word.cancel")}
      </button>
    </form>
  );
}
