import { Link, Navigate, useParams } from "react-router-dom";
import { useI18n, type MessageKey } from "../../shell/i18n";
import { AdhkarTab } from "./AdhkarTab";
import { useAdhkar, useCorpusInfo, useQuotes } from "./api";
import { BrowseTab } from "./BrowseTab";
import { QuotesTab } from "./QuotesTab";
import { SourcesTab } from "./SourcesTab";

const TABS = ["adhkar", "quotes", "quran", "hadith", "sources"] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, MessageKey> = {
  adhkar: "corp.tab.adhkar",
  quotes: "corp.tab.quotes",
  quran: "corp.tab.quran",
  hadith: "corp.tab.hadith",
  sources: "corp.tab.sources",
};

/** F-072: the corpora screen: adhkar, outside-corpus quotes, the Quran, the hadith, and where the hadith come from. */
export function CorporaPage() {
  const { t } = useI18n();
  const params = useParams();
  const tab = (params.tab ?? "adhkar") as Tab;
  const adhkar = useAdhkar();
  const quotes = useQuotes();
  const info = useCorpusInfo();
  if (!TABS.includes(tab)) return <Navigate to="/corpora" replace />;

  const counts: Partial<Record<Tab, number | undefined>> = {
    adhkar: adhkar.data?.length,
    quotes: quotes.data?.length,
    quran: info.data?.quran,
    hadith: info.data?.hadiths,
  };

  return (
    <>
      <h1 className="text-xl font-semibold">{t("page.corpora")}</h1>
      <nav className="tabs border-b border-line" aria-label={t("page.corpora")}>
        {TABS.map((id) => (
          <Link key={id} to={id === "adhkar" ? "/corpora" : `/corpora/${id}`} aria-current={tab === id ? "page" : undefined} data-testid={`corpora-tab-${id}`}>
            {t(LABELS[id])}
            {counts[id] !== undefined && (
              <span className="badge" data-testid={`corpora-count-${id}`}>
                {counts[id]!.toLocaleString("en")}
              </span>
            )}
          </Link>
        ))}
      </nav>
      {tab === "adhkar" && <AdhkarTab />}
      {tab === "quotes" && <QuotesTab />}
      {tab === "quran" && <BrowseTab key="QURAN" kind="QURAN" />}
      {tab === "hadith" && <BrowseTab key="HADITH" kind="HADITH" />}
      {tab === "sources" && <SourcesTab />}
    </>
  );
}
