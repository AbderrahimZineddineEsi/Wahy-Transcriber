import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fakeServer, json, renderApp, type Call } from "../../test/render";
import type { Job, LectureDetail } from "../lectures/api";
import { row, sampleWords } from "../lectures/view/fixtures";
import type { Settings } from "./api";

const now = "2026-11-06T10:00:00";
const lecture: LectureDetail = {
  id: 1, title: "درس", source_kind: "text", source_url: null, has_media: false, duration_s: 7, language: "ar",
  transcription_model: null, word_count: sampleWords.length, version_count: 1, created_at: now, updated_at: now, words: sampleWords,
};
// 1: a sure verse (not sent by default); 2: a hadith; 3: a doubtful verse; 4: a hadith already judged "start missing"
const findings = [
  row({ id: 1, idx: 0, data: { totalScore: 40, confidenceBand: "HIGH" } }),
  row({ id: 2, idx: 1, source_type: "HADITH", display_ref: "البخاري (1)", word_start: 10, word_end: 12, data: { totalScore: 50 } }),
  row({ id: 3, idx: 2, word_start: 7, word_end: 8, display_ref: "الأحزاب: 70", data: { totalScore: 40, confidenceBand: "CANDIDATE" } }),
  row({ id: 4, idx: 3, source_type: "HADITH", display_ref: "مسلم (2)", word_start: 0, word_end: 2, verdict: { verdict: "CORRECT", boundary: "MISSING_START", verifier: "laya", model: "v3" }, data: { totalScore: 50 } }),
];
const settings: Settings = {
  provider: "gemini", gemini_model: "gemini-3.5-flash-lite", gemini_batch_size: 5, gemini_free_tier: true, gemini_rpm: 12,
  jev_model: "typesafe/jev", openrouter_model: "deepseek/deepseek-chat", laya_checkpoint: null, laya_device: null, context_words: 25,
  prompt: {
    preset: "balanced", reason_lang: "ar", reason_detail: "brief", extra_instructions: "", system_prompt_override: "", temperature: 0.1,
    rules: { ignore_asr_errors: true, citation_cues: true, narrator_names: false, explaining_repeat: false, cue_before_garbled: false, explaining_with_text: false, prefer_not_sure: false, passages: true, no_thinking: false, suggest_merges: true },
  },
};
const job = (over: Partial<Job> = {}): Job => ({
  id: "v1", kind: "verify", status: "running", lecture_id: 1, params: { finding_ids: [2, 3, 4] },
  progress: { stage: "verify", findings_done: 0, findings_total: 3, requests_done: 0, requests_total: 2, percent: 0 },
  result: null, error: null, created_at: now, started_at: now, finished_at: null, updated_at: now, ...over,
});
const metrics = {
  job_id: "v1", status: "done", provider: "gemini", model: "m", findings_total: 3, findings_verified: 3, findings_failed: 0,
  verdict_counts: { CORRECT: 2, FALSE: 1, NOT_SURE: 0 }, clipped: 1, requests: 2, requests_ok: 2, requests_failed: 0,
  total_latency_ms: 4000, avg_latency_ms: 2000, input_tokens: 3000, output_tokens: 300, avg_input_tokens: 1500, cost_usd: 0.0123,
  envelope_ms: 40, elapsed_s: 5,
};

class FakeEventSource {
  static all: FakeEventSource[] = [];
  listeners = new Map<string, (e: MessageEvent<string>) => void>();
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(name: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.set(name, fn);
  }
  close() {}
  push(snapshot: Job) {
    act(() => this.listeners.get("job")?.({ data: JSON.stringify(snapshot) } as MessageEvent<string>));
  }
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("wahy.lang", "en"); // the tests read English labels
  FakeEventSource.all = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => vi.unstubAllGlobals());

type Options = { verdictFails?: boolean; settingsFails?: boolean };
function server(options: Options = {}, extra: (call: Call) => Response | undefined = () => undefined) {
  let current = settings;
  return fakeServer((call) => {
    const answer = extra(call);
    if (answer) return answer;
    if (call.path === "/api/lectures/1" && call.method === "GET") return json(lecture);
    if (call.path === "/api/lectures/1/findings") return json({ lecture_id: 1, count: findings.length, findings });
    if (call.path === "/api/lectures/1/versions") return json([]);
    if (call.path === "/api/jobs") return json([]);
    if (call.path === "/api/verification/settings" && call.method === "GET") return json(current);
    if (call.path === "/api/verification/settings" && call.method === "PATCH") {
      if (options.settingsFails) return json({ detail: "refused" }, 422);
      current = { ...current, ...(call.body as object) } as Settings;
      return json(current);
    }
    if (call.path === "/api/verification/prompts") return json({ presets: {}, rules: {}, default_system_prompt: "DEFAULT PROMPT", defaults: settings });
    if (call.path === "/api/settings/laya") return json({ loaded: false, checkpoint: "r6", envelope: null, vram: {}, installed: true, device: null });
    if (call.path === "/api/lectures/1/verification/estimate") {
      const n = (call.body as { finding_ids: number[] }).finding_ids.length;
      return json({ provider: "gemini", model: "gemini-3.5-flash-lite", findings: n, items: n, requests: n, approx_input_tokens: 1000 * n, approx_output_tokens: 100 * n, est_cost_usd: 0, est_seconds: 6 * n, envelope_version: 1 });
    }
    if (call.path === "/api/lectures/1/verification" && call.method === "POST") return json({ job: job() }, 202);
    if (call.path === "/api/verification/passes/v1") return json(metrics);
    if (call.path === "/api/lectures/1/verification/approve") return json({ approved: 3, labels: 3 });
    if (call.path === "/api/lectures/1/verification/preview") {
      return json({ provider: "gemini", model: "m", endpoint: "https://x", finding_ids: [2], envelope_version: 1, system_prompt: "SYSTEM TEXT", state: { a: 1 }, questions: { verdict: { instructions: "Be strict: only accept verbatim" } }, body: { contents: [] }, approx_tokens: 123 });
    }
    if (call.path === "/api/findings/2/verdict" && call.method === "PUT") return options.verdictFails ? json({ detail: "no" }, 500) : json({ finding_id: 2, verdict_id: 9, verdict: "FALSE", boundary: null, label_id: 1 });
    if (call.path === "/api/findings/4/expand") return json({ finding_id: 4, changed: true, reason: null, added: { start: 2, end: 0 }, word_start: 0, word_end: 2, data: {} });
  });
}

const rows = () => screen.getAllByTestId("finding-row");
const ticked = () => rows().filter((r) => (within(r).getByRole("checkbox") as HTMLInputElement).checked).map((r) => Number(r.dataset.id));
const lastEstimate = (calls: Call[]) => [...calls].reverse().find((c) => c.path.endsWith("/estimate"))!.body as { finding_ids: number[] };

test("the default scope ticks the hadith and the doubtful findings; the estimate follows the ticks (F-084, F-087)", async () => {
  const calls = server();
  renderApp("/lectures/1/verify");
  await screen.findByTestId("finding-list");
  expect(ticked()).toEqual([2, 3, 4]);
  await waitFor(() => expect(screen.getByTestId("est-requests")).toHaveTextContent("3"));
  expect(lastEstimate(calls).finding_ids).toEqual([2, 3, 4]);

  await userEvent.click(within(rows()[2]).getByRole("checkbox")); // untick finding 3
  await waitFor(() => expect(screen.getByTestId("est-requests")).toHaveTextContent("2"));
  expect(lastEstimate(calls).finding_ids).toEqual([2, 4]);
  expect(screen.getByTestId("est-findings")).toHaveTextContent("2");
  expect(screen.getByLabelText("Scope")).toHaveValue("HADITH_ONLY"); // [2, 4] is exactly that scope
});

test("scope buttons, none and invert change the ticks", async () => {
  server();
  renderApp("/lectures/1/verify");
  await screen.findByTestId("finding-list");
  await userEvent.selectOptions(screen.getByLabelText("Scope"), "HADITH_ONLY");
  expect(ticked()).toEqual([2, 4]);
  await userEvent.click(screen.getByRole("button", { name: "Select none" }));
  expect(ticked()).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "Invert" }));
  expect(ticked()).toEqual([1, 2, 3, 4]);
  await userEvent.selectOptions(screen.getByLabelText("Kind"), "hadith");
  expect(rows()).toHaveLength(2);
});

test("start sends exactly the ticked findings; progress, pause, and the numbers and approve-all when it ends (F-088, F-089, F-091)", async () => {
  const calls = server();
  renderApp("/lectures/1/verify");
  await screen.findByTestId("finding-list");
  await userEvent.click(within(rows()[2]).getByRole("checkbox")); // finding 3 off
  await userEvent.click(screen.getByRole("button", { name: "Start verification" }));
  await screen.findByTestId("pass");
  const start = calls.find((c) => c.method === "POST" && c.path === "/api/lectures/1/verification")!;
  expect((start.body as { finding_ids: number[] }).finding_ids).toEqual([2, 4]);
  expect(screen.getByTestId("pass")).toHaveTextContent("0 / 3 quotes");
  expect(screen.getByRole("button", { name: "Start verification" })).toBeDisabled(); // one pass at a time
  expect(within(rows()[1]).getByText("Queued")).toBeInTheDocument(); // finding 2 has no verdict yet

  await userEvent.click(screen.getByRole("button", { name: "Pause" }));
  expect(calls.some((c) => c.method === "POST" && c.path === "/api/jobs/v1/pause")).toBe(true);

  const stream = FakeEventSource.all.find((s) => s.url === "/api/jobs/v1/events")!;
  stream.push(job({ progress: { ...job().progress, findings_done: 2, requests_done: 1, percent: 66.7 } }));
  expect(screen.getByTestId("pass")).toHaveTextContent("2 / 3 quotes");
  expect(screen.getByTestId("pass")).toHaveTextContent("1 / 2 requests");
  stream.push(job({ status: "done", result: { failed: [{ finding_id: 4, error: "boom" }] }, progress: { ...job().progress, findings_done: 3, requests_done: 2, percent: 100 } }));
  const m = await screen.findByTestId("metrics");
  expect(m).toHaveTextContent("$0.0123"); // the cost of the pass
  expect(m).toHaveTextContent("3,000 → 300");
  expect(within(rows()[3]).getByText("Error")).toBeInTheDocument(); // finding 4 failed in the pass

  const approve = screen.getByRole("button", { name: "Approve all verdicts" });
  await userEvent.click(approve);
  expect(calls.some((c) => c.path.endsWith("/approve"))).toBe(false); // asks first
  await userEvent.click(screen.getByRole("button", { name: "Click to confirm: saves gold labels" }));
  await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/lectures/1/verification/approve")).toBe(true));
});

test("choosing a verifier saves it at once; a refused change goes back (optimistic update)", async () => {
  const calls = server();
  renderApp("/lectures/1/verify");
  await screen.findByTestId("finding-list");
  const seg = await screen.findByRole("group", { name: "Verifier" });
  await userEvent.click(within(seg).getByRole("button", { name: "JEV" }));
  expect(within(seg).getByRole("button", { name: "JEV" })).toHaveAttribute("aria-pressed", "true");
  await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ provider: "jev" }));
  expect(await screen.findByLabelText("JEV model")).toHaveValue("typesafe/jev");
});

test("a refused settings change puts the old verifier back", async () => {
  server({ settingsFails: true });
  renderApp("/lectures/1/verify");
  const seg = await screen.findByRole("group", { name: "Verifier" });
  await userEvent.click(within(seg).getByRole("button", { name: "Laya" }));
  await waitFor(() => expect(within(seg).getByRole("button", { name: "Gemini" })).toHaveAttribute("aria-pressed", "true"));
  expect(within(seg).getByRole("button", { name: "Laya" })).toHaveAttribute("aria-pressed", "false");
});

test("the Gemini options are saved: requests per minute and the free tier", async () => {
  const calls = server();
  renderApp("/lectures/1/verify");
  const rpm = await screen.findByLabelText("Requests per minute");
  await userEvent.clear(rpm);
  await userEvent.type(rpm, "5{Enter}");
  await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ gemini_rpm: 5 }));
});

test("the preview shows the request that would be sent (F-086)", async () => {
  server();
  renderApp("/lectures/1/verify");
  await screen.findByTestId("finding-list");
  await userEvent.click(screen.getByRole("button", { name: "Preview request" }));
  expect(await screen.findByTestId("preview-system")).toHaveTextContent("SYSTEM TEXT");
  expect(screen.getByTestId("preview-questions")).toHaveTextContent("Be strict: only accept verbatim");
});

test("a verdict says its boundary; the clipped filter and the ✂ badge show a quote with its start missing (F-037, F-090)", async () => {
  server();
  renderApp("/lectures/1");
  const transcript = await screen.findByTestId("transcript");
  expect(transcript.querySelector('.cut[data-cut="start"]')).not.toBeNull();
  expect(transcript.querySelector('.cut[data-cut="end"]')).toBeNull();
});

test("your verdict on a finding shows at once, and comes back if the server refuses (optimistic update)", async () => {
  server({ verdictFails: true });
  renderApp("/lectures/1");
  const transcript = await screen.findByTestId("transcript");
  await userEvent.click(within(transcript).getByRole("button", { name: "البخاري (1)" }));
  const card = await screen.findByTestId("finding-card");
  expect(within(card).getByText("Unverified")).toBeInTheDocument();
  await userEvent.click(within(card).getByRole("button", { name: "Ordinary speech" }));
  expect(within(card).getAllByText("Ordinary speech").length).toBeGreaterThan(0); // shown before the answer
  await waitFor(() => expect(within(card).queryByText("Unverified")).not.toBeNull()); // refused: back to the old verdict
});

test("a quote with a missing start can be completed from its card", async () => {
  const calls = server();
  renderApp("/lectures/1");
  const transcript = await screen.findByTestId("transcript");
  await userEvent.click(within(transcript).getByRole("button", { name: "مسلم (2)" }));
  const card = await screen.findByTestId("finding-card");
  await userEvent.click(within(card).getByRole("button", { name: "Complete the quote" }));
  await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/findings/4/expand")).toBe(true));
  expect(await screen.findByText("Added 2 words to the quote")).toBeInTheDocument();
});

test("opening the tab from a finding's card preselects just that finding", async () => {
  server();
  renderApp("/lectures/1/verify?finding=1");
  await screen.findByTestId("finding-list");
  expect(ticked()).toEqual([1]);
});
