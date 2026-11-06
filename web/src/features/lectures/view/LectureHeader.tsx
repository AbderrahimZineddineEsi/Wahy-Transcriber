import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useI18n, type MessageKey } from "../../../shell/i18n";
import { useToasts } from "../../../shell/toasts";
import { formatDate } from "../format";
import { useDeleteVersion, useRenameVersion, useSaveVersion, useVersions, type LectureDetail } from "../api";
import type { ViewFinding } from "./model";

export const TABS = ["view", "edit", "verify", "tafrigh", "export"] as const;
export type Tab = (typeof TABS)[number];

type Props = {
  lecture: LectureDetail;
  findings: readonly ViewFinding[] | undefined;
  /** the live findings' engine objects and verdicts, saved by "save a version" */
  snapshot: () => Record<string, unknown>;
  versionId: number | null;
  onVersion: (id: number | null) => void;
};

/** The open lecture's title, its tabs (they replace the old quick-jump buttons, F-042) and the lecture
 *  version picker (F-028). */
export function LectureHeader({ lecture, findings, snapshot, versionId, onVersion }: Props) {
  const { t } = useI18n();
  const checked = findings?.filter((f) => f.verdict !== "none").length ?? 0;
  const badge: Partial<Record<Tab, string>> = findings ? { view: String(findings.length), verify: `${checked}/${findings.length}` } : {};
  return (
    <div className="lechead">
      <h1>{lecture.title}</h1>
      <nav className="tabs" aria-label={t("tab.label")}>
        {TABS.map((tab) => (
          <NavLink key={tab} to={tab === "view" ? `/lectures/${lecture.id}` : `/lectures/${lecture.id}/${tab}`} end>
            {t(`tab.${tab}` as MessageKey)}
            {badge[tab] !== undefined && <span className="badge">{badge[tab]}</span>}
          </NavLink>
        ))}
      </nav>
      <VersionPicker lectureId={lecture.id} snapshot={snapshot} versionId={versionId} onVersion={onVersion} />
    </div>
  );
}

function VersionPicker({ lectureId, snapshot, versionId, onVersion }: { lectureId: number } & Pick<Props, "snapshot" | "versionId" | "onVersion">) {
  const { t, lang } = useI18n();
  const toasts = useToasts();
  const versions = useVersions(lectureId);
  const save = useSaveVersion(lectureId);
  const rename = useRenameVersion(lectureId);
  const remove = useDeleteVersion(lectureId);
  const [naming, setNaming] = useState<null | { mode: "save" | "rename"; name: string }>(null);
  const list = [...(versions.data ?? [])].reverse(); // newest first
  const open = list.find((v) => v.id === versionId) ?? null;

  if (naming) {
    const commit = () => {
      const name = naming.name.trim() || t("version.defaultName");
      if (naming.mode === "save") {
        save.mutate({ name, snapshot: snapshot() }, { onSuccess: () => toasts.success(t("version.saved")) });
      } else if (open) {
        rename.mutate({ versionId: open.id, name });
      }
      setNaming(null);
    };
    return (
      <form
        className="row ms-auto pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          commit();
        }}
      >
        <input
          className="input h-8 w-56"
          aria-label={t("version.name")}
          autoFocus
          value={naming.name}
          onChange={(e) => setNaming({ ...naming, name: e.target.value })}
          onKeyDown={(e) => e.key === "Escape" && setNaming(null)}
        />
        <button type="submit" className="btn small primary">
          {t("version.ok")}
        </button>
        <button type="button" className="btn small ghost" onClick={() => setNaming(null)}>
          {t("version.cancel")}
        </button>
      </form>
    );
  }

  return (
    <div className="row ms-auto gap-2 pb-2">
      <label className="label" htmlFor="version-select">
        {t("version.label")}
      </label>
      <select
        id="version-select"
        className="input h-8 w-auto max-w-72"
        value={versionId ?? ""}
        onChange={(e) => onVersion(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{t("version.current")}</option>
        {list.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name} · {formatDate(v.created_at, lang)}
          </option>
        ))}
      </select>
      {open ? (
        <>
          <button className="btn small ghost" onClick={() => setNaming({ mode: "rename", name: open.name })}>
            {t("version.rename")}
          </button>
          <button
            className="btn small ghost danger"
            disabled={list.length <= 1}
            onClick={() =>
              remove.mutate(open.id, {
                onSuccess: () => {
                  onVersion(null);
                  toasts.success(t("version.deleted"));
                },
              })
            }
          >
            {t("version.delete")}
          </button>
        </>
      ) : (
        <button className="btn small ghost" onClick={() => setNaming({ mode: "save", name: "" })}>
          {t("version.save")}
        </button>
      )}
    </div>
  );
}
