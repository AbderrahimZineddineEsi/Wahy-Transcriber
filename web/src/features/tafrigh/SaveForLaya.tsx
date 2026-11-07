import { useState } from "react";
import { useI18n, type MessageKey } from "../../shell/i18n";
import { Modal } from "../../shell/Modal";
import { useToasts } from "../../shell/toasts";
import { useSaveTafrigh, useTafrighSaved } from "../training/api";
import { segmentsOf, type RunDetail } from "./api";
import { TAG_KEYS, labelSource, modelConfidence, percent } from "./labels";
import { QUICK_PICKS, countBySource, initialPick, quickPick, type QuickPick } from "./laya";

const PICK_KEYS: Record<QuickPick, MessageKey> = {
  all: "tfg.laya.pick.all",
  none: "tfg.laya.pick.none",
  invert: "tfg.laya.pick.invert",
  human: "tfg.laya.pick.human",
  corrected: "tfg.laya.pick.corrected",
  confident: "tfg.laya.pick.confident",
  no_review: "tfg.laya.pick.noReview",
};

const SOURCE_KEYS: Record<string, MessageKey> = {
  model: "tfg.source.model",
  human_confirmed: "tfg.label.confirmed",
  human_corrected: "tfg.label.corrected",
};

/** F-120: the button that saves a run's sentences as Laya training examples, with how many are saved already. */
export function SaveForLayaButton({ run }: { run: RunDetail }) {
  const { t } = useI18n();
  const saved = useTafrighSaved(run.run.run_id);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn small" data-testid="tfg-laya" onClick={() => setOpen(true)}>
        {t("tfg.laya.save")}
        {saved.data && <span className="ms-1 font-mono text-ok" data-testid="tfg-laya-saved">✓ {saved.data.sentences}</span>}
      </button>
      {open && <SaveForLaya run={run} onClose={() => setOpen(false)} />}
    </>
  );
}

function SaveForLaya({ run, onClose }: { run: RunDetail; onClose: () => void }) {
  const { t } = useI18n();
  const toasts = useToasts();
  const saved = useTafrighSaved(run.run.run_id);
  const save = useSaveTafrigh(run.run.run_id);
  const segments = segmentsOf(run);
  const needsReview = new Set(run.review_items.map((i) => i.segment_id));
  const [picked, setPicked] = useState(() => initialPick(segments, needsReview, saved.data?.segment_ids));
  const [note, setNote] = useState(saved.data?.note ?? "");
  const counts = countBySource(segments, picked);
  const chosen = segments.filter((s) => picked.has(s.id)).map((s) => s.id);

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  return (
    <Modal
      title={t("tfg.laya.title")}
      onClose={onClose}
      wide
      actions={
        <button
          className="btn primary small"
          data-testid="tfg-laya-confirm"
          disabled={!chosen.length || save.isPending}
          onClick={() =>
            save.mutate(
              { segment_ids: chosen, note: note.trim() || null },
              {
                onSuccess: (r) => {
                  toasts.success(t("tfg.laya.saved", { n: r.count, sentences: r.sentences }));
                  onClose();
                },
              },
            )
          }
        >
          {t("tfg.laya.confirm", { n: chosen.length })}
        </button>
      }
    >
      <p className="m-0 text-s text-ink-2">{t("tfg.laya.help")}</p>
      <div className="row flex-wrap">
        {QUICK_PICKS.map((k) => (
          <button key={k} className="chip" data-testid={`tfg-laya-pick-${k}`} onClick={() => setPicked(quickPick(k, segments, picked, needsReview))}>
            {t(PICK_KEYS[k])}
          </button>
        ))}
      </div>
      <p className="m-0 text-s text-ink-2" data-testid="tfg-laya-count">
        {t("tfg.laya.chosen", { n: chosen.length, total: segments.length })} · {t("tfg.label.corrected")} <b className="font-mono">{counts.human_corrected}</b> · {t("tfg.label.confirmed")}{" "}
        <b className="font-mono">{counts.human_confirmed}</b> · {t("tfg.source.model")} <b className="font-mono">{counts.model}</b>
      </p>
      {saved.data && <p role="status" className="m-0 rounded-m bg-accent-soft p-2 text-s text-accent">{t("tfg.laya.again")}</p>}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {segments.map((s, k) => {
          const conf = modelConfidence(s);
          const tag = TAG_KEYS[s.tag];
          return (
            <li key={s.id}>
              <label className={`flex items-start gap-2 rounded-m border border-line p-2 ${picked.has(s.id) ? "" : "opacity-60"}`}>
                <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} data-testid="tfg-laya-seg" aria-label={t("tfg.laya.sentence", { n: k + 1 })} />
                <span className="w-6 font-mono text-xs text-ink-3">{k + 1}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="vchip none">
                      {tag ? t(tag) : s.tag}
                      {s.level ? ` ${s.level}` : ""}
                    </span>
                    <span className="text-ink-2">{t(SOURCE_KEYS[labelSource(s)])}</span>
                    {conf !== null && <span className={`font-mono ${conf < 0.7 ? "text-bad" : "text-ink-3"}`}>{percent(conf)}</span>}
                    {needsReview.has(s.id) && <span className="text-unsure">{t("tfg.laya.needsReview")}</span>}
                  </span>
                  <span className="ar line-clamp-2 text-s">{s.display_text || s.text}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <input className="input" placeholder={t("tfg.laya.note")} aria-label={t("tfg.laya.note")} value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}
