import { useState } from "react";
import { useI18n } from "../../shell/i18n";
import type { Job } from "./api";
import { JobsPanel } from "./JobsPanel";
import { NewLecturePanel } from "./NewLecturePanel";
import { SavedLectures } from "./SavedLectures";

export function LecturesPage() {
  const { t } = useI18n();
  const [started, setStarted] = useState<Job | null>(null);
  return (
    <>
      <h1 className="text-xl font-semibold">{t("lectures.title")}</h1>
      <NewLecturePanel onStarted={setStarted} />
      <JobsPanel extra={started} />
      <SavedLectures />
    </>
  );
}
