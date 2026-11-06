import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useI18n, type MessageKey } from "../../shell/i18n";
import { useStoredState } from "../../shell/storage";
import { useToasts } from "../../shell/toasts";
import type { LectureDetail } from "../lectures/api";
import type { Kind } from "../lectures/view/model";
import { DEFAULT_STYLE, exportUrl, useExportStyle, useExportText, useUpdateStyle, type ExportFormat, type ExportQuery, type ExportStyle, type VerdictShown } from "./api";

const CAPTIONS: ExportFormat[] = ["srt", "vtt", "ass"];
const TEXTS: ExportFormat[] = ["html", "md", "txt", "json"];
const FORMATS = [...CAPTIONS, ...TEXTS];
const KINDS: ("all" | Kind)[] = ["all", "quran", "hadith", "dhikr"];

/** Bracket pairs offered for each kind (the saved style may hold any other pair too). */
const PAIRS: [string, string][] = [
  ["﴿", "﴾"],
  ["«", "»"],
  ["〖", "〗"],
  ["(", ")"],
  ['"', '"'],
  ["[", "]"],
  ["{", "}"],
];
type BracketKind = "quran" | "hadith" | "adhkar";
const OPEN: Record<BracketKind, keyof ExportStyle> = { quran: "quranBracketOpen", hadith: "hadithBracketOpen", adhkar: "adhkarBracketOpen" };
const CLOSE: Record<BracketKind, keyof ExportStyle> = { quran: "quranBracketClose", hadith: "hadithBracketClose", adhkar: "adhkarBracketClose" };

/** The lecture's "export" tab: a preview of the chosen file beside its settings. The files come from the server, so
 *  the preview is exactly what is downloaded. */
export function ExportPage({ lecture }: { lecture: LectureDetail }) {
  const { t } = useI18n();
  const toasts = useToasts();
  const queryClient = useQueryClient();
  const style = useExportStyle().data ?? DEFAULT_STYLE;
  const update = useUpdateStyle();
  const [format, setFormat] = useStoredState<ExportFormat>("wahy.export.format", "srt", FORMATS);
  const [script, setScript] = useStoredState<"spoken" | "standard">("wahy.view.script", "spoken", ["spoken", "standard"]);
  const [hide, setHide] = useStoredState("wahy.export.hideFalse", "on", ["on", "off"]);
  const [kind, setKind] = useStoredState<"all" | Kind>("wahy.export.kind", "all", KINDS);
  const query: ExportQuery = useMemo(
    () => ({ script, kind, show: (hide === "on" ? ["CORRECT", "NOT_SURE", "NONE"] : []) as VerdictShown[] }),
    [script, kind, hide],
  );
  const text = useExportText(lecture.id, format, query, JSON.stringify(style));
  const url = exportUrl(lecture.id, format, query);
  const patch = (p: Partial<ExportStyle>) => update.mutate(p, { onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["export-text"] }) });

  const print = async () => {
    // the HTML export opened in a new window, then the browser's print dialog (save as PDF from there)
    const win = window.open("", "_blank");
    if (!win) return toasts.error(new Error(t("export.popupBlocked")));
    const response = await globalThis.fetch(new Request(new URL(exportUrl(lecture.id, "html", query), window.location.origin)));
    win.document.write(await response.text());
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="vgrid">
      <section className="panel min-w-0">
        <div className="panel-h">
          <h3 className="font-semibold">{t("export.preview")}</h3>
          <span className="flex-1" />
          <span className="mono text-s text-ink-3">{t(`export.file.${format}` as MessageKey)}</span>
        </div>
        <div className="panel-b">
          <pre className="code wrap max-h-[70vh]" style={{ unicodeBidi: "plaintext", textAlign: "start" }} data-testid="export-preview">
            {text.data ?? (text.isError ? t("export.previewFailed") : t("export.loading"))}
          </pre>
        </div>
      </section>
      <aside className="panel">
        <div className="panel-h">
          <h3 className="font-semibold">{t("export.title")}</h3>
        </div>
        <div className="panel-b flex flex-col gap-3">
          <div className="field">
            <span className="label">{t("export.captions")}</span>
            <div className="seg" role="group" aria-label={t("export.captions")}>
              {CAPTIONS.map((f) => (
                <button key={f} aria-pressed={format === f} onClick={() => setFormat(f)}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="label">{t("export.text")}</span>
            <div className="seg" role="group" aria-label={t("export.text")}>
              {TEXTS.map((f) => (
                <button key={f} aria-pressed={format === f} onClick={() => setFormat(f)}>
                  {t(`export.format.${f}` as MessageKey)}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <a className="btn primary" href={url} download data-testid="download">
              {t("export.download")}
            </a>
            <button className="btn" onClick={() => void print()}>
              {t("export.print")}
            </button>
          </div>

          <h4 className="m-0 mt-2 text-s font-semibold text-ink-2">{t("export.what")}</h4>
          <label className="switch">
            <input type="checkbox" checked={hide === "on"} onChange={(e) => setHide(e.target.checked ? "on" : "off")} />
            {t("export.hideFalse")}
          </label>
          <label className="switch">
            <input type="checkbox" checked={script === "standard"} onChange={(e) => setScript(e.target.checked ? "standard" : "spoken")} />
            {t("view.script")}
          </label>
          <label className="field">
            <span className="label">{t("kind.label")}</span>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as "all" | Kind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>

          <h4 className="m-0 mt-2 text-s font-semibold text-ink-2">{t("export.style")}</h4>
          <div className="grid2">
            {(["quran", "hadith", "adhkar"] as BracketKind[]).map((k) => {
              const current: [string, string] = [String(style[OPEN[k]]), String(style[CLOSE[k]])];
              const pairs = PAIRS.some(([o, c]) => o === current[0] && c === current[1]) ? PAIRS : [current, ...PAIRS];
              return (
                <label key={k} className="field">
                  <span className="label">{t(`export.brackets.${k}` as MessageKey)}</span>
                  <select
                    className="input"
                    value={current.join(" … ")}
                    onChange={(e) => {
                      const [o, c] = e.target.value.split(" … ");
                      patch({ [OPEN[k]]: o, [CLOSE[k]]: c } as Partial<ExportStyle>);
                    }}
                  >
                    {pairs.map((p) => (
                      <option key={p.join(" … ")} value={p.join(" … ")}>
                        {p.join(" … ")}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
          <label className="switch">
            <input type="checkbox" checked={style.groupContiguousAyat} onChange={(e) => patch({ groupContiguousAyat: e.target.checked })} />
            {t("export.group")}
          </label>
          <label className="switch">
            <input type="checkbox" checked={style.splitCommentary} onChange={(e) => patch({ splitCommentary: e.target.checked })} />
            {t("export.split")}
          </label>
          <span className="text-xs text-ink-3">{t("export.screenOnly")}</span>
          <label className="switch">
            <input type="checkbox" checked={style.showQuranSource} onChange={(e) => patch({ showQuranSource: e.target.checked })} />
            {t("export.showQuran")}
          </label>
          <label className="switch">
            <input type="checkbox" checked={style.showHadithSource} onChange={(e) => patch({ showHadithSource: e.target.checked })} />
            {t("export.showHadith")}
          </label>
          <label className="switch">
            <input type="checkbox" checked={style.showAdhkarTag} onChange={(e) => patch({ showAdhkarTag: e.target.checked })} />
            {t("export.showAdhkar")}
          </label>
        </div>
      </aside>
    </div>
  );
}
