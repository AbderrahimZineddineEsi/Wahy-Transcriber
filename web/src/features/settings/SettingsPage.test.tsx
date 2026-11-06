import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { fakeServer, healthy, json, renderApp } from "../../test/render";

test("a saved key shows as set, and the key is never shown again", async () => {
  const keys = { ...healthy.keys };
  const calls = fakeServer(
    (call) => {
      if (call.method === "PUT" && call.path === "/api/settings/keys/gemini") {
        keys.gemini = true;
        return json(keys);
      }
    },
    () => ({ ...healthy, keys }),
  );
  renderApp("/settings");
  expect(await screen.findByTestId("key-gemini")).toHaveAttribute("data-set", "false");

  await userEvent.type(screen.getByLabelText("Gemini API key"), "gem-secret-123");
  await userEvent.click(within(screen.getByRole("form", { name: "Gemini" })).getByRole("button", { name: "حفظ" }));

  expect(await screen.findByText("تم حفظ مفتاح Gemini")).toBeInTheDocument();
  expect(screen.getByTestId("key-gemini")).toHaveAttribute("data-set", "true");
  expect(screen.getByTestId("key-groq")).toHaveAttribute("data-set", "false");
  expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ value: "gem-secret-123" });
  expect(document.body.textContent).not.toContain("gem-secret-123");
  expect(screen.getByLabelText("Gemini API key")).toHaveValue("");
});

test("a key can be removed", async () => {
  const keys = { ...healthy.keys, groq: true };
  fakeServer(
    (call) => {
      if (call.method === "PUT") {
        keys.groq = false;
        return json(keys);
      }
    },
    () => ({ ...healthy, keys }),
  );
  renderApp("/settings");
  await waitFor(() => expect(screen.getByTestId("key-groq")).toHaveAttribute("data-set", "true"));
  const row = screen.getByRole("form", { name: "Groq" });
  await userEvent.click(within(row).getByRole("button", { name: "حذف" }));
  expect(await screen.findByText("تم حذف مفتاح Groq")).toBeInTheDocument();
  expect(screen.getByTestId("key-groq")).toHaveAttribute("data-set", "false");
});

test("a failed save shows an error toast whose details name the endpoint, without the key", async () => {
  fakeServer((call) => (call.method === "PUT" ? json({ detail: "a key cannot contain a line break" }, 422) : undefined));
  renderApp("/settings");
  await userEvent.type(await screen.findByLabelText("Groq API key"), "gsk-secret-456");
  await userEvent.click(within(screen.getByRole("form", { name: "Groq" })).getByRole("button", { name: "حفظ" }));

  const toast = await screen.findByRole("alert");
  expect(toast).toHaveTextContent("a key cannot contain a line break");
  await userEvent.click(within(toast).getByRole("button", { name: "التفاصيل" }));
  const report = screen.getByRole("dialog", { name: "تقرير الخطأ" });
  expect(report).toHaveTextContent("PUT /api/settings/keys/groq");
  expect(report).toHaveTextContent("Status: 422");
  expect(report.textContent).not.toContain("gsk-secret-456");
});

test("the status panel shows the GPU, the loaded model and the corpus", async () => {
  fakeServer(
    () => undefined,
    () => ({
      ...healthy,
      gpu: { card: "GTX 1050", total_mb: 4096, free_mb: 3100, resident: "laya", in_use: null, waiting: [] },
      engine: { running: true, starts: 1, calls: 3 },
    }),
  );
  renderApp("/settings");
  const status = await screen.findByRole("region", { name: "الحالة" });
  expect(await within(status).findByText(/GTX 1050/)).toHaveTextContent("3100 / 4096 MB");
  expect(within(status).getByText("laya")).toBeInTheDocument();
  expect(within(status).getByText("يعمل")).toBeInTheDocument();
  expect(within(status).getByText("جاهزة")).toBeInTheDocument();
});

test("the interface panel switches language and theme", async () => {
  fakeServer();
  renderApp("/settings");
  await userEvent.click(await screen.findByRole("button", { name: "داكن" }));
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  await userEvent.click(screen.getByRole("button", { name: "English" }));
  expect(document.documentElement).toHaveAttribute("dir", "ltr");
  expect(screen.getByRole("heading", { name: "Service keys" })).toBeInTheDocument();
});
