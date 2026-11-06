import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "./i18n";
import { ErrorReportDialog } from "./ErrorReport";

type Toast = { id: number; kind: "success" | "error"; message: string; error?: Error };

type Toasts = {
  success: (message: string) => void;
  /** Shows the message with a "details" button that opens the error report. */
  error: (error: Error) => void;
};

const Context = createContext<Toasts | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [report, setReport] = useState<Error | null>(null);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (toast: Omit<Toast, "id">, ms: number) => {
      const id = nextId++;
      setToasts((all) => [...all.slice(-3), { ...toast, id }]);
      setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  const api = useMemo<Toasts>(
    () => ({
      success: (message) => push({ kind: "success", message }, 4000),
      error: (error) => push({ kind: "error", message: error.message, error }, 10000),
    }),
    [push],
  );

  return (
    <Context.Provider value={api}>
      {children}
      <div
        className="fixed bottom-4 start-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2 rtl:translate-x-1/2"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.kind === "error" ? "alert" : "status"}
            className="flex items-center gap-3 rounded-m bg-ink px-4 py-2.5 text-s text-surface shadow-pop"
          >
            <span className={toast.kind === "error" ? "font-medium" : ""}>{toast.message}</span>
            {toast.error && (
              <button className="font-semibold text-accent-soft underline" onClick={() => setReport(toast.error!)}>
                {t("error.details")}
              </button>
            )}
            <button aria-label={t("toast.dismiss")} className="text-accent-soft" onClick={() => dismiss(toast.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
      {report && <ErrorReportDialog error={report} onClose={() => setReport(null)} />}
    </Context.Provider>
  );
}

export function useToasts(): Toasts {
  const value = useContext(Context);
  if (!value) throw new Error("useToasts needs <ToastProvider>");
  return value;
}
