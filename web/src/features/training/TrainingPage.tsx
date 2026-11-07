import { useRef, useState } from "react";
import { useI18n, type MessageKey } from "../../shell/i18n";
import { CopyButton } from "../../shell/fields";
import { useToasts } from "../../shell/toasts";
import { formatDate } from "../lectures/format";
import { rawJson, readableJson } from "../verification/format";
import {
  exportUrl,
  useClearTraining,
  useImportFile,
  useImportLegacy,
  useTraining,
  useTrainingRow,
  type Imported,
  type LabelFilter,
  type Origin,
  type TaskFilter,
  type TrainingCounts,
  type TrainingRow,
} from "./api";
import { boundaryKey, chipOf, lineage, tafrighAnswerKey } from "./format";

const PAGE = 200;
const ORIGINS: [Origin, MessageKey][] = [
  ["all", "train.filter.all"],
  ["gold", "train.filter.gold"],
  ["approval", "train.filter.approval"],
  ["ai", "train.filter.ai"],
  ["legacy", "train.filter.legacy"],
  ["tafrigh", "train.filter.tafrigh"],
];

/** F-100, F-101, F-103, F-104: the rows Laya learns from, where each came from, and the files for Kaggle. */
export function TrainingPage() {
  const { t } = useI18n();
  const toasts = useToasts();
  const [origin, setOrigin] = useState<Origin>("all");
  const [task, setTask] = useState<TaskFilter>("all");
  const [label, setLabel] = useState<LabelFilter>("ALL");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [goldOnly, setGoldOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const page = useTraining({ origin, task, label, q, limit });
  const importFile = useImportFile();
  const importLegacy = useImportLegacy();
  const clear = useClearTraining();
  const counts = page.data?.counts;

  const imported = (r: Imported) => toasts.success(t("train.imported", { n: r.imported, replaced: r.replaced, skipped: r.skipped }));

  return (
    <>
      <div className="row flex-wrap">
        <h1 className="text-xl font-semibold">{t("page.training")}</h1>
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-s text-ink-2">
          <input type="checkbox" checked={goldOnly} onChange={(e) => setGoldOnly(e.target.checked)} data-testid="train-gold-only" />
          {t("train.goldOnly")}
        </label>
        <a className="btn primary" href={exportUrl("verification", goldOnly)} download data-testid="train-export">
          {t("train.export")}
        </a>
        <a className="btn" href={exportUrl("tafrigh", goldOnly)} download data-testid="train-export-tafrigh">
          {t("train.exportTafrigh")}
        </a>
      </div>

      <Counters counts={counts} />

      <div className="vgrid">
        <section className="panel">
          <div className="panel-h flex-wrap">
            <div className="seg" role="group" aria-label={t("train.origin")}>
              {ORIGINS.map(([id, key]) => (
                <button key={id} aria-pressed={origin === id} onClick={() => setOrigin(id)}>
                  {t(key)}
                </button>
              ))}
            </div>
            <select className="input h-8 w-auto" aria-label={t("train.task")} value={task} onChange={(e) => setTask(e.target.value as TaskFilter)}>
              <option value="all">{t("train.task.all")}</option>
              <option value="verification">{t("train.task.verification")}</option>
              <option value="tafrigh">{t("train.task.tafrigh")}</option>
            </select>
            <select className="input h-8 w-auto" aria-label={t("train.label")} value={label} onChange={(e) => setLabel(e.target.value as LabelFilter)}>
              <option value="ALL">{t("train.label.all")}</option>
              <option value="CORRECT">{t("verdict.ok")}</option>
              <option value="FALSE">{t("verdict.bad")}</option>
              <option value="NOT_SURE">{t("verdict.unsure")}</option>
              <option value="CLIPPED">{t("train.label.clipped")}</option>
            </select>
            <input className="input h-8 min-w-40 flex-1" type="search" aria-label={t("train.search")} placeholder={t("train.search")} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {page.data && page.data.rows.length === 0 ? (
            <p className="panel-b m-0 text-ink-3" data-testid="train-empty">
              {counts?.total ? t("train.noMatch") : t("train.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data" data-testid="train-table">
                <thead>
                  <tr>
                    <th>{t("train.col.quote")}</th>
                    <th>{t("train.col.reference")}</th>
                    <th>{t("train.col.label")}</th>
                    <th>{t("train.col.ai")}</th>
                    <th>{t("train.col.boundary")}</th>
                    <th>{t("train.col.origin")}</th>
                    <th>{t("train.col.lecture")}</th>
                    <th>{t("train.col.date")}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.data?.rows.map((r) => (
                    <Row key={r.id} r={r} picked={r.id === selected} onOpen={() => setSelected(r.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {page.data && page.data.rows.length < page.data.matching && (
            <div className="panel-b">
              <button className="btn small" onClick={() => setLimit(limit + PAGE)}>
                {t("train.more", { n: page.data.matching - page.data.rows.length })}
              </button>
            </div>
          )}
        </section>
        <div className="flex flex-col gap-4">
          <Inspector id={selected} onClose={() => setSelected(null)} />
          <section className="panel" aria-labelledby="train-data-title">
            <div className="panel-h">
              <h3 id="train-data-title" className="text-l font-semibold">{t("train.manage")}</h3>
            </div>
            <div className="panel-b flex flex-col gap-3">
              <p className="m-0 text-s text-ink-2">{t("train.importHelp")}</p>
              <div className="row flex-wrap">
                <input
                  ref={file}
                  type="file"
                  accept=".jsonl,.json,application/json"
                  className="hidden"
                  data-testid="train-import-file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) importFile.mutate(f, { onSuccess: imported });
                  }}
                />
                <button className="btn small" disabled={importFile.isPending} onClick={() => file.current?.click()}>
                  {t("train.importFile")}
                </button>
                <button className="btn small ghost" disabled={importLegacy.isPending} data-testid="train-import-legacy" onClick={() => importLegacy.mutate(undefined, { onSuccess: (r) => (r.files?.length ? imported(r) : toasts.success(t("train.legacyNone"))) })}>
                  {t("train.importLegacy")}
                </button>
              </div>
              <div className="row">
                <button
                  className={`btn small${confirm ? " danger" : " ghost"}`}
                  data-testid="train-clear"
                  disabled={!counts?.total || clear.isPending}
                  onBlur={() => setConfirm(false)}
                  onClick={() => {
                    if (!confirm) return setConfirm(true);
                    setConfirm(false);
                    setSelected(null);
                    clear.mutate(undefined, { onSuccess: (r) => toasts.success(t("train.cleared", { n: r.deleted })) });
                  }}
                >
                  {confirm ? t("train.clearConfirm") : t("train.clear")}
                </button>
                <span className="text-xs text-ink-3">{t("train.clearHelp")}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function Counters({ counts }: { counts: TrainingCounts | undefined }) {
  const { t } = useI18n();
  const items: [keyof TrainingCounts, MessageKey][] = [
    ["total", "train.kpi.total"],
    ["correct", "train.kpi.correct"],
    ["false", "train.kpi.false"],
    ["not_sure", "train.kpi.notSure"],
    ["clipped", "train.kpi.clipped"],
    ["missed", "train.kpi.missed"],
    ["gold", "train.kpi.gold"],
    ["ai", "train.kpi.ai"],
    ["segmentation", "train.kpi.segmentation"],
    ["typo", "train.kpi.typo"],
  ];
  return (
    <div className="kpis" data-testid="train-kpis">
      {items.map(([k, key]) => (
        <span key={k} data-kpi={k}>
          <b>{counts ? counts[k] : "…"}</b>
          {t(key)}
        </span>
      ))}
    </div>
  );
}

function Row({ r, picked, onOpen }: { r: TrainingRow; picked: boolean; onOpen: () => void }) {
  const { t, lang } = useI18n();
  const from = lineage(r);
  const b = boundaryKey(r.boundary);
  return (
    <tr className={`clickable${picked ? " picked" : ""}`} data-testid="train-row" data-id={r.id} onClick={onOpen} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <td className="ar max-w-sm truncate" title={r.text}>{r.text || "—"}</td>
      <td>{r.reference ?? (r.task === "verification" ? "—" : t("train.task.tafrigh"))}</td>
      <td>
        <Answer r={r} />
        {r.ref_issue && <span className="ms-1 text-xs text-unsure" title={t("insp.refWrong")}>{t("train.refIssue")}</span>}
      </td>
      <td>{r.task === "verification" && r.ai_verdict && r.origin !== "ai" ? <span className={`vchip ${chipOf(r.ai_verdict)}`}>{t(`verdict.${chipOf(r.ai_verdict)}` as MessageKey)}</span> : "—"}</td>
      <td>{b ? t(b) : "—"}</td>
      <td>
        <div>
          {t(from.origin)}
          {from.how && <span className="text-ink-3"> ({t(from.how)})</span>}
        </div>
        {from.provider && <div className="font-mono text-xs text-ink-3" dir="ltr">{from.provider}</div>}
      </td>
      <td className="text-ink-3">{r.lecture_title ?? "—"}</td>
      <td className="font-mono text-xs text-ink-3">{formatDate(r.created_at, lang)}</td>
    </tr>
  );
}

function Answer({ r }: { r: TrainingRow }) {
  const { t } = useI18n();
  if (r.task !== "verification") {
    const a = tafrighAnswerKey(r.verdict);
    return (
      <span className="vchip none">
        {a.key ? t(a.key) : r.verdict}
        {a.level ? ` ${a.level}` : ""}
        {r.typo ? ` · ${t("train.typo")}` : ""}
        {r.gold ? ` ${t("insp.gold")}` : ""}
      </span>
    );
  }
  const chip = chipOf(r.verdict);
  return (
    <span className={`vchip ${chip}`} data-testid="train-verdict">
      {t(`verdict.${chip}` as MessageKey)}
      {r.gold ? ` ${t("insp.gold")}` : ""}
    </span>
  );
}

function Inspector({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const row = useTrainingRow(id);
  const [mode, setMode] = useState<"readable" | "raw">("readable");
  const show = (value: unknown) => (mode === "readable" ? readableJson(value) : rawJson(value));
  return (
    <aside className="panel" aria-labelledby="train-inspector-title">
      <div className="panel-h">
        <h3 id="train-inspector-title" className="text-l font-semibold">{t("train.inspector")}</h3>
        <span className="flex-1" />
        <div className="seg" role="group" aria-label={t("requests.view")}>
          <button aria-pressed={mode === "readable"} onClick={() => setMode("readable")}>{t("requests.readable")}</button>
          <button aria-pressed={mode === "raw"} onClick={() => setMode("raw")}>{t("requests.raw")}</button>
        </div>
        {row.data && <CopyButton text={() => show(row.data.row)} label={t("train.copy")} />}
        {id !== null && <button className="iconbtn" aria-label={t("card.close")} onClick={onClose}>✕</button>}
      </div>
      <div className="panel-b" data-testid="train-inspector">
        {id === null && <p className="m-0 text-ink-3">{t("train.pick")}</p>}
        {id !== null && !row.data && <p className="m-0 text-ink-3">{t("verify.loading")}</p>}
        {row.data && <pre className="code max-h-[60vh] overflow-auto" data-testid="train-json">{show(row.data.row)}</pre>}
      </div>
    </aside>
  );
}
