import { useState } from "react";
import { useI18n } from "../../shell/i18n";
import { useToasts } from "../../shell/toasts";
import { useCloneRun, useDeleteRun, useRenameRun, type RunSummary } from "./api";

type Props = {
  lectureId: number;
  runs: RunSummary[];
  runId: string | null;
  onPick: (runId: string) => void;
  onDeleted: () => void;
};

/** F-121: the lecture's saved Tafrigh runs — pick one, rename it, save it as new (review goes on in the copy while the
 *  first stays as it is), delete it. Review edits are saved by the server on every action, so there is no save
 *  button. */
export function RunBar({ lectureId, runs, runId, onPick, onDeleted }: Props) {
  const { t } = useI18n();
  const toasts = useToasts();
  const rename = useRenameRun(lectureId);
  const clone = useCloneRun(lectureId);
  const remove = useDeleteRun(lectureId);
  const current = runs.find((r) => r.run_id === runId) ?? null;
  const [naming, setNaming] = useState<null | { mode: "rename" | "clone"; name: string }>(null);
  const [confirm, setConfirm] = useState(false);

  if (naming && current) {
    const commit = () => {
      const name = naming.name.trim();
      if (!name) return setNaming(null);
      if (naming.mode === "rename") rename.mutate({ runId: current.run_id, name });
      else clone.mutate({ runId: current.run_id, name }, { onSuccess: (copy) => { onPick(copy.run_id); toasts.success(t("tfg.runs.cloned")); } });
      setNaming(null);
    };
    return (
      <form className="row" onSubmit={(e) => { e.preventDefault(); commit(); }}>
        <input className="input h-8 w-64" autoFocus aria-label={t("tfg.runs.name")} data-testid="tfg-run-name" value={naming.name} onChange={(e) => setNaming({ ...naming, name: e.target.value })} onKeyDown={(e) => e.key === "Escape" && setNaming(null)} />
        <button type="submit" className="btn small primary">{t("tfg.runs.ok")}</button>
        <button type="button" className="btn small ghost" onClick={() => setNaming(null)}>{t("modal.close")}</button>
      </form>
    );
  }
  return (
    <div className="row">
      <select className="input h-8 w-auto max-w-[22rem]" aria-label={t("tfg.runs.picker")} data-testid="tfg-run-picker" value={runId ?? ""} onChange={(e) => onPick(e.target.value)}>
        {runs.map((r) => (
          <option key={r.run_id} value={r.run_id}>
            {r.name} · {r.processing_mode === "windowed" ? t("tfg.runs.window", { n: r.window_size ?? 0 }) : t("tfg.mode.per_sentence")} · {r.model_candidate}
            {r.copied_from ? " ⎘" : ""}
          </option>
        ))}
      </select>
      {current && (
        <>
          <button className="btn small ghost" data-testid="tfg-rename" onClick={() => setNaming({ mode: "rename", name: current.name })}>{t("tfg.runs.rename")}</button>
          <button className="btn small ghost" data-testid="tfg-clone" disabled={clone.isPending} onClick={() => setNaming({ mode: "clone", name: t("tfg.runs.copyName", { name: current.name }) })}>{t("tfg.runs.saveAsNew")}</button>
          <button
            className={`btn small ghost${confirm ? " danger" : ""}`}
            data-testid="tfg-delete"
            onBlur={() => setConfirm(false)}
            onClick={() => {
              if (!confirm) return setConfirm(true);
              setConfirm(false);
              remove.mutate(current.run_id, { onSuccess: onDeleted });
            }}
          >
            {confirm ? t("tfg.runs.deleteConfirm") : t("tfg.runs.delete")}
          </button>
        </>
      )}
    </div>
  );
}
