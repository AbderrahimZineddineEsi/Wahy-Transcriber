import { Navigate, Route, Routes } from "react-router-dom";
import { ComingSoon } from "./features/placeholders/ComingSoon";
import { SettingsPage } from "./features/settings/SettingsPage";
import { Layout } from "./shell/Layout";

/** The routes. The router itself (browser or in-memory for tests) and the providers wrap this. */
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/lectures" replace />} />
        <Route path="lectures" element={<ComingSoon title="page.lectures" />} />
        <Route path="corpora" element={<ComingSoon title="page.corpora" />} />
        <Route path="training" element={<ComingSoon title="page.training" />} />
        <Route path="requests" element={<ComingSoon title="page.requests" />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<ComingSoon title="page.notFound" />} />
      </Route>
    </Routes>
  );
}
