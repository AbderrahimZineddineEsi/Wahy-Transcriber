import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { fakeServer, healthy, renderApp } from "./test/render";

test("opens on the lectures place, in Arabic and right to left", async () => {
  fakeServer();
  renderApp("/");
  expect(await screen.findByRole("heading", { name: "المحاضرات" })).toBeInTheDocument();
  expect(document.documentElement).toHaveAttribute("dir", "rtl");
  expect(document.documentElement).toHaveAttribute("lang", "ar");
  const nav = screen.getByRole("navigation", { name: "التنقل" });
  for (const name of ["المحاضرات", "المصادر", "بيانات التدريب", "سجل الطلبات", "الإعدادات"])
    expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
  expect(await screen.findByText("الخادم متصل")).toBeInTheDocument();
});

test("navigation changes the screen", async () => {
  fakeServer();
  renderApp("/lectures");
  await userEvent.click(screen.getByRole("link", { name: "الإعدادات" }));
  expect(await screen.findByRole("heading", { name: "مفاتيح الخدمات" })).toBeInTheDocument();
});

test("switching the language flips the direction, translates the menus and is remembered", async () => {
  fakeServer();
  const first = renderApp("/lectures");
  await userEvent.click(screen.getByRole("button", { name: "اللغة" }));
  expect(document.documentElement).toHaveAttribute("dir", "ltr");
  expect(document.documentElement).toHaveAttribute("lang", "en");
  expect(within(screen.getByRole("navigation", { name: "Navigation" })).getByRole("link", { name: "Settings" })).toBeInTheDocument();
  first.unmount();
  renderApp("/lectures"); // a later visit
  expect(document.documentElement).toHaveAttribute("dir", "ltr");
  expect(screen.getByRole("link", { name: "Lectures" })).toBeInTheDocument();
});

test("the theme toggle sets data-theme and is remembered", async () => {
  fakeServer();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  const first = renderApp("/lectures");
  expect(document.documentElement).not.toHaveAttribute("data-theme"); // follows the system
  await userEvent.click(screen.getByRole("button", { name: "المظهر: فاتح أو داكن" }));
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  await userEvent.click(screen.getByRole("button", { name: "المظهر: فاتح أو داكن" }));
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
  first.unmount();
  document.documentElement.removeAttribute("data-theme");
  renderApp("/lectures");
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
});

test("an unreachable server is shown in the header", async () => {
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  renderApp("/lectures");
  await waitFor(() => expect(screen.getByTestId("server-badge")).toHaveAttribute("data-state", "bad"));
  expect(screen.getByText("تعذّر الوصول إلى الخادم")).toBeInTheDocument();
});

test("a missing corpus is announced with a link to the sources", async () => {
  fakeServer(() => undefined, () => ({ ...healthy, corpus: { ready: false, hadith_source: "sunnah" } }));
  renderApp("/lectures");
  const banner = await screen.findByRole("status");
  expect(banner).toHaveTextContent("لم يُجهَّز");
  expect(within(banner).getByRole("link", { name: "افتح المصادر" })).toHaveAttribute("href", "/corpora");
});

test("a running job shows in the header", async () => {
  fakeServer(() => undefined, () => ({ ...healthy, running_jobs: 2 }));
  renderApp("/lectures");
  expect(await screen.findByTitle("2 مهمة تعمل في الخلفية")).toBeInTheDocument();
});
