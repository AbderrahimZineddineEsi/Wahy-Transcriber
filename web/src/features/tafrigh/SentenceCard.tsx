import { useI18n } from "../../shell/i18n";
import type { ReviewItem, ReviewRequest } from "./api";
import {
  CUT_KEYS,
  REASON_KEYS,
  REJECT_KEYS,
  SPLIT_SKIP_KEYS,
  TAG_KEYS,
  TAG_OPTIONS,
  decisionOf,
  labelSource,
  markSplits,
  modelConfidence,
  parseTag,
  percent,
  providerName,
  splitInfo,
  tagProbabilities,
  tagValue,
  type Segment,
} from "./labels";

type Props = {
  segment: Segment;
  /** the sentence's place in the run, from 1 */
  position: number;
  /** present when the sentence is in the review queue */
  item: ReviewItem | undefined;
  /** how many other sentences still need review (0: no "next" button) */
  remaining: number;
  busy: boolean;
  onAction: (request: ReviewRequest) => void;
  onNext: () => void;
  onClose: () => void;
};

const SOURCE_KEYS = { model: "tfg.source.model", human_confirmed: "tfg.label.confirmed", human_corrected: "tfg.label.corrected" } as const;

/** F-118, F-119: everything about one sentence — its label, who gave it, how sure the model was, what a split did, which
 *  corrections were applied or turned down and why — and the review actions: confirm, relabel, undo a correction,
 *  next. Each action is saved on the server at once. */
export function SentenceCard({ segment: s, position, item, remaining, busy, onAction, onNext, onClose }: Props) {
  const { t } = useI18n();
  const source = labelSource(s);
  const decision = decisionOf(s);
  const confidence = modelConfidence(s);
  const split = splitInfo(s);
  const probs = tagProbabilities(s);
  const edits = s.trace.edits;
  const current = tagValue(s);
  const options = TAG_OPTIONS.some(([v]) => v === current) ? TAG_OPTIONS : null;
  const tagName = (key: string) => {
    if (key.startsWith("heading_")) return `${t("tfg.tag.heading")} ${key.split("_")[1] ?? ""}`.trim();
    return TAG_KEYS[key] ? t(TAG_KEYS[key]) : key;
  };
  const reasons = (item?.reasons ?? []).map((r) => (r in REASON_KEYS ? (REASON_KEYS[r] ? t(REASON_KEYS[r]!) : null) : r)).filter((r): r is string => !!r);

  return (
    <div className="tfg-card" data-testid="tfg-card" data-segment={s.id}>
      <div className="row text-s">
        <span className="mono text-ink-3">#{position}</span>
        <span className="vchip none" data-testid="card-tag">{tagName(s.tag)}{s.level ? ` ${s.level}` : ""}</span>
        <span className={`vchip ${source === "model" ? "none" : "ok"}`} data-testid="card-source">{t(SOURCE_KEYS[source])}</span>
        {decision.provider && <span className="text-ink-3">{t("tfg.card.by", { who: providerName(decision.provider) })}</span>}
        {confidence !== null && <span className="mono text-ink-3" data-testid="card-confidence">{percent(confidence)}</span>}
        {item && <span className="vchip unsure">{t("tfg.card.needsReview")}</span>}
        <span className="flex-1" />
        <button className="btn small ghost" aria-label={t("modal.close")} onClick={onClose}>✕</button>
      </div>

      {reasons.length > 0 && <p className="m-0 text-s text-unsure">{reasons.join(" · ")}</p>}

      {split?.kind === "piece" && (
        <div className="tfg-note" data-testid="card-split">
          <b>✂ {t("tfg.split.piece", { piece: split.piece ?? "?", pieces: split.pieces ?? "?" })}</b>
          <div>
            {t("tfg.split.asked", { who: providerName(split.asker) || t("tfg.split.model") })} · {t("tfg.split.pointsBy", { who: split.pointsBy ?? t("tfg.split.classifier") })}
          </div>
          <div className="ar">{markSplits(split.text, split.used)}</div>
          <div>{t("tfg.split.labelledBy", { who: providerName(split.label) || "—" })}</div>
        </div>
      )}
      {split?.kind === "skipped" && (
        <div className="tfg-note" data-testid="card-split">
          <b>✂ {t("tfg.split.askedNotDone", { who: providerName(split.asker) || t("tfg.split.model") })}</b>
          <div>
            {split.why && SPLIT_SKIP_KEYS[split.why] ? t(SPLIT_SKIP_KEYS[split.why]) : (split.why ?? "—")}
            {split.proposed.length > 0 && <span className="mono text-ink-3"> ({split.proposed.join(", ")})</span>}
          </div>
        </div>
      )}

      {probs.length > 0 && (
        <div className="row text-xs" data-testid="card-probs">
          <span className="text-ink-3">{t("tfg.card.probabilities")}</span>
          {probs.map(([k, v]) => (
            <span key={k} className="vchip none">{tagName(k)} <span className="mono">{percent(v)}</span></span>
          ))}
        </div>
      )}

      <p className="m-0 ar" data-testid="card-text">{s.text.trim()}</p>
      {s.corrected_text && (
        <p className="m-0 text-s text-ink-3">
          {t("tfg.card.original")} <span className="ar">{s.original_text.trim()}</span>
        </p>
      )}

      {(edits?.accepted?.length ?? 0) + (edits?.rejected?.length ?? 0) > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-s" data-testid="card-edits">
          {edits?.accepted?.map((e, i) => (
            <li key={`a${i}`} className="text-ok">
              ✔ {t("tfg.card.fixed")} <s className="text-ink-3">{e.original}</s> ← <b>{e.replacement}</b>
              {e.reason && <span className="text-ink-3"> ({e.reason})</span>}
            </li>
          ))}
          {edits?.rejected?.map((e, i) => (
            <li key={`r${i}`} className={e.why === "inside_detected_quotation" ? "text-ink-3" : "text-bad"}>
              {e.why === "inside_detected_quotation" ? "◌ " : "✘ "}
              {e.why === "inside_detected_quotation" ? t("tfg.card.notApplied") : t("tfg.card.rejected")} {e.original ?? e.span} ← {e.replacement} — {e.why && REJECT_KEYS[e.why] ? t(REJECT_KEYS[e.why]) : (e.why ?? "")}
            </li>
          ))}
        </ul>
      )}

      {(s.quotes.length > 0 || s.review_flags.length > 0) && (
        <div className="row text-xs">
          {s.quotes.map((q, i) => (
            <span key={i} className="vchip ok">{q.ref}{q.band === "CANDIDATE" ? " ؟" : ""}</span>
          ))}
          {s.review_flags.map((f) => (
            <span key={f} className="vchip bad">{f}</span>
          ))}
        </div>
      )}
      <div className="row text-xs text-ink-3">
        <span>{t("tfg.card.endedBy")} {s.cut_reason && CUT_KEYS[s.cut_reason] ? t(CUT_KEYS[s.cut_reason]) : (s.cut_reason ?? "—")}</span>
      </div>

      <div className="row border-t border-line pt-2">
        <label className="row text-s">
          <span className="text-ink-2">{t("tfg.card.label")}</span>
          <select
            className="input h-8 w-auto"
            data-testid="card-relabel"
            aria-label={t("tfg.card.label")}
            value={options ? current : "__other"}
            disabled={busy}
            onChange={(e) => onAction({ segment_id: s.id, action: "correct", ...parseTag(e.target.value) } as ReviewRequest)}
          >
            {!options && <option value="__other" disabled>{tagName(s.tag)}</option>}
            {TAG_OPTIONS.map(([v, key]) => (
              <option key={v} value={v}>{t(key)}</option>
            ))}
          </select>
        </label>
        {(source === "model" || item) && (
          <button className="btn small primary" data-testid="card-confirm" disabled={busy} onClick={() => onAction({ segment_id: s.id, action: "confirm" })}>
            ✓ {t("tfg.card.confirm")}
          </button>
        )}
        {item?.has_typo_versions && (
          <button className="btn small danger" data-testid="card-undo" disabled={busy} onClick={() => onAction({ segment_id: s.id, action: "reject" })}>
            ↩ {t("tfg.card.undoFix")}
          </button>
        )}
        <span className="flex-1" />
        {remaining > 0 && (
          <button className="btn small" data-testid="card-next" onClick={onNext}>
            {t("tfg.card.next", { n: remaining })}
          </button>
        )}
      </div>
    </div>
  );
}
