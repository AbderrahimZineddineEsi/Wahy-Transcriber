import { useState } from "react";
import { useI18n } from "../../shell/i18n";
import { useBrowse } from "./api";

const SIZE = 25;

/** F-076: read-only browsing of the Quran (by surah) or the hadith in use (by book), with search and pages. */
export function BrowseTab({ kind }: { kind: "QURAN" | "HADITH" }) {
  const { t } = useI18n();
  const [group, setGroup] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const result = useBrowse({ kind, surah: kind === "QURAN" && group ? Number(group) : undefined, book: kind === "HADITH" ? group : undefined, q, page, size: SIZE });
  const total = result.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / SIZE));
  const groups = Object.entries(result.data?.groups ?? {});
  const first = total === 0 ? 0 : page * SIZE + 1;

  return (
    <section className="panel" aria-label={t(kind === "QURAN" ? "corp.tab.quran" : "corp.tab.hadith")}>
      <div className="panel-h flex-wrap">
        <select
          className="input !h-8 !w-auto"
          value={group}
          onChange={(e) => (setGroup(e.target.value), setPage(0))}
          aria-label={t(kind === "QURAN" ? "corp.browse.surah" : "corp.browse.book")}
          data-testid="browse-group"
        >
          <option value="">{t(kind === "QURAN" ? "corp.browse.allSurahs" : "corp.browse.allBooks")}</option>
          {groups.map(([id, [name, n]]) => (
            <option key={id} value={id}>
              {kind === "QURAN" ? `${id}. ${name}` : name} ({n.toLocaleString("en")})
            </option>
          ))}
        </select>
        <input className="input !h-8 max-w-[260px]" value={q} onChange={(e) => (setQ(e.target.value), setPage(0))} placeholder={t("corp.browse.search")} aria-label={t("corp.browse.search")} data-testid="browse-search" />
        <span className="flex-1" />
        <span className="text-s text-ink-3" data-testid="browse-range">
          {t("corp.browse.range", { from: first, to: Math.min(total, (page + 1) * SIZE), total: total.toLocaleString("en") })}
        </span>
        <button className="btn small" disabled={page === 0} onClick={() => setPage(page - 1)} data-testid="browse-prev">
          {t("corp.browse.prev")}
        </button>
        <button className="btn small" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} data-testid="browse-next">
          {t("corp.browse.next")}
        </button>
      </div>
      {result.isLoading && <p className="panel-b m-0 text-ink-3">{t("corp.browse.loading")}</p>}
      <div className="scroll-x">
        <table className="data">
          <tbody>
            {(result.data?.items ?? []).map((item) => (
              <tr key={item.id} data-testid="browse-row">
                <td className="whitespace-nowrap text-ink-2">{item.ref}</td>
                <td className="font-quran">{item.text.length > 400 ? `${item.text.slice(0, 400)}…` : item.text}</td>
              </tr>
            ))}
            {result.data && total === 0 && (
              <tr>
                <td className="text-ink-3">{t("corp.empty")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
