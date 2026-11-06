import { useEffect, useState, type DragEvent } from "react";
import { useI18n, type MessageKey } from "../../shell/i18n";
import { readStored, writeStored } from "../../shell/storage";
import { useToasts } from "../../shell/toasts";
import { useCreateLecture, useTranscriptionModels, type Job, type NewLecture } from "./api";

type Source = "paste" | "file" | "youtube" | "upload" | "sample";
const SOURCES: Source[] = ["paste", "file", "youtube", "upload", "sample"];
const MODEL_KEY = "wahy.transcription-model";

/** F-016 to F-020, F-024: the title, the five ways to start a lecture, and the transcription model. */
export function NewLecturePanel({ onStarted }: { onStarted: (job: Job | null) => void }) {
  const { t } = useI18n();
  const toasts = useToasts();
  const create = useCreateLecture();
  const models = useTranscriptionModels();

  const [source, setSource] = useState<Source>("paste");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [model, setModel] = useState<string | null>(() => readStored(MODEL_KEY));
  const [fallback, setFallback] = useState(true);

  // the remembered model is only used while it is still available; otherwise the server's default
  const available = models.data?.filter((m) => m.available) ?? [];
  const chosen = available.find((m) => m.id === model)?.id ?? available.find((m) => m.default)?.id ?? null;
  useEffect(() => setFile(null), [source]);

  const asr = source === "youtube" || source === "upload";
  const ready = { paste: text.trim() !== "", file: file !== null, youtube: url.trim() !== "", upload: file !== null, sample: true }[source];

  function input(): NewLecture {
    switch (source) {
      case "paste":
        return { kind: "paste", title, text };
      case "file":
        return { kind: "file", title, file: file! };
      case "youtube":
        return { kind: "youtube", title, url, model: chosen, fallback };
      case "upload":
        return { kind: "upload", title, file: file!, model: chosen, fallback };
      case "sample":
        return { kind: "sample" };
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    create.mutate(input(), {
      onSuccess: ({ lecture, job }) => {
        toasts.success(t("lectures.created", { title: lecture.title }));
        onStarted(job);
        setText("");
        setUrl("");
        setFile(null);
        setTitle("");
      },
    });
  }

  const startLabel: MessageKey = asr ? "lectures.start.asr" : source === "sample" ? "lectures.start.sample" : `lectures.start.${source}`;
  return (
    <section className="panel" aria-labelledby="new-title">
      <div className="panel-h">
        <h3 id="new-title" className="text-l font-semibold">{t("lectures.new")}</h3>
      </div>
      <form className="panel-b" onSubmit={submit}>
        {source !== "sample" && (
          <div className="field">
            <label className="label" htmlFor="lecture-title">{t("lectures.titleField")} · {t("lectures.titleHint")}</label>
            <input id="lecture-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
        )}
        <div className="srcs" role="group" aria-label={t("lectures.new")}>
          {SOURCES.map((s) => (
            <button type="button" key={s} className="src" aria-pressed={source === s} data-source={s} onClick={() => setSource(s)}>
              <b>{t(`lectures.source.${s}` as MessageKey)}</b>
              <span>{t(`lectures.source.${s}Hint` as MessageKey)}</span>
            </button>
          ))}
        </div>

        {source === "paste" && (
          <div className="field">
            <label className="label" htmlFor="lecture-text">{t("lectures.pasteLabel")}</label>
            <textarea id="lecture-text" className="input h-auto py-2" rows={5} value={text} placeholder={t("lectures.pastePlaceholder")} onChange={(e) => setText(e.target.value)} />
          </div>
        )}
        {source === "file" && <FileDrop accept=".txt,.srt,.vtt" label={t("lectures.dropText")} file={file} onFile={setFile} id="text-file" />}
        {source === "youtube" && (
          <div className="field">
            <label className="label" htmlFor="lecture-url">{t("lectures.youtubeLabel")}</label>
            <input id="lecture-url" className="input mono" dir="ltr" type="url" value={url} placeholder="https://www.youtube.com/watch?v=…" onChange={(e) => setUrl(e.target.value)} />
          </div>
        )}
        {source === "upload" && <FileDrop accept="audio/*,video/*,.mp3,.mp4,.wav" label={t("lectures.dropMedia")} file={file} onFile={setFile} id="media-file" />}
        {source === "sample" && <p className="m-0 text-ink-2">{t("lectures.sampleText")}</p>}

        {asr && (
          <div className="row">
            <div className="field min-w-[220px] flex-1">
              <label className="label" htmlFor="asr-model">{t("lectures.model")}</label>
              <select
                id="asr-model"
                className="input"
                value={chosen ?? ""}
                onChange={(e) => {
                  setModel(e.target.value);
                  writeStored(MODEL_KEY, e.target.value);
                }}
              >
                {(models.data ?? []).map((m) => (
                  <option key={m.id} value={m.id} disabled={!m.available}>
                    {m.label}
                    {m.available ? "" : ` — ${m.reason ?? ""}`}
                  </option>
                ))}
              </select>
            </div>
            <label className="switch h-9 self-end">
              <input type="checkbox" checked={fallback} onChange={(e) => setFallback(e.target.checked)} />
              {t("lectures.fallback")}
            </label>
          </div>
        )}

        <div className="row">
          <button type="submit" className="btn primary" disabled={!ready || create.isPending}>
            {t(startLabel)}
          </button>
          <span className="text-s text-ink-3">{t("lectures.detectsAuto")}</span>
        </div>
      </form>
    </section>
  );
}

function FileDrop({ id, accept, label, file, onFile }: { id: string; accept: string; label: string; file: File | null; onFile: (f: File | null) => void }) {
  const { t } = useI18n();
  const [over, setOver] = useState(false);
  function drop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    onFile(e.dataTransfer.files[0] ?? null);
  }
  return (
    <label
      className={`drop ${over ? "over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      {label} <u>{t("lectures.chooseFile")}</u>
      <input id={id} type="file" accept={accept} className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      {file && <div className="mt-2 text-ink">{t("lectures.fileChosen", { name: file.name })}</div>}
    </label>
  );
}
