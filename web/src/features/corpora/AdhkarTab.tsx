import { useRef, useState, type FormEvent } from "react";
import { useI18n } from "../../shell/i18n";
import { useToasts } from "../../shell/toasts";
import { useAdhkar, useAdhkarActions, useDetectionSettings, useUpdateDetectionSettings, type Dhikr } from "./api";

type Filter = "all" | "initial" | "mine";
const DEFAULT_CATEGORY = "أذكار متفرقة";

/** F-046, F-073, F-074, F-077: the adhkar are ordinary rows: add, edit or delete any of them (the 18 initial ones too). */
export function AdhkarTab() {
  const { t } = useI18n();
  const toasts = useToasts();
  const adhkar = useAdhkar();
  const actions = useAdhkarActions();
  const settings = useDetectionSettings();
  const updateSettings = useUpdateDetectionSettings();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const rows = adhkar.data ?? [];
  const mine = rows.filter((d) => d.is_custom).length;
  const shown = rows.filter((d) => (filter === "all" ? true : filter === "mine" ? d.is_custom : !d.is_custom));

  function exportJson() {
    const blob = new Blob([JSON.stringify(rows.map(({ category, ref, t }) => ({ category, ref, t })), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "wahy-adhkar.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importFile(f: File) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await f.text());
    } catch {
      return toasts.error(new Error(t("corp.adhkar.badFile")));
    }
    const items = Array.isArray(parsed) ? parsed : (parsed as { adhkar?: unknown })?.adhkar;
    if (!Array.isArray(items)) return toasts.error(new Error(t("corp.adhkar.badFile")));
    actions.import.mutate(items as Record<string, unknown>[], {
      onSuccess: (r) => toasts.success(t("corp.adhkar.imported", { added: r.added, skipped: r.skipped })),
    });
  }

  return (
    <div className="vgrid">
      <section className="panel" aria-label={t("corp.tab.adhkar")}>
        <div className="panel-h flex-wrap">
          <div className="seg" role="group" aria-label={t("corp.adhkar.filter")}>
            {(["all", "initial", "mine"] as const).map((id) => (
              <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {t(`corp.adhkar.filter.${id}`)}
                <span className="ms-1 font-mono text-xs text-ink-3">{id === "all" ? rows.length : id === "mine" ? mine : rows.length - mine}</span>
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.data?.adhkar ?? true}
              disabled={!settings.data}
              onChange={(e) => updateSettings.mutate({ adhkar: e.target.checked })}
              data-testid="adhkar-detect"
            />
            {t("corp.adhkar.detect")}
          </label>
        </div>
        {settings.data && settings.data.engine !== "v3" && (
          <p className="panel-b m-0 text-s text-unsure" role="note" data-testid="adhkar-v3-note">
            {t("corp.adhkar.v3only", { engine: settings.data.engine })}
          </p>
        )}
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th>{t("corp.adhkar.text")}</th>
                <th>{t("corp.adhkar.kind")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((d) =>
                editing === d.id ? (
                  <EditRow key={d.id} dhikr={d} onDone={() => setEditing(null)} />
                ) : (
                  <tr key={d.id} data-testid="dhikr-row">
                    <td className="font-quran">{d.t}</td>
                    <td>
                      {d.is_custom ? t("corp.adhkar.mine") : <span className="text-ink-3">{t("corp.adhkar.initial")}</span>}
                      <span className="ms-2 text-xs text-ink-3">{d.category}</span>
                    </td>
                    <td className="whitespace-nowrap">
                      <button className="btn small ghost" onClick={() => setEditing(d.id)}>
                        {t("corp.edit")}
                      </button>
                      <button className="btn small ghost danger" onClick={() => actions.remove.mutate(d.id)} aria-label={`${t("corp.delete")} ${d.t}`}>
                        {t("corp.delete")}
                      </button>
                    </td>
                  </tr>
                ),
              )}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-ink-3">
                    {t("corp.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="panel">
        <div className="panel-h">
          <h3 className="text-l font-semibold">{t("corp.adhkar.add")}</h3>
        </div>
        <div className="panel-b">
          <AddForm />
          <div className="row flex-wrap">
            <button className="btn small ghost" onClick={exportJson} disabled={!rows.length}>
              {t("corp.adhkar.export")}
            </button>
            <button className="btn small ghost" onClick={() => file.current?.click()}>
              {t("corp.adhkar.import")}
            </button>
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              hidden
              data-testid="adhkar-import"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void importFile(f);
              }}
            />
            <button
              className={`btn small${confirmReset ? " danger" : " ghost"}`}
              data-testid="adhkar-reset"
              onClick={() => {
                if (!confirmReset) return setConfirmReset(true);
                setConfirmReset(false);
                actions.reset.mutate(undefined, { onSuccess: () => toasts.success(t("corp.adhkar.resetDone")) });
              }}
              onBlur={() => setConfirmReset(false)}
            >
              {confirmReset ? t("corp.adhkar.resetConfirm") : t("corp.adhkar.reset")}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function AddForm() {
  const { t } = useI18n();
  const actions = useAdhkarActions();
  const [text, setText] = useState("");
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (words < 2) return;
    actions.add.mutate({ category: DEFAULT_CATEGORY, ref: text.trim(), t: text.trim() }, { onSuccess: () => setText("") });
  }
  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <input className="input font-quran" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("corp.adhkar.placeholder")} aria-label={t("corp.adhkar.add")} data-testid="dhikr-new" />
      <button className="btn primary self-start" type="submit" disabled={words < 2 || actions.add.isPending} data-testid="dhikr-add">
        {t("corp.add")}
      </button>
    </form>
  );
}

function EditRow({ dhikr, onDone }: { dhikr: Dhikr; onDone: () => void }) {
  const { t } = useI18n();
  const actions = useAdhkarActions();
  const [text, setText] = useState(dhikr.t);
  const [category, setCategory] = useState(dhikr.category);
  const valid = text.trim().split(/\s+/).filter(Boolean).length >= 2 && category.trim() !== "";
  return (
    <tr>
      <td>
        <input className="input font-quran" value={text} onChange={(e) => setText(e.target.value)} aria-label={t("corp.adhkar.text")} />
      </td>
      <td>
        <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t("corp.adhkar.category")} />
      </td>
      <td className="whitespace-nowrap">
        <button
          className="btn small"
          disabled={!valid || actions.update.isPending}
          onClick={() => actions.update.mutate({ id: dhikr.id, body: { category: category.trim(), ref: dhikr.ref, t: text.trim() } }, { onSuccess: onDone })}
        >
          {t("corp.save")}
        </button>
        <button className="btn small ghost" onClick={onDone}>
          {t("corp.cancel")}
        </button>
      </td>
    </tr>
  );
}
