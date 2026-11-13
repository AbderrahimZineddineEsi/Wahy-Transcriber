import { screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { fakeServer, healthy, json, renderApp } from "./test/render";

// docs/editions.md: one web app, two editions. The server's health says which one; the product (tadqeeq) has its
// own name and none of the research screens.
const product = () => ({ ...healthy, edition: "tadqeeq" as const });

test("the product shows its own name and no research places in the menu", async () => {
  fakeServer(undefined, product);
  renderApp("/lectures");
  expect(await screen.findByRole("link", { name: /تدقيق/ })).toBeInTheDocument();
  await waitFor(() => expect(document.title).toBe("تدقيق · Tadqeeq"));
  const nav = screen.getByRole("navigation", { name: "التنقل" });
  for (const name of ["المحاضرات", "المصادر", "الإعدادات"]) expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
  expect(within(nav).queryByRole("link", { name: "بيانات التدريب" })).toBeNull();
  expect(within(nav).queryByRole("link", { name: "سجل الطلبات" })).toBeNull();
});

test("the product answers 'not found' for the research screens and never asks the server for them", async () => {
  const calls = fakeServer(undefined, product);
  renderApp("/training");
  expect(await screen.findByText("الصفحة غير موجودة")).toBeInTheDocument();
  expect(calls.some((c) => c.path.startsWith("/api/training") || c.path.startsWith("/api/telemetry"))).toBe(false);
});

test("the product's settings have no Laya panel; the studio's do", async () => {
  fakeServer((c) => (c.path === "/api/settings/laya" ? json({ loaded: false, checkpoint: "x", device: null, envelope: null, vram: null, installed: false }) : undefined), product);
  const first = renderApp("/settings");
  expect(await screen.findByRole("heading", { name: "مفاتيح الخدمات" })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("link", { name: /تدقيق/ })).toBeInTheDocument());
  expect(screen.queryByTestId("laya-state")).toBeNull();
  first.unmount();

  fakeServer((c) => (c.path === "/api/settings/laya" ? json({ loaded: false, checkpoint: "x", device: null, envelope: null, vram: null, installed: false }) : undefined));
  renderApp("/settings");
  expect(await screen.findByTestId("laya-state")).toBeInTheDocument();
});
