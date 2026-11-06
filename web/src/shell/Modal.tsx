import { useEffect, type ReactNode } from "react";
import { useI18n } from "./i18n";

type Props = { title: string; onClose: () => void; actions?: ReactNode; children: ReactNode; wide?: boolean };

/** A dialog over the page: Escape or a click outside closes it. */
export function Modal({ title, onClose, actions, children, wide }: Props) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/40 p-4" role="presentation" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[85vh] w-full flex-col gap-3 rounded-l border border-line bg-surface p-4 shadow-pop ${wide ? "max-w-4xl" : "max-w-2xl"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">{title}</h2>
          <span className="flex-1" />
          {actions}
          <button className="btn small" onClick={onClose}>
            {t("modal.close")}
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">{children}</div>
      </section>
    </div>
  );
}
