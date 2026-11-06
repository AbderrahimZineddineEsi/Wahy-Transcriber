import { useEffect } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { useI18n } from "../../shell/i18n";
import { writeStored } from "../../shell/storage";
import { useToasts } from "../../shell/toasts";
import { useAttachMedia, useFindings, useLecture, type LectureDetail } from "./api";

export const LAST_LECTURE_KEY = "wahy.last-lecture";

/** A plain view of one lecture: its transcript and the quotes found. The real lecture screen (video, word
 *  highlighting, verdicts) is phase 12 and replaces this page. */
export function LecturePage() {
  const id = Number(useParams().id);
  const lecture = useLecture(id);
  const navigate = useNavigate();

  useEffect(() => {
    if (lecture.data) writeStored(LAST_LECTURE_KEY, String(id)); // F-007: the app reopens this one
  }, [lecture.data, id]);
  useEffect(() => {
    if (lecture.error instanceof ApiError && lecture.error.status === 404) {
      writeStored(LAST_LECTURE_KEY, null);
      navigate("/lectures", { replace: true });
    }
  }, [lecture.error, navigate]);

  if (!Number.isInteger(id)) return <Navigate to="/lectures" replace />;
  if (!lecture.data) return null;
  return <Body lecture={lecture.data} />;
}

function Body({ lecture }: { lecture: LectureDetail }) {
  const { t } = useI18n();
  const toasts = useToasts();
  const findings = useFindings(lecture.id);
  const attach = useAttachMedia(lecture.id);
  return (
    <>
      <div className="row">
        <Link to="/lectures" className="text-accent underline">{t("lecture.back")}</Link>
        <h1 className="text-xl font-semibold">{lecture.title}</h1>
        <span className="mono text-s text-ink-3">{t("lecture.words", { n: lecture.word_count })}</span>
        <span className={`vchip ${lecture.has_media ? "ok" : "none"}`}>{lecture.has_media ? t("lecture.hasMedia") : t("lecture.noMedia")}</span>
        <span className="flex-1" />
        <label className="btn small cursor-pointer">
          {t("lecture.attach")}
          <input
            type="file"
            accept="audio/*,video/*,.mp3,.mp4,.wav"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) attach.mutate(file, { onSuccess: () => toasts.success(t("lecture.attached")) });
            }}
          />
        </label>
      </div>
      <p className="m-0 text-s text-ink-3">{t("lecture.previewNote")}</p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-start gap-3">
        <section className="panel" aria-labelledby="tr-title">
          <div className="panel-h"><h3 id="tr-title" className="text-l font-semibold">{t("lecture.transcript")}</h3></div>
          <p className="panel-b m-0 font-read leading-loose" data-testid="transcript">{lecture.words.map((w) => w.text).join(" ")}</p>
        </section>
        <section className="panel" aria-labelledby="fi-title">
          <div className="panel-h">
            <h3 id="fi-title" className="text-l font-semibold">{t("lecture.findings")}</h3>
            <span className="mono text-s text-ink-3">{findings.data?.count ?? ""}</span>
          </div>
          <ul className="panel-b m-0 list-none p-4" data-testid="findings">
            {findings.data?.findings.length === 0 && <li className="text-ink-2">{t("lecture.noFindings")}</li>}
            {findings.data?.findings.map((f) => (
              <li key={f.id} className="row" data-kind={f.source_type}>
                <span className="vchip none">{f.source_type}</span>
                <span>{f.display_ref}</span>
                <span className="mono text-xs text-ink-3">{f.word_start}–{f.word_end}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
