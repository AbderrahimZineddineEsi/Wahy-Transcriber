import type { ComponentType } from "react";
import { Link, NavLink, Outlet, useMatch } from "react-router-dom";
import { useHealth } from "../api/health";
import { JobWatcher } from "../features/lectures/JobWatcher";
import { LAST_LECTURE_KEY } from "../features/lectures/LecturePage";
import { CorporaIcon, LectureIcon, LecturesIcon, RequestsIcon, SettingsIcon, ThemeIcon, TrainingIcon } from "./icons";
import { useI18n, type MessageKey } from "./i18n";
import { readStored } from "./storage";
import { useTheme } from "./theme";

type Place = { to: string; label: MessageKey; icon: ComponentType; badge?: number };

// The app's places (docs/rewrite/mockups). "The open lecture" is the last lecture opened (phase 12); the count
// badges (F-001) arrive with the screens that own the counts.
const PLACES: Place[] = [
  { to: "/corpora", label: "nav.corpora", icon: CorporaIcon },
  { to: "/training", label: "nav.training", icon: TrainingIcon },
  { to: "/requests", label: "nav.requests", icon: RequestsIcon },
];

export function Layout() {
  return (
    <div className="grid min-h-screen grid-rows-[var(--spacing-header)_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-30 focus:bg-surface focus:p-2">
        <SkipText />
      </a>
      <JobWatcher />
      <Header />
      <div className="grid grid-cols-[var(--spacing-rail)_1fr] max-[720px]:grid-cols-1">
        <Rail />
        <main id="main" className="min-w-0 px-4 pt-6 pb-12">
          <CorpusBanner />
          <div className="mx-auto flex max-w-[1440px] flex-col gap-4">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function SkipText() {
  return <>{useI18n().t("app.skip")}</>;
}

function Header() {
  const { t, lang, setLang } = useI18n();
  const theme = useTheme();
  const health = useHealth();
  const jobs = health.data?.running_jobs ?? 0;
  return (
    <header className="sticky top-0 z-[5] flex items-center gap-3 border-b border-line bg-surface px-4">
      <Link to="/lectures" className="flex items-center gap-2 font-quran text-[1.35rem] font-bold whitespace-nowrap">
        <span className="grid size-[26px] place-items-center rounded-[7px] bg-accent text-base leading-none text-accent-ink">
          و
        </span>
        {t("app.name")}
      </Link>
      <span className="flex-1" />
      <ServerBadge />
      {jobs > 0 && (
        <span className="inline-flex h-[30px] items-center gap-2 rounded-full bg-accent-soft px-3 text-s whitespace-nowrap text-accent" title={t("header.jobs", { n: jobs })}>
          <i className="size-2 animate-pulse rounded-full bg-accent" />
          <span className="font-mono">{jobs}</span>
        </span>
      )}
      <button className="iconbtn" aria-label={t("header.language")} title={t("header.language")} onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
        {t("header.languageSwitchTo")}
      </button>
      <button className="iconbtn" aria-label={t("header.theme")} title={t("header.theme")} onClick={theme.toggle}>
        <ThemeIcon />
      </button>
    </header>
  );
}

/** F-004: whether the server answers. The details (GPU, keys) are on the settings screen. */
function ServerBadge() {
  const { t } = useI18n();
  const health = useHealth();
  const state = health.isError ? "bad" : health.data ? "ok" : "checking";
  const text = { bad: t("server.unreachable"), ok: t("server.connected"), checking: t("server.checking") }[state];
  const color = { bad: "text-bad", ok: "text-ok", checking: "text-ink-3" }[state];
  return (
    <span data-testid="server-badge" data-state={state} className={`inline-flex items-center gap-2 text-s ${color}`} title={state === "bad" ? t("server.unreachableHelp") : undefined}>
      <i className="size-2 rounded-full bg-current" />
      <span className="max-[720px]:hidden">{text}</span>
    </span>
  );
}

function Rail() {
  const { t } = useI18n();
  // the lecture on screen, or else the last one opened (read again on every navigation, since useMatch re-renders)
  const open = useMatch("/lectures/:id/*")?.params.id;
  const last = Number(open ?? readStored(LAST_LECTURE_KEY));
  return (
    <nav aria-label={t("nav.label")} className="flex flex-col gap-0.5 border-line bg-surface px-2 py-3 max-[720px]:flex-row max-[720px]:overflow-x-auto max-[720px]:border-b max-[720px]:p-1 min-[721px]:border-e">
      <RailLink place={{ to: "/lectures", label: "nav.lectures", icon: LecturesIcon }} end />
      {Number.isInteger(last) && last > 0 && <RailLink place={{ to: `/lectures/${last}`, label: "nav.lecture", icon: LectureIcon }} />}
      <span className="mx-1.5 my-2 h-px bg-line max-[720px]:hidden" />
      {PLACES.map((place) => (
        <RailLink key={place.to} place={place} />
      ))}
      <span className="flex-1" />
      <RailLink place={{ to: "/settings", label: "nav.settings", icon: SettingsIcon }} />
    </nav>
  );
}

function RailLink({ place, end }: { place: Place; end?: boolean }) {
  const { t } = useI18n();
  const Icon = place.icon;
  return (
    <NavLink
      to={place.to}
      end={end}
      className={({ isActive }) =>
        `relative flex flex-none flex-col items-center gap-0.5 rounded-m px-1 py-2.5 text-xs max-[720px]:min-w-16 ${isActive ? "bg-accent-soft font-semibold text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`
      }
    >
      <Icon />
      <span className="text-center leading-tight">{t(place.label)}</span>
      {place.badge !== undefined && (
        <span className="absolute top-1 ms-5 start-1/2 inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-ink px-1 font-mono text-[10.5px] text-surface">
          {place.badge}
        </span>
      )}
    </NavLink>
  );
}

/** F-006: shown only while the corpus is missing. */
function CorpusBanner() {
  const { t } = useI18n();
  const health = useHealth();
  if (!health.data || health.data.corpus.ready) return null;
  return (
    <div role="status" className="mx-auto mb-4 flex max-w-[1440px] flex-wrap items-center gap-3 rounded-m bg-unsure-soft px-4 py-2.5 text-s text-unsure">
      <span>{t("corpus.notReady")}</span>
      <Link to="/corpora" className="font-semibold underline">
        {t("corpus.open")}
      </Link>
    </div>
  );
}
