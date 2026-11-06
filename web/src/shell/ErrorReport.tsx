import { useState } from "react";
import { ApiError, recentRequests } from "../api/client";
import { useI18n } from "./i18n";

/** The report as Markdown to paste into a bug report. It holds no request bodies, so it holds no keys. */
export function buildReport(error: Error, now = new Date()): string {
  const lines = ["# Error report", "", `- Time: ${now.toISOString()}`, `- Summary: ${error.message}`];
  if (error instanceof ApiError) {
    lines.push(
      `- Endpoint: ${error.method} ${error.endpoint}`,
      `- Status: ${error.isNetwork ? "no answer (network)" : error.status}`,
    );
    if (error.detail) lines.push(`- Server said: ${error.detail}`);
  }
  lines.push(`- Page: ${window.location.pathname}`);
  const recent = recentRequests();
  if (recent.length) {
    lines.push("", "## Recent requests", "");
    for (const r of recent) lines.push(`- ${r.at} ${r.method} ${r.endpoint} → ${r.status || "no answer"}`);
  }
  if (error.stack) lines.push("", "## Stack", "", "```", error.stack, "```");
  return lines.join("\n");
}

export function ErrorReportDialog({ error, onClose }: { error: Error; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const report = buildReport(error);

  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      /* the text is selectable below */
    }
  }

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/40 p-4" role="presentation" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("error.report")}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-3 rounded-l border border-line bg-surface p-4 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">{t("error.report")}</h2>
          <span className="flex-1" />
          <button className="btn small" onClick={copy}>
            {copied ? t("error.copied") : t("error.copy")}
          </button>
          <button className="btn small" onClick={onClose}>
            {t("error.close")}
          </button>
        </div>
        <pre className="overflow-auto rounded-m bg-surface-2 p-3 text-start font-mono text-xs leading-relaxed whitespace-pre-wrap" dir="ltr">
          {report}
        </pre>
      </section>
    </div>
  );
}
