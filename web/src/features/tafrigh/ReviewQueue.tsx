import { useState } from "react";
import { useI18n } from "../../shell/i18n";
import { useToasts } from "../../shell/toasts";
import { segmentsOf, useReview, type RunDetail } from "./api";
import { REASON_KEYS, nextToReview, percent } from "./labels";
import { SentenceCard } from "./SentenceCard";

/** F-119: the sentences that need a person — low confidence, rejected corrections, a failed request — one by one:
 *  confirm, relabel, undo a correction, next. The action is saved on the server at once, so closing the page or
 *  restarting the server loses nothing. */
export function ReviewQueue({ lectureId, run }: { lectureId: number; run: RunDetail }) {
  const { t } = useI18n();
  const toasts = useToasts();
  const review = useReview(lectureId, run.run.run_id);
  const segments = segmentsOf(run);
  const order = segments.map((s) => s.id);
  const items = run.review_items;
  const flagged = new Set(items.map((i) => i.segment_id));
  const [open, setOpen] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <p className="panel-b m-0 text-ink-2" role="status" data-testid="tfg-review-empty">
        {t("tfg.review.empty")}
      </p>
    );
  }
  const byId = new Map(segments.map((s, k) => [s.id, { s, k }]));
  const act = (segmentId: string) => (request: Parameters<typeof review.mutate>[0]) =>
    review.mutate(request, {
      onSuccess: (detail) => {
        // go on to the next sentence that still needs review (the one just reviewed has left the queue)
        const left = new Set(detail.review_items.map((i) => i.segment_id));
        const next = nextToReview(order, left, segmentId);
        if (next) setOpen(next);
        else {
          setOpen(null);
          toasts.success(t("tfg.review.allDone"));
        }
      },
    });

  return (
    <div className="panel-b flex flex-col" data-testid="tfg-review">
      <p className="m-0 mb-2 text-s text-ink-2" data-testid="tfg-review-count">{t("tfg.review.count", { n: items.length })}</p>
      {items.map((item) => {
        const entry = byId.get(item.segment_id);
        if (!entry) return null;
        const { s, k } = entry;
        const isOpen = open === item.segment_id; // a sentence that left the queue is simply not listed any more
        return (
          <div key={item.segment_id} className={`tfg-seg${isOpen ? " open" : ""}`} data-testid="tfg-review-item">
            <button type="button" className="sent" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : item.segment_id)}>
              <span className="mono text-xs text-ink-3">{k + 1}</span>
              <span className="t ar">{item.active_text.trim()}</span>
              <span className="row text-xs">
                {(item.reasons ?? []).map((r) => (r in REASON_KEYS ? REASON_KEYS[r] : null)).filter(Boolean).slice(0, 1).map((key) => (
                  <span key={key} className="vchip unsure">{t(key!)}</span>
                ))}
                <span className="mono text-ink-3">{percent(item.confidence)}</span>
              </span>
            </button>
            {isOpen && (
              <SentenceCard
                segment={s}
                position={k + 1}
                item={item}
                remaining={items.length - 1}
                busy={review.isPending}
                onAction={act(item.segment_id)}
                onNext={() => {
                  const next = nextToReview(order, flagged, item.segment_id);
                  if (next) setOpen(next);
                }}
                onClose={() => setOpen(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
