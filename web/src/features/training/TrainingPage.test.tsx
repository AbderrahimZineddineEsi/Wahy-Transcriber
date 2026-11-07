import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fakeServer, json, renderApp, type Call } from "../../test/render";

const now = "2026-11-07T10:00:00";
const row = (over = {}) => ({
  id: "label:1", origin: "user", action: "SET", gold: true, task: "verification", reference: "الإخلاص: 1", source_type: "QURAN",
  text: "قل هو الله أحد", verdict: "FALSE", ai_verdict: "CORRECT", boundary: null, ref_issue: false, typo: false, provider: null,
  lecture_id: 1, lecture_title: "درس الجمعة", finding_id: 4, run_id: null, created_at: now, ...over,
});
const rows = [
  row(),
  row({ id: "label:2", action: "ORDINARY_SPEECH", verdict: "FALSE", ai_verdict: null, reference: "مسلم (2149)", text: "أمير المؤمنين", ref_issue: true }),
  row({ id: "verdict:9", origin: "ai", action: null, gold: false, verdict: "CORRECT", ai_verdict: "CORRECT", boundary: "MISSING_END", provider: "laya-wahy-r6-v3_mixed" }),
  row({ id: "label:3", origin: "tafrigh", action: "human_corrected", task: "tafrigh_structure", reference: null, text: "باب المياه", verdict: "heading_2_none", ai_verdict: "paragraph", typo: true, provider: "jev_hybrid", run_id: "run_1" }),
];
const counts = { total: 4, correct: 1, false: 2, not_sure: 0, clipped: 1, gold: 3, ai: 1, missed: 0, segmentation: 1, typo: 1 };

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("wahy.lang", "en");
});
afterEach(() => vi.unstubAllGlobals());

function server(extra: (call: Call) => Response | undefined = () => undefined) {
  return fakeServer((call) => {
    const answer = extra(call);
    if (answer) return answer;
    if (call.path === "/api/training" && call.method === "GET") {
      const q = new URLSearchParams(call.search);
      const shown = q.get("origin") === "gold" ? rows.filter((r) => r.gold) : rows;
      return json({ counts, rows: shown, matching: shown.length });
    }
    if (decodeURIComponent(call.path) === "/api/training/rows/label:1") return json({ id: "label:1", row: { id: "wahy_dec_1_1", meta: { human_verified: true } } });
    if (call.path === "/api/training" && call.method === "DELETE") return json({ deleted: 4 });
    if (call.path === "/api/training/import/legacy") return json({ imported: 6, replaced: 0, skipped: 0, files: ["bank.jsonl"] });
  });
}

test("the counters and one row per label, with where it came from (F-100, F-104)", async () => {
  server();
  renderApp("/training");
  const lines = await screen.findAllByTestId("train-row");
  expect(lines).toHaveLength(4);
  const kpis = screen.getByTestId("train-kpis");
  expect(within(kpis).getByText("rows").parentElement).toHaveTextContent("4");
  expect(kpis.querySelector('[data-kpi="false"]')).toHaveTextContent("2ordinary speech");
  expect(kpis.querySelector('[data-kpi="segmentation"]')).toHaveTextContent("1");
  expect(lines[0]).toHaveTextContent("Ordinary speech (gold)");
  expect(lines[0]).toHaveTextContent("Correct"); // what the model said before
  expect(lines[0]).toHaveTextContent("You (verdict)");
  expect(lines[1]).toHaveTextContent("You (deleted as ordinary speech)");
  expect(lines[1]).toHaveTextContent("reference wrong");
  expect(lines[2]).toHaveTextContent("Verifier");
  expect(lines[2]).toHaveTextContent("laya-wahy-r6-v3_mixed");
  expect(lines[2]).toHaveTextContent("End missing");
  expect(lines[3]).toHaveTextContent("Heading 2 · typo fixed (gold)");
  expect(lines[3]).toHaveTextContent("Tafrigh (corrected)");
});

test("the filters go to the server, and a row opens the line it exports", async () => {
  const calls = server();
  renderApp("/training");
  await screen.findAllByTestId("train-row");
  await userEvent.click(screen.getByRole("button", { name: "Gold labels" }));
  await waitFor(() => expect(screen.getAllByTestId("train-row")).toHaveLength(3));
  expect(calls.some((c) => c.path === "/api/training" && c.search?.includes("origin=gold"))).toBe(true);
  await userEvent.selectOptions(screen.getByLabelText("Label"), "CLIPPED");
  await waitFor(() => expect(calls.some((c) => c.search?.includes("label=CLIPPED"))).toBe(true));
  await userEvent.click(screen.getAllByTestId("train-row")[0]);
  expect(await screen.findByTestId("train-json")).toHaveTextContent('"human_verified": true');
});

test("export links download the server's files; gold only goes in the link (F-101)", async () => {
  server();
  renderApp("/training");
  await screen.findAllByTestId("train-row");
  expect(screen.getByTestId("train-export")).toHaveAttribute("href", "/api/training/export?task=verification&gold_only=false");
  await userEvent.click(screen.getByTestId("train-gold-only"));
  expect(screen.getByTestId("train-export")).toHaveAttribute("href", "/api/training/export?task=verification&gold_only=true");
  expect(screen.getByTestId("train-export-tafrigh")).toHaveAttribute("href", "/api/training/export?task=tafrigh&gold_only=true");
});

test("clearing asks a second click (F-103); the legacy folder imports", async () => {
  const calls = server();
  renderApp("/training");
  await screen.findAllByTestId("train-row");
  await userEvent.click(screen.getByTestId("train-clear"));
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  await userEvent.click(screen.getByTestId("train-clear"));
  await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/training")).toBe(true));
  expect(await screen.findByText("4 rows cleared")).toBeInTheDocument();
  await userEvent.click(screen.getByTestId("train-import-legacy"));
  expect(await screen.findByText("6 rows imported, 0 replaced, 0 skipped")).toBeInTheDocument();
});

test("no data yet says how to get some", async () => {
  server((call) => (call.path === "/api/training" && call.method === "GET" ? json({ counts: { ...counts, total: 0 }, rows: [], matching: 0 }) : undefined));
  renderApp("/training");
  expect(await screen.findByTestId("train-empty")).toHaveTextContent("No training data yet");
});
