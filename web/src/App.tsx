import { Navigate, Route, Routes } from "react-router-dom";
import { LAST_LECTURE_KEY, LecturePage } from "./features/lectures/LecturePage";
import { RequestsPage } from "./features/telemetry/RequestsPage";
import { LecturesPage } from "./features/lectures/LecturesPage";
import { readStored } from "./shell/storage";
import { ComingSoon } from "./features/placeholders/ComingSoon";
import { SettingsPage } from "./features/settings/SettingsPage";
import { TrainingPage } from "./features/training/TrainingPage";
import { Layout } from "./shell/Layout";

/** F-007: the app opens the lecture that was open last (a deleted one sends the lecture page back to the list). */
function lastLecturePath(): string {
  const id = Number(readStored(LAST_LECTURE_KEY));
  return Number.isInteger(id) && id > 0 ? `/lectures/${id}` : "/lectures";
}

/** The routes. The router itself (browser or in-memory for tests) and the providers wrap this. */
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to={lastLecturePath()} replace />} />
        <Route path="lectures" element={<LecturesPage />} />
        <Route path="lectures/:id" element={<LecturePage />} />
        <Route path="lectures/:id/:tab" element={<LecturePage />} />
        <Route path="corpora" element={<ComingSoon title="page.corpora" />} />
        <Route path="training" element={<TrainingPage />} />
        <Route path="requests" element={<RequestsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<ComingSoon title="page.notFound" />} />
      </Route>
    </Routes>
  );
}
