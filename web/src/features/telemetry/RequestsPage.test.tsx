import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fakeServer, json, renderApp, type Call } from "../../test/render";

const now = "2026-11-06T10:00:00";
const finding = (over = {}) => ({ finding_id: 1, display_ref: "الإخلاص: 1", source_type: "QURAN", verdict: "CORRECT", boundary: "COMPLETE", confidence: 0.93, probabilities: { CORRECT: 0.93, FALSE: 0.05, NOT_SURE: 0.02 }, human: null, ...over });
const rows = [
  { id: 2, created_at: now, provider: "laya", model: "v3_mixed", purpose: "verify", job_id: "j1", lecture_id: 1, ok: true, error: null, input_tokens: 612, output_tokens: 20, cost_usd: 0, latency_ms: 900, context_chars: 1800, findings: [finding({ finding_id: 2, display_ref: "مسلم (2149)", verdict: "FALSE", human: { verdict: "CORRECT", boundary: null } })] },
  { id: 1, created_at: now, provider: "gemini", model: "gemini-3.5-flash-lite", purpose: "verify", job_id: "j1", lecture_id: 1, ok: false, error: "HTTP 429", input_tokens: null, output_tokens: null, cost_usd: null, latency_ms: 2400, context_chars: 5000, findings: [finding({ finding_id: 1, verdict: null, probabilities: null })] },
];
const detail = { ...rows[0], request: { v: 3, kind: "hadith", ref: "مسلم (2149)" }, response: { verdict: "FALSE", p: 0.93 } };

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("wahy.lang", "en");
});
afterEach(() => vi.unstubAllGlobals());

function server(extra: (call: Call) => Response | undefined = () => undefined) {
  return fakeServer((call) => {
    const answer = extra(call);
    if (answer) return answer;
    if (call.path === "/api/telemetry/requests" && call.method === "GET") return json({ total: 2, total_cost_usd: 0.0004, items: rows });
    if (call.path === "/api/telemetry/requests/2") return json(detail);
    if (call.path === "/api/telemetry/requests" && call.method === "DELETE") return json({ deleted: 2 });
  });
}

test("the log has one row per request with its verdict, your correction, tokens and cost (F-095)", async () => {
  server();
  renderApp("/requests");
  const lines = await screen.findAllByTestId("request-row");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toHaveTextContent("Laya");
  expect(lines[0]).toHaveTextContent("مسلم (2149)");
  expect(lines[0]).toHaveTextContent("Ordinary speech 0.93");
  expect(lines[0]).toHaveTextContent("Correct"); // what you set
  expect(lines[0]).toHaveTextContent("612/20");
  expect(lines[1]).toHaveTextContent("Failed");
  expect(screen.getByTestId("log-total")).toHaveTextContent("2 requests");
  expect(screen.getByTestId("log-total")).toHaveTextContent("$0.0004");
});

test("filters go to the server: provider, status, and the lecture or pass in the link", async () => {
  const calls = server();
  renderApp("/requests?lecture=1");
  await screen.findByTestId("request-table");
  expect(calls.find((c) => c.path === "/api/telemetry/requests")).toBeDefined();
  await userEvent.selectOptions(screen.getByLabelText("Provider"), "gemini");
  await userEvent.selectOptions(screen.getByLabelText("Status"), "failed");
  await waitFor(() => expect(calls.filter((c) => c.path === "/api/telemetry/requests").length).toBeGreaterThan(2));
  expect(screen.getByRole("button", { name: /Lecture 1/ })).toBeInTheDocument();
});

test("opening a request shows the exact input and output, readable or raw, and copies them (F-096)", async () => {
  server();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  renderApp("/requests");
  await userEvent.click((await screen.findAllByTestId("request-row"))[0]);
  const input = await screen.findByTestId("payload-in");
  expect(input).toHaveTextContent('"kind": "hadith"'); // indented
  expect(screen.getByTestId("payload-out")).toHaveTextContent('"verdict": "FALSE"');
  await userEvent.click(screen.getByRole("button", { name: "Raw" }));
  expect(screen.getByTestId("payload-in").textContent).toBe('{"v":3,"kind":"hadith","ref":"مسلم (2149)"}');
  await userEvent.click(screen.getByRole("button", { name: "Copy input" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('{"v":3,"kind":"hadith","ref":"مسلم (2149)"}'));
});

test("clearing the log asks first, then deletes", async () => {
  const calls = server();
  renderApp("/requests");
  await screen.findByTestId("request-table");
  await userEvent.click(screen.getByRole("button", { name: "Clear the log" }));
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Click to confirm (verdicts stay)" }));
  await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/telemetry/requests")).toBe(true));
});
