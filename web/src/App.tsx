import { useEffect, useState } from "react";
import { fetchHealth } from "./api/health";

export function App() {
  const [status, setStatus] = useState("checking…");

  useEffect(() => {
    fetchHealth()
      .then((h) => setStatus(h.status))
      .catch(() => setStatus("server unreachable"));
  }, []);

  return (
    <main className="p-6 text-sm text-gray-600">
      <span data-testid="health">server: {status}</span>
    </main>
  );
}
