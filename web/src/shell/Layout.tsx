import type { ComponentType } from "react";
import { Link, NavLink, Outlet, useMatch } from "react-router-dom";
import { useHealth } from "../api/health";
import { JobWatcher } from "../features/lectures/JobWatcher";
import { LAST_LECTURE_KEY } from "../features/lectures/LecturePage";
import { UndoButton } from "../features/editing/UndoButton";
import { CorporaIcon, LectureIcon, LecturesIcon, RequestsIcon, SettingsIcon, ThemeIcon, TrainingIcon } from "./icons";
import { useI18n, type MessageKey } from "./i18n";
import { useRailBadges } from "./badges";
import { readStored } from "./storage";
import { useTheme } from "./theme";
import { useEdition, useEditionSync, useStudio } from "./edition";

type Place = { to: string; label: MessageKey; icon: ComponentType; badge?: number };

// The app's places. "The open lecture" is the last lecture opened (phase 12). Each place with a count shows it as a
// badge (F-001). The research places are the studio's only (docs/editions.md).
const PLACES: (Omit<Place, "badge"> & { count: "corpora" | "training" | "requests"; studio?: true })[] = [
  { to: "/corpora", label: "nav.corpora", icon: CorporaIcon, count: "corpora" },
  { to: "/training", label: "nav.training", icon: TrainingIcon, count: "training", studio: true },
  { to: "/requests", label: "nav.requests", icon: RequestsIcon, count: "requests", studio: true },
];

/** The frame of every screen: one header bar (the name, the places, the server dot, undo, language, theme) and the
 *  screen under it, centred. */
export function Layout() {
  useEditionSync();
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-30 focus:bg-surface focus:p-2">
        <SkipText />
      </a>
      <JobWatcher />
      <Header />
      <main id="main" className="min-w-0 px-6 pt-6 pb-16 max-[720px]:px-4">
        <CorpusBanner />
        <div className="mx-auto flex max-w-[1440px] flex-col gap-5">
          <Outlet />
        </div>
      </main>
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
  const edition = useEdition();
  const jobs = health.data?.running_jobs ?? 0;
  return (
    <header className="appbar">
      <Link to="/lectures" className="brand" aria-label={edition ? t("app.name") : undefined}>
        <span className="brand-mark" aria-hidden="true">
          {edition ? "ت" : ""}
        </span>
        <span className="brand-name">{edition && t("app.name")}</span>
      </Link>
      <Places />
      <div className="appbar-tools">
        <ServerBadge />
        {jobs > 0 && (
          <span className="inline-flex h-[30px] items-center gap-2 rounded-full bg-accent-soft px-3 text-s whitespace-nowrap text-accent" title={t("header.jobs", { n: jobs })}>
            <i className="size-2 animate-pulse rounded-full bg-current" />
            <span className="font-mono">{jobs}</span>
          </span>
        )}
        <UndoButton />
        <button className="iconbtn" aria-label={t("header.language")} title={t("header.language")} onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
          {t("header.languageSwitchTo")}
        </button>
        <button className="iconbtn" aria-label={t("header.theme")} title={t("header.theme")} onClick={theme.toggle}>
          <ThemeIcon />
        </button>
      </div>
    </header>
  );
}

/** F-004: whether the server answers. A quiet dot while all is well (the words are there for screen readers); the
 *  words show only when something is wrong. The details (GPU, keys) are on the settings screen. */
function ServerBadge() {
  const { t } = useI18n();
  const health = useHealth();
  const state = health.isError ? "bad" : health.data ? "ok" : "checking";
  const text = { bad: t("server.unreachable"), ok: t("server.connected"), checking: t("server.checking") }[state];
  const color = { bad: "text-bad", ok: "text-ok", checking: "text-ink-3" }[state];
  return (
    <span data-testid="server-badge" data-state={state} className={`inline-flex items-center gap-2 px-1 text-s ${color}`} title={state === "bad" ? t("server.unreachableHelp") : text}>
      <i className="size-2 rounded-full bg-current" />
      <span className={state === "bad" ? "max-[720px]:sr-only" : "sr-only"}>{text}</span>
    </span>
  );
}

function Places() {
  const { t } = useI18n();
  // the lecture on screen, or else the last one opened (read again on every navigation, since useMatch re-renders)
  const open = useMatch("/lectures/:id/*")?.params.id;
  const last = Number(open ?? readStored(LAST_LECTURE_KEY));
  const hasLast = Number.isInteger(last) && last > 0;
  const studio = useStudio();
  const badges = useRailBadges(hasLast ? last : null, studio);
  return (
    <nav aria-label={t("nav.label")} className="places">
      <PlaceLink place={{ to: "/lectures", label: "nav.lectures", icon: LecturesIcon }} end />
      {hasLast && <PlaceLink place={{ to: `/lectures/${last}`, label: "nav.lecture", icon: LectureIcon, badge: badges.lecture }} />}
      {PLACES.filter((place) => studio || !place.studio).map((place) => (
        <PlaceLink key={place.to} place={{ ...place, badge: badges[place.count] }} />
      ))}
      <PlaceLink place={{ to: "/settings", label: "nav.settings", icon: SettingsIcon }} />
    </nav>
  );
}

function PlaceLink({ place, end }: { place: Place; end?: boolean }) {
  const { t } = useI18n();
  const Icon = place.icon;
  return (
    <NavLink to={place.to} end={end} className="place">
      <Icon />
      <span>{t(place.label)}</span>
      {place.badge !== undefined && (
        <span data-testid={`rail-badge-${place.label.slice(4)}`} className="badge">
          {place.badge.toLocaleString("en")}
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
