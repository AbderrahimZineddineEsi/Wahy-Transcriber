import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { useI18n, type MessageKey } from "../../shell/i18n";
import { writeStored } from "../../shell/storage";
import { useFindings, useLecture, useVersion, useVersions, type LectureDetail } from "./api";
import { LectureHeader, TABS, type Tab } from "./view/LectureHeader";
import { LectureView } from "./view/LectureView";
import { fromRow, fromSnapshot, type EngineFinding, type FindingRow } from "./view/model";

export const LAST_LECTURE_KEY = "wahy.last-lecture";

/** One open lecture: its header (title, tabs, version) and the open tab. Only the view tab exists so far;
 *  edit, verify, Tafrigh and export arrive in phases 15 to 19. */
export function LecturePage() {
  const params = useParams();
  const id = Number(params.id);
  const tab = (params.tab ?? "view") as Tab;
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

  if (!Number.isInteger(id) || !TABS.includes(tab)) return <Navigate to="/lectures" replace />;
  if (!lecture.data) return null;
  return <Body key={id} lecture={lecture.data} tab={tab} />;
}

type Snapshot = { engine?: string; findings?: EngineFinding[]; verdicts?: (FindingRow["verdict"] | null)[] };

function Body({ lecture, tab }: { lecture: LectureDetail; tab: Tab }) {
  const { t } = useI18n();
  const live = useFindings(lecture.id);
  const [versionId, setVersionId] = useState<number | null>(null);
  const version = useVersion(lecture.id, versionId);
  const versions = useVersions(lecture.id);
  const versionName = versions.data?.find((v) => v.id === versionId)?.name ?? "";

  const liveFindings = useMemo(() => live.data?.findings.map(fromRow), [live.data]);
  const versionFindings = useMemo(() => {
    const snap = version.data?.snapshot as Snapshot | undefined;
    return snap ? (snap.findings ?? []).map((d, i) => fromSnapshot(d, i, snap.verdicts?.[i] ?? null)) : undefined;
  }, [version.data]);
  const findings = versionId === null ? liveFindings : versionFindings;

  // "save a version" keeps the current findings as the engine gave them, with their verdicts
  const snapshot = useCallback(() => {
    const rows = live.data?.findings ?? [];
    return { engine: rows[0]?.engine ?? null, findings: rows.map((r) => r.data), verdicts: rows.map((r) => r.verdict ?? null) };
  }, [live.data]);

  return (
    <>
      <LectureHeader lecture={lecture} findings={findings} snapshot={snapshot} versionId={versionId} onVersion={setVersionId} />
      {versionId !== null && (
        <div role="status" className="row rounded-m bg-unsure-soft px-4 py-2 text-s text-unsure">
          <span>{t("version.viewing", { name: versionName })}</span>
          <button className="btn small ghost" onClick={() => setVersionId(null)}>
            {t("version.backToCurrent")}
          </button>
        </div>
      )}
      {tab !== "view" ? (
        <section className="panel">
          <div className="panel-h">
            <h2 className="text-xl font-semibold">{t(`tab.${tab}` as MessageKey)}</h2>
          </div>
          <p className="panel-b m-0 text-ink-2">
            <span>
              <b>{t("page.comingTitle")}</b> — {t("lecture.comingTab")}
            </span>
          </p>
        </section>
      ) : findings ? (
        <LectureView lecture={lecture} findings={findings} readOnly={versionId !== null} />
      ) : (
        <p className="text-ink-2">{t("lecture.loadingFindings")}</p>
      )}
    </>
  );
}
