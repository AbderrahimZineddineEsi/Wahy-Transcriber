import { useState } from "react";
import { useI18n } from "../../shell/i18n";
import { CopyButton } from "../../shell/fields";
import { useToasts } from "../../shell/toasts";
import { duration, usd } from "../verification/format";
import { downloadRun, segmentsOf, useReview, type ExportFormat, type RunDetail } from "./api";
import { num } from "./format";
import { TAG_KEYS, labelSource, modelConfidence, nextToReview, percent, type Segment } from "./labels";
import { SentenceCard } from "./SentenceCard";

type Props = { lectureId: number; run: RunDetail };

/** F-117: the lesson as the run wrote it — the outline as a bar of headings (a click scrolls to it), warnings, the run
 *  summary with the cost breakdown, and every sentence with its label; a sentence opens its details and review. */
export function Lesson({ lectureId, run }: Props) {
  const { t } = useI18n();
  const toasts = useToasts();
  const review = useReview(lectureId, run.run.run_id);
  const segments = segmentsOf(run);
  const flagged = new Set(run.review_items.map((i) => i.segment_id));
  const [open, setOpen] = useState<string | null>(null);
  const order = segments.map((s) => s.id);

  const goTo = (id: string) => {
    setOpen(id);
    requestAnimationFrame(() => document.getElementById(`seg-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const act = (request: Parameters<typeof review.mutate>[0]) => review.mutate(request);
  const download = (format: ExportFormat) => void downloadRun(run.run.run_id, format).catch((e: Error) => toasts.error(e));

  return (
    <div className="panel-b flex flex-col gap-4" data-testid="tfg-lesson">
      <div className="row">
        <CopyButton label={t("tfg.lesson.copyMd")} text={() => run.markdown} />
        {(["md", "html", "json"] as const).map((f) => (
          <button key={f} className="btn small" data-testid={`tfg-export-${f}`} onClick={() => download(f)}>
            {t(`tfg.export.${f}` as never)}
          </button>
        ))}
      </div>

      {run.warnings.length > 0 && (
        <ul role="status" className="m-0 flex list-none flex-col gap-1 rounded-m bg-unsure-soft p-3 text-s text-unsure" data-testid="tfg-warnings">
          {run.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      <Summary run={run} />

      {run.outline.length > 0 && (
        <nav className="outline" aria-label={t("tfg.lesson.outline")} data-testid="tfg-outline">
          {run.outline.map((h) => (
            <button key={h.segment_id} type="button" className={h.level <= 1 ? "h1" : ""} style={{ marginInlineStart: `${Math.max(0, h.level - 2) * 8}px` }} onClick={() => goTo(h.segment_id)}>
              {h.title}
            </button>
          ))}
        </nav>
      )}

      <div data-testid="tfg-segments">
        {segments.map((s, k) => (
          <SentenceRow
            key={s.id}
            segment={s}
            position={k + 1}
            needsReview={flagged.has(s.id)}
            open={open === s.id}
            onToggle={() => setOpen(open === s.id ? null : s.id)}
          >
            <SentenceCard
              segment={s}
              position={k + 1}
              item={run.review_items.find((i) => i.segment_id === s.id)}
              remaining={[...flagged].filter((id) => id !== s.id).length}
              busy={review.isPending}
              onAction={act}
              onNext={() => {
                const next = nextToReview(order, flagged, s.id);
                if (next) goTo(next);
              }}
              onClose={() => setOpen(null)}
            />
          </SentenceRow>
        ))}
      </div>
    </div>
  );
}

function SentenceRow({ segment: s, position, needsReview, open, onToggle, children }: { segment: Segment; position: number; needsReview: boolean; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const { t } = useI18n();
  const source = labelSource(s);
  const confidence = modelConfidence(s);
  const heading = s.tag === "heading";
  return (
    <div id={`seg-${s.id}`} className={`tfg-seg${open ? " open" : ""}`} data-testid="tfg-seg" data-tag={s.tag} data-needs-review={needsReview ? "1" : undefined}>
      <button type="button" className={`sent ${s.tag === "matn_section" ? "matn" : ""}`} aria-expanded={open} onClick={onToggle}>
        <span className="mono text-xs text-ink-3">{s.tag === "matn_section" ? t("tfg.tag.matn_section") : TAG_KEYS[s.tag] ? t(TAG_KEYS[s.tag]) : s.tag}{s.level ? ` ${s.level}` : ""}</span>
        <span className={`t ar ${heading ? "tfg-heading" : ""}`}>{s.text.trim() || s.original_text.trim()}</span>
        <span className="row text-xs">
          {needsReview && <span className="vchip unsure">{t("tfg.card.needsReview")}</span>}
          {source !== "model" && <span className="vchip ok">{t(source === "human_confirmed" ? "tfg.label.confirmed" : "tfg.label.corrected")}</span>}
          <span className="mono text-ink-3">{percent(confidence)}</span>
          <span className="mono text-ink-3">{position}</span>
        </span>
      </button>
      {open && children}
    </div>
  );
}

/** The run in numbers (F-117): what it cost, how long it took, what it asked for; the cost by purpose and model. */
function Summary({ run }: { run: RunDetail }) {
  const { t } = useI18n();
  const r = run.run;
  const m = run.manifest as Record<string, unknown>;
  const breakdown = (m.cost_breakdown as { purpose: string; model: string; requests: number; retries: number; cost_usd: number; input_tokens: number; output_tokens: number }[] | undefined) ?? [];
  const rep = run.report as Record<string, unknown>;
  return (
    <details className="opts" open data-testid="tfg-summary">
      <summary>{t("tfg.summary.title")}</summary>
      <div className="stats my-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
        <div className="stat"><span className="label">{t("tfg.stat.sentences")}</span><b>{r.num_segments}</b></div>
        <div className="stat"><span className="label">{t("verify.stat.requests")}</span><b>{r.requests_sent}</b></div>
        <div className="stat"><span className="label">{t("verify.stat.cost")}</span><b data-testid="tfg-cost">{usd(r.total_cost_usd)}</b></div>
        <div className="stat"><span className="label">{t("verify.stat.time")}</span><b>{duration(r.wall_clock_seconds)}</b></div>
        <div className="stat"><span className="label">{t("tfg.summary.review")}</span><b>{r.needs_review}</b></div>
        <div className="stat"><span className="label">{t("tfg.summary.reviewed")}</span><b>{r.reviewed}</b></div>
      </div>
      <p className="m-0 mb-2 font-mono text-s text-ink-2" dir="ltr">
        {[r.model_candidate, String(m.gemini_route ?? r.model_name ?? ""), r.processing_mode === "windowed" ? `window ${r.window_size}` : r.processing_mode, r.typo_strategy ? `typos: ${r.typo_strategy}` : null, r.target_range ? `${r.target_range[0] + 1}–${r.target_range[1]}` : null]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {breakdown.length > 0 && (
        <table className="data text-s" aria-label={t("tfg.summary.breakdown")} data-testid="tfg-breakdown">
          <thead>
            <tr>
              <th>{t("tfg.summary.purpose")}</th>
              <th>{t("tfg.summary.model")}</th>
              <th>{t("verify.stat.requests")}</th>
              <th>{t("verify.stat.cost")}</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map((b, i) => (
              <tr key={i}>
                <td className="font-mono">{b.purpose}</td>
                <td className="font-mono" dir="ltr">{b.model}</td>
                <td className="font-mono">{b.requests}{b.retries ? ` (+${b.retries})` : ""}</td>
                <td className="font-mono">{usd(b.cost_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {num(rep, "failure_rate") > 0 && <p className="m-0 mt-2 text-s text-bad">{t("tfg.summary.failures", { p: Math.round(num(rep, "failure_rate") * 100) })}</p>}
      {r.created_at && <p className="m-0 mt-2 text-xs text-ink-3">{r.created_at.slice(0, 16).replace("T", " ")}</p>}
    </details>
  );
}
