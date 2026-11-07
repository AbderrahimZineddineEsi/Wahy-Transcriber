import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fakeServer, json, renderApp, type Call } from "../../test/render";

const now = "2026-11-07T10:00:00";
const initial = (id: string, t: string) => ({ id, category: "التسبيح", ref: t, t, is_custom: false, created_at: now });
let adhkar: ReturnType<typeof initial>[];
let settings: { engine: string; qiraat: string; adhkar: boolean };
let sources: Record<string, unknown>[];
let laya: Record<string, unknown>;

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("wahy.lang", "en");
  adhkar = [initial("Adhkar:a", "سبحان الله"), initial("Adhkar:b", "الحمد لله")];
  settings = { engine: "v5", qiraat: "AUTO", adhkar: true };
  sources = [
    { id: "wahy_default", label: "Wahy built-in", description: "", builtin: true, status: "ready", active: true, count: null, zip_cached: false },
    { id: "open_hadith_data", label: "Open Hadith Data", description: "with chains", builtin: false, status: "missing", active: false, count: null, zip_cached: false },
  ];
  laya = { loaded: false, checkpoint: "me/laya", device: null, envelope: { version: 3, options: {}, questions: null }, vram: { free_mb: 3000, total_mb: 4000 }, installed: true };
});
afterEach(() => vi.unstubAllGlobals());

function server(extra: (call: Call) => Response | undefined = () => undefined) {
  return fakeServer((call) => {
    const answer = extra(call);
    if (answer) return answer;
    const { method, path } = call;
    if (path === "/api/corpora/adhkar" && method === "GET") return json(adhkar);
    if (path === "/api/corpora/adhkar" && method === "POST") {
      const body = call.body as { category: string; ref: string; t: string };
      const row = { ...initial(`Adhkar:custom_${adhkar.length}`, body.t), category: body.category, ref: body.ref, is_custom: true };
      adhkar = [row, ...adhkar];
      return json(row, 201);
    }
    if (path.startsWith("/api/corpora/adhkar/") && method === "DELETE") {
      adhkar = adhkar.filter((d) => d.id !== decodeURIComponent(path.split("/").pop()!));
      return new Response(null, { status: 204 });
    }
    if (path === "/api/corpora/adhkar/reset") return json((adhkar = adhkar.filter((d) => !d.is_custom)));
    if (path === "/api/corpora/custom-quotes") return json([]);
    if (path === "/api/corpora/info") return json({ quran: 6236, hadiths: 39737, adhkar: adhkar.length, custom_quotes: 0, hadith_source: "wahy_default", fingerprint: {} });
    if (path === "/api/corpora/browse") {
      const q = new URLSearchParams(call.search);
      return json({ total: 110, items: [{ id: "18:26", ref: `الكهف: ${26 + Number(q.get("offset"))}`, text: "قل الله أعلم", group: "الكهف" }], groups: { "18": ["الكهف", 110], "19": ["مريم", 98] } });
    }
    if (path === "/api/corpora/sources") return json(sources);
    if (path === "/api/corpora/sources/open_hadith_data/prepare") {
      sources[1] = { ...sources[1], status: "preparing" };
      return json({ job: { id: "j1" } }, 202);
    }
    if (path === "/api/detection/settings" && method === "GET") return json(settings);
    if (path === "/api/detection/settings" && method === "PATCH") return json((settings = { ...settings, ...(call.body as object) }));
    if (path === "/api/settings/laya" && method === "GET") return json(laya);
    if (path === "/api/settings/laya/load") return json((laya = { ...laya, loaded: true, device: "cuda", vram: { free_mb: 1800, total_mb: 4000, allocated_mb: 1200 } }));
    if (path === "/api/settings/laya/unload") return json((laya = { ...laya, loaded: false, device: null }));
  });
}

test("the adhkar are ordinary rows: add one, delete an initial one (F-073, F-077)", async () => {
  const calls = server();
  renderApp("/corpora");
  expect(await screen.findAllByTestId("dhikr-row")).toHaveLength(2);
  expect(screen.getByTestId("corpora-count-adhkar")).toHaveTextContent("2");
  expect(screen.getByTestId("dhikr-add")).toBeDisabled(); // two words at least
  await userEvent.type(screen.getByTestId("dhikr-new"), "لا إله");
  await userEvent.click(screen.getByTestId("dhikr-add"));
  await waitFor(() => expect(screen.getAllByTestId("dhikr-row")).toHaveLength(3));
  expect(calls.find((c) => c.method === "POST" && c.path === "/api/corpora/adhkar")?.body).toMatchObject({ t: "لا إله" });
  expect(screen.getAllByTestId("dhikr-row")[0]).toHaveTextContent("Added by you");

  await userEvent.click(screen.getByRole("button", { name: "Delete سبحان الله" })); // an initial row
  await waitFor(() => expect(screen.getAllByTestId("dhikr-row")).toHaveLength(2));
});

test("the filter splits initial rows from yours, and the reset asks first (F-073, F-074)", async () => {
  const calls = server();
  renderApp("/corpora");
  await screen.findAllByTestId("dhikr-row");
  await userEvent.click(screen.getByRole("button", { name: /^Mine/ }));
  expect(screen.queryAllByTestId("dhikr-row")).toHaveLength(0);
  await userEvent.click(screen.getByTestId("adhkar-reset"));
  expect(calls.some((c) => c.path === "/api/corpora/adhkar/reset")).toBe(false); // first click only asks
  await userEvent.click(screen.getByTestId("adhkar-reset"));
  await waitFor(() => expect(calls.some((c) => c.path === "/api/corpora/adhkar/reset")).toBe(true));
});

test("a note says adhkar are found by engine v3 only, when another engine is chosen", async () => {
  server();
  renderApp("/corpora");
  expect(await screen.findByTestId("adhkar-v3-note")).toHaveTextContent("(v5)");
});

test("the adhkar switch is the detection setting (F-046)", async () => {
  const calls = server();
  renderApp("/corpora");
  const box = await screen.findByTestId("adhkar-detect");
  await waitFor(() => expect(box).toBeEnabled());
  await userEvent.click(box);
  await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ adhkar: false }));
});

test("browsing the Quran: pick a surah, go to page 2 (F-076)", async () => {
  const calls = server();
  renderApp("/corpora/quran");
  expect(await screen.findAllByTestId("browse-row")).toHaveLength(1);
  expect(screen.getByTestId("corpora-count-quran")).toHaveTextContent("6,236");
  await userEvent.selectOptions(screen.getByTestId("browse-group"), "18");
  await userEvent.click(screen.getByTestId("browse-next"));
  await waitFor(() => expect(screen.getByTestId("browse-row")).toHaveTextContent("الكهف: 51"));
  const last = calls.filter((c) => c.path === "/api/corpora/browse").at(-1)!;
  expect(new URLSearchParams(last.search)).toMatchObject({});
  expect(last.search).toContain("surah=18");
  expect(last.search).toContain("offset=25");
  expect(screen.getByTestId("browse-range")).toHaveTextContent("26–50 of 110");
});

test("preparing a hadith source: its status moves from missing to preparing (F-079)", async () => {
  server();
  renderApp("/corpora/sources");
  const row = await screen.findByTestId("source-open_hadith_data");
  expect(row).toHaveAttribute("data-status", "missing");
  expect(within(screen.getByTestId("source-wahy_default")).getByRole("radio")).toBeChecked();
  await userEvent.click(screen.getByTestId("source-prepare-open_hadith_data"));
  await waitFor(() => expect(screen.getByTestId("source-open_hadith_data")).toHaveAttribute("data-status", "preparing"));
});

test("settings: the engine choice is saved, Laya loads and unloads (F-011, F-097, F-098)", async () => {
  const calls = server();
  renderApp("/settings");
  expect(await screen.findByTestId("laya-state")).toHaveTextContent("Not loaded");
  await waitFor(() => expect(screen.getByTestId("engine-v5")).toBeEnabled());
  expect(screen.getByTestId("engine-v5")).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByTestId("engine-v5:loose"));
  await waitFor(() => expect(screen.getByTestId("engine-v5:loose")).toHaveAttribute("aria-pressed", "true"));
  expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ engine: "v5:loose" });

  expect(screen.getByTestId("laya-envelope")).toHaveTextContent("v3");
  await userEvent.click(screen.getByRole("button", { name: "cuda" }));
  await userEvent.click(screen.getByTestId("laya-load"));
  await waitFor(() => expect(screen.getByTestId("laya-state")).toHaveTextContent("Loaded"));
  expect(calls.find((c) => c.path === "/api/settings/laya/load")?.body).toEqual({ checkpoint: "me/laya", device: "cuda" });
  expect(screen.getByTestId("laya-device")).toHaveTextContent("cuda");
  expect(screen.getByTestId("laya-vram")).toHaveTextContent("1800 / 4000 MB free · Laya holds 1200 MB");
  await userEvent.click(screen.getByTestId("laya-unload"));
  await waitFor(() => expect(screen.getByTestId("laya-state")).toHaveTextContent("Not loaded"));
});
