import { Navigate, Route, Routes } from "react-router-dom";
import { LAST_LECTURE_KEY, LecturePage } from "./features/lectures/LecturePage";
import { RequestsPage } from "./features/telemetry/RequestsPage";
import { LecturesPage } from "./features/lectures/LecturesPage";
import { readStored } from "./shell/storage";
import { ComingSoon } from "./features/placeholders/ComingSoon";
import { CorporaPage } from "./features/corpora/CorporaPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { TrainingPage } from "./features/training/TrainingPage";
import { Layout } from "./shell/Layout";
import { useEdition } from "./shell/edition";
import type { ReactNode } from "react";

/** F-007: the app opens the lecture that was open last (a deleted one sends the lecture page back to the list). */
function lastLecturePath(): string {
  const id = Number(readStored(LAST_LECTURE_KEY));
  return Number.isInteger(id) && id > 0 ? `/lectures/${id}` : "/lectures";
}

/** A research screen: the studio shows it, the product (tadqeeq) answers "not found". Nothing until the server
 *  says which edition it is. */
function StudioOnly({ children }: { children: ReactNode }) {
  const edition = useEdition();
  if (!edition) return null;
  return edition === "studio" ? <>{children}</> : <ComingSoon title="page.notFound" />;
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
        <Route path="corpora" element={<CorporaPage />} />
        <Route path="corpora/:tab" element={<CorporaPage />} />
        <Route path="training" element={<StudioOnly><TrainingPage /></StudioOnly>} />
        <Route path="requests" element={<StudioOnly><RequestsPage /></StudioOnly>} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<ComingSoon title="page.notFound" />} />
      </Route>
    </Routes>
  );
}
