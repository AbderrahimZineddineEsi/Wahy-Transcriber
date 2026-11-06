import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n, type MessageKey } from "../../shell/i18n";
import { useToasts } from "../../shell/toasts";
import { useDeleteAllLectures, useDeleteLecture, useLectures, useRenameLecture, type Lecture } from "./api";
import { formatDate } from "./format";

/** F-027: every lecture, with open, rename, delete and delete all. */
export function SavedLectures() {
  const { t } = useI18n();
  const lectures = useLectures();
  const deleteAll = useDeleteAllLectures();
  const toasts = useToasts();
  const [query, setQuery] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);

  const rows = (lectures.data ?? []).filter((l) => l.title.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <section className="panel" aria-labelledby="saved-title">
      <div className="panel-h">
        <h3 id="saved-title" className="text-l font-semibold">{t("lectures.saved")}</h3>
        <span className="flex-1" />
        <input className="input !h-8 !w-[200px]" aria-label={t("lectures.search")} placeholder={t("lectures.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        {(lectures.data?.length ?? 0) > 0 && (
          <button
            className="btn small danger"
            onClick={() => {
              if (!confirmAll) return setConfirmAll(true);
              deleteAll.mutate(undefined, { onSuccess: () => toasts.success(t("lectures.deleted")) });
              setConfirmAll(false);
            }}
            onBlur={() => setConfirmAll(false)}
          >
            {confirmAll ? t("lectures.deleteAllConfirm") : t("lectures.deleteAll")}
          </button>
        )}
      </div>
      {lectures.data && lectures.data.length === 0 ? (
        <p className="panel-b m-0 text-ink-2">{t("lectures.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>{t("lectures.col.title")}</th>
                <th>{t("lectures.col.source")}</th>
                <th>{t("lectures.col.words")}</th>
                <th>{t("lectures.col.versions")}</th>
                <th>{t("lectures.col.updated")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((lecture) => (
                <Row key={lecture.id} lecture={lecture} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Row({ lecture }: { lecture: Lecture }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const rename = useRenameLecture();
  const remove = useDeleteLecture();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(lecture.title);
  const [confirm, setConfirm] = useState(false);

  const open = () => navigate(`/lectures/${lecture.id}`);
  const kind = `lectures.kind.${lecture.source_kind}` as MessageKey;

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim() && title.trim() !== lecture.title) rename.mutate({ id: lecture.id, title: title.trim() });
    setEditing(false);
  }

  return (
    <tr className="clickable" data-testid="lecture-row" onClick={(e) => !(e.target as HTMLElement).closest("button, form") && open()}>
      <td>
        {editing ? (
          <form className="row" onSubmit={save}>
            <input autoFocus className="input !h-8" aria-label={t("lectures.renameLabel")} value={title} onChange={(e) => setTitle(e.target.value)} />
            <button className="btn small primary" type="submit">{t("lectures.renameSave")}</button>
            <button className="btn small ghost" type="button" onClick={() => { setEditing(false); setTitle(lecture.title); }}>{t("lectures.renameCancel")}</button>
          </form>
        ) : (
          <button className="bg-transparent p-0 text-start font-bold" onClick={open}>{lecture.title}</button>
        )}
      </td>
      <td>{t(kind)}</td>
      <td className="mono">{lecture.word_count}</td>
      <td className="mono">{lecture.version_count}</td>
      <td className="text-ink-3">{formatDate(lecture.updated_at, lang)}</td>
      <td className="whitespace-nowrap">
        <button className="btn small ghost" onClick={() => setEditing(true)}>{t("lectures.rename")}</button>
        <button
          className="btn small ghost danger"
          onClick={() => (confirm ? remove.mutate(lecture.id) : setConfirm(true))}
          onBlur={() => setConfirm(false)}
        >
          {confirm ? t("lectures.deleteConfirm") : t("lectures.delete")}
        </button>
      </td>
    </tr>
  );
}
