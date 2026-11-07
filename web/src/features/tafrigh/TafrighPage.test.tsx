import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fakeServer, json, renderApp, type Call } from "../../test/render";
import type { Job, LectureDetail } from "../lectures/api";
import { sampleWords } from "../lectures/view/fixtures";
import type { CompareResult, Estimate, Preview, RunDetail, RunSummary } from "./api";

const now = "2026-11-07T10:00:00";
const lecture: LectureDetail = {
  id: 1, title: "درس", source_kind: "text", source_url: null, has_media: false, duration_s: 7, language: "ar",
  transcription_model: null, word_count: sampleWords.length, version_count: 1, created_at: now, updated_at: now, words: sampleWords,
};

const sentence = (i: number, text: string, words = 5) => ({ index: i, id: `seg_000${i + 1}`, text, words, start_time: i * 3, end_time: i * 3 + 2, cut_reason: "punctuation", has_detection: i === 1, quote_kinds: i === 1 ? ["quran"] : [] });
const preview = (maxWords = 40): Preview => ({
  sentences: [sentence(0, "الحمد لله رب العالمين"), sentence(1, "قال الله تعالى إنا أعطيناك الكوثر"), sentence(2, "فصل لربك وانحر")],
  stats: { sentences: 3, words_total: 15, min_words: 3, max_words: Math.min(maxWords, 7), avg_words: 5, median_words: 5, over_cap: 0, avg_duration_sec: 2, cut_reasons: { punctuation: 3 }, quote_sentences: 1, has_timestamps: true },
  seg_config: { use_punctuation: true, pause_sec: 0.7, min_words: 2, max_words: maxWords }, text_source: "raw_findings", quotes: { quran: 1 }, words: 15,
});
const estimate = (): Estimate => ({
  sentences: 3,
  per_sentence: { requests: 4, input_tokens: 4000, output_tokens: 880 },
  windowed: { requests: 1, input_tokens: 1500, output_tokens: 450, window_size: 15 },
  jev: { requests: 9, input_tokens: 3000, output_tokens: 0 },
  laya: { requests: 3, input_tokens: 0, output_tokens: 0 },
  price: null,
});

const seg = (i: number, over: Record<string, unknown> = {}) => ({
  id: `seg_000${i + 1}`, text: ["الحمد لله رب العالمين", "قال الله تعالى إنا أعطيناك الكوثر", "فصل لربك وانحر"][i], original_text: "x", tag: "paragraph", level: null, parent_id: null, comment_kind: null,
  review_flags: [], has_versions: false, display_text: "x", corrected_text: null, cut_reason: "punctuation", start_time: i * 3, end_time: i * 3 + 2, quotes: [],
  trace: { decision: { provider: "jev", answers: { tag: { choice: "paragraph", confidence: 0.57, probabilities: { paragraph: 0.57, continuation: 0.43 } } } } }, ...over,
});
const summary = (id: string, name: string, over: Partial<RunSummary> = {}): RunSummary => ({
  run_id: id, lecture_id: 1, name, created_at: "2026-11-07T09:00:00+00:00", copied_from: null, job_id: "t1", num_segments: 3, needs_review: 2, reviewed: 0,
  processing_mode: "windowed", window_size: 15, model_candidate: "gemini_all", model_name: "auto", typo_strategy: "gated", target_range: null, stopped: false,
  total_cost_usd: 0.0012, requests_sent: 2, wall_clock_seconds: 4, ...over,
});
const item = (i: number) => ({ segment_id: `seg_000${i + 1}`, original_text: "x", active_text: seg(i).text, review_flags: [], confidence: 0.57, has_typo_versions: i === 2, reasons: ["low_confidence"], tag_probabilities: {} });
const detail = (id: string, name: string, segments = [seg(0), seg(1), seg(2)], items = [item(1), item(2)]): RunDetail => ({
  run: summary(id, name, { needs_review: items.length }),
  markdown: "# درس\n", html: "<p/>", structured_json: { segments }, outline: [{ segment_id: "seg_0003", level: 1, title: "عنوان الفصل", parent_id: null }],
  review_items: items as never, report: { failure_rate: 0 }, warnings: [],
  manifest: { cost_breakdown: [{ purpose: "classify", model: "gemini-3.5-flash-lite", requests: 2, retries: 0, cost_usd: 0.0012, input_tokens: 1500, output_tokens: 450 }], gemini_route: "direct" },
});

const job = (over: Partial<Job> = {}): Job => ({
  id: "t1", kind: "tafrigh", status: "running", lecture_id: 1, params: {},
  progress: { stage: "tafrigh", done: 1, total: 3, percent: 33, requests_sent: 1, requests_planned: 2, cost_usd: 0.0004, inflight: { from: 1, to: 3 }, tags: { paragraph: 1 }, current: { purpose: "classify_window" } },
  result: null, error: null, created_at: now, started_at: now, finished_at: null, updated_at: now, ...over,
});

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
  window.localStorage.setItem("wahy.lang", "en");
  FakeEventSource.all = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

type Opts = { runs?: RunSummary[]; details?: Record<string, RunDetail>; startFails?: string };
function server(opts: Opts = {}, extra: (call: Call) => Response | undefined = () => undefined) {
  const runs = opts.runs ?? [];
  const details = { ...(opts.details ?? {}) };
  return fakeServer((call) => {
    const answer = extra(call);
    if (answer) return answer;
    if (call.path === "/api/lectures/1" && call.method === "GET") return json(lecture);
    if (call.path === "/api/lectures/1/findings") return json({ lecture_id: 1, count: 0, findings: [] });
    if (call.path === "/api/lectures/1/versions") return json([]);
    if (call.path === "/api/jobs") return json([]);
    if (call.path === "/api/lectures/1/tafrigh/preview") return json(preview((call.body as { seg_config: { max_words: number } }).seg_config.max_words));
    if (call.path === "/api/lectures/1/tafrigh/estimate") return json(estimate());
    if (call.path === "/api/tafrigh/runs" && call.method === "GET") return json(runs);
    const one = call.path.match(/^\/api\/tafrigh\/runs\/(run_\w+)$/);
    if (one && call.method === "GET") return details[one[1]] ? json(details[one[1]]) : json({ detail: "no" }, 404);
    if (call.path === "/api/lectures/1/tafrigh/runs" && call.method === "POST") return opts.startFails ? json({ detail: opts.startFails }, 422) : json({ job: job() }, 202);
  });
}

const start = () => userEvent.click(screen.getByTestId("tfg-start"));

test("the sentences and their statistics show before any model call, and the cutting settings change them (F-106, F-107)", async () => {
  const calls = server();
  renderApp("/lectures/1/tafrigh");
  expect(await screen.findAllByTestId("tfg-sentence")).toHaveLength(3);
  expect(screen.getByTestId("tfg-stat-sentences")).toHaveTextContent("3");
  expect(screen.getByTestId("tfg-sentences")).toHaveTextContent("Verse"); // the sentence that holds a quote says so
  expect(calls.some((c) => c.path.endsWith("/tafrigh/runs") && c.method === "POST")).toBe(false);

  const max = screen.getByTestId("tfg-max");
  await userEvent.clear(max);
  await userEvent.type(max, "10");
  const lastPreview = () => ([...calls].reverse().find((c) => c.path.endsWith("/tafrigh/preview"))!.body as { seg_config: { max_words: number } }).seg_config.max_words;
  await waitFor(() => expect(lastPreview()).toBe(10)); // asked again after a short pause, with the new limit
  await waitFor(() => expect(screen.getByTestId("tfg-stat-longest")).toHaveTextContent("7"));
  expect(calls.some((c) => c.path.endsWith("/tafrigh/runs") && c.method === "POST")).toBe(false);
});

test("the estimate follows the mode: a window needs fewer requests than sentence by sentence (F-114)", async () => {
  server();
  renderApp("/lectures/1/tafrigh");
  await waitFor(() => expect(screen.getByTestId("est-requests")).toHaveTextContent("1")); // windowed is the default
  await userEvent.click(screen.getByRole("button", { name: "Sentence by sentence" }));
  await waitFor(() => expect(screen.getByTestId("est-requests")).toHaveTextContent("4"));
  expect(screen.getByTestId("est-row-per_sentence")).toHaveAttribute("aria-current", "true");
  await userEvent.selectOptions(screen.getByLabelText("Classifier"), "jev_hybrid");
  await waitFor(() => expect(screen.getByTestId("est-requests")).toHaveTextContent("9"));
});

test("a run sends the settings and the first-10 slice; progress, stop, and the saved run opens (F-111, F-113, F-115)", async () => {
  const saved = summary("run_aaaaaaaaaaaa", "تفريغ جديد");
  let runs: RunSummary[] = [];
  const calls = server({ details: { run_aaaaaaaaaaaa: detail("run_aaaaaaaaaaaa", "تفريغ جديد") } }, (call) => {
    if (call.path === "/api/tafrigh/runs" && call.method === "GET") return json(runs);
    if (call.path === "/api/tafrigh/jobs/t1/stop") return json({ job: job() });
  });
  renderApp("/lectures/1/tafrigh");
  await screen.findAllByTestId("tfg-sentence");
  await userEvent.click(screen.getByTestId("tfg-first-10"));
  await waitFor(() => expect(screen.getByTestId("tfg-from")).toHaveValue(1));
  await userEvent.click(screen.getByRole("button", { name: "Sentence by sentence" }));
  await waitFor(() => expect(screen.getByTestId("est-requests")).toHaveTextContent("4"));
  await start();

  const progress = await screen.findByTestId("tafrigh-progress");
  const body = calls.find((c) => c.method === "POST" && c.path === "/api/lectures/1/tafrigh/runs")!.body as Record<string, unknown>;
  expect(body).toMatchObject({ processing_mode: "per_sentence", target_range: [0, 3], typo_strategy: "gated" });
  expect(progress).toHaveTextContent("1 of 3 sentences");
  expect(screen.getByTestId("tfg-waiting")).toBeInTheDocument(); // the two sentences waited on
  expect(screen.getByTestId("tfg-start")).toBeDisabled();
  expect(screen.getByTestId("tfg-pause")).toBeDisabled();

  await userEvent.click(screen.getByTestId("tfg-stop"));
  expect(calls.some((c) => c.path === "/api/tafrigh/jobs/t1/stop" && c.method === "POST")).toBe(true);

  runs = [saved];
  FakeEventSource.all[0].push(job({ status: "done", progress: { done: 2, total: 3, percent: 100 }, result: { run_id: "run_aaaaaaaaaaaa", stopped: true, sentences: 2 } }));
  expect(await screen.findByTestId("tfg-finished")).toHaveTextContent("Stopped: only the 2 finished sentences are shown.");
  expect(await screen.findByTestId("tfg-lesson")).toBeInTheDocument();
  expect(screen.getByTestId("tfg-start")).toBeEnabled();
});

test("a failed run shows its error and retry goes back to the preview (F-116)", async () => {
  server();
  renderApp("/lectures/1/tafrigh");
  await screen.findAllByTestId("tfg-sentence");
  await start();
  await screen.findByTestId("tafrigh-progress");
  FakeEventSource.all[0].push(job({ status: "failed", error: "Gemini key rejected" }));
  expect(await screen.findByTestId("tfg-failed")).toHaveTextContent("Gemini key rejected");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(screen.queryByTestId("tafrigh-progress")).not.toBeInTheDocument();
  expect(screen.getByTestId("tfg-preview")).toBeInTheDocument();
  expect(screen.getByTestId("tfg-start")).toBeEnabled();
});

test("a refused start is shown and nothing runs", async () => {
  server({ startFails: "the sentence range 5–5 is empty" });
  renderApp("/lectures/1/tafrigh");
  await screen.findAllByTestId("tfg-sentence");
  await start();
  expect(await screen.findByText(/the sentence range 5–5 is empty/)).toBeInTheDocument();
  expect(screen.queryByTestId("tafrigh-progress")).not.toBeInTheDocument();
});

test("the lesson: warnings, the summary and cost breakdown, the outline scrolls to its heading and opens the details (F-117, F-118)", async () => {
  const run = detail("run_aaaaaaaaaaaa", "تفريغ جديد");
  run.warnings = ["تم إيقاف التفريغ بطلب منك"];
  server({ runs: [summary("run_aaaaaaaaaaaa", "تفريغ جديد")], details: { run_aaaaaaaaaaaa: run } });
  renderApp("/lectures/1/tafrigh");
  const lesson = await screen.findByTestId("tfg-lesson");
  expect(within(lesson).getByTestId("tfg-warnings")).toHaveTextContent("تم إيقاف التفريغ");
  expect(within(lesson).getByTestId("tfg-breakdown")).toHaveTextContent("gemini-3.5-flash-lite");
  expect(within(lesson).getByTestId("tfg-cost")).toHaveTextContent("$0.0012");
  expect(within(lesson).getAllByTestId("tfg-seg")).toHaveLength(3);

  await userEvent.click(within(screen.getByTestId("tfg-outline")).getByRole("button", { name: "عنوان الفصل" }));
  const card = await screen.findByTestId("tfg-card");
  expect(card).toHaveAttribute("data-segment", "seg_0003");
  await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  expect(within(card).getByTestId("card-confidence")).toHaveTextContent("57%");
  expect(within(card).getByTestId("card-source")).toHaveTextContent("Model");
});

test("the details of a split sentence say who asked and where it cut; fixes say why they were turned down (F-118)", async () => {
  const split = seg(1, {
    trace: {
      decision: { provider: "jev", answers: { tag: { choice: "paragraph", confidence: 0.9, probabilities: { paragraph: 0.9 } } } },
      split_from: { piece: 2, pieces: 2, text: "قال الله تعالى إنا أعطيناك الكوثر", split: { used: [3], points_by: "model_decision" }, decision: { provider: "gemini" } },
      edits: { accepted: [{ original: "الكوتر", replacement: "الكوثر", reason: "typo" }], rejected: [{ original: "تعالى", replacement: "تعالي", why: "no_change" }] },
    },
  });
  server({ runs: [summary("run_aaaaaaaaaaaa", "تفريغ")], details: { run_aaaaaaaaaaaa: detail("run_aaaaaaaaaaaa", "تفريغ", [seg(0), split, seg(2)]) } });
  renderApp("/lectures/1/tafrigh");
  const lesson = await screen.findByTestId("tfg-lesson");
  await userEvent.click(within(lesson).getAllByTestId("tfg-seg")[1].querySelector("button.sent")!);
  const note = await screen.findByTestId("card-split");
  expect(note).toHaveTextContent("Piece 2/2 of a split sentence");
  expect(note).toHaveTextContent("Split asked by: Gemini");
  expect(note).toHaveTextContent("labelled by: JEV");
  expect(note).toHaveTextContent("✂ إنا"); // the cut is marked on the original sentence
  const edits = screen.getByTestId("card-edits");
  expect(edits).toHaveTextContent("الكوتر");
  expect(edits).toHaveTextContent("No change");
});

test("review: relabel and confirm are sent to the server, and the next sentence to review opens (F-119)", async () => {
  const first = detail("run_aaaaaaaaaaaa", "تفريغ");
  const afterRelabel = detail("run_aaaaaaaaaaaa", "تفريغ", [seg(0), seg(1, { tag: "heading", level: 2, trace: { review: { action: "correct" } } }), seg(2)], [item(2)]);
  const calls = server({ runs: [summary("run_aaaaaaaaaaaa", "تفريغ")], details: { run_aaaaaaaaaaaa: first } }, (call) => {
    if (call.path === "/api/tafrigh/runs/run_aaaaaaaaaaaa/review") return json(afterRelabel);
  });
  renderApp("/lectures/1/tafrigh");
  await screen.findByTestId("tfg-lesson");
  await userEvent.click(screen.getByTestId("tfg-view-review"));
  const queue = await screen.findByTestId("tfg-review");
  expect(screen.getByTestId("tfg-review-count")).toHaveTextContent("2 sentences need review");
  await userEvent.click(within(queue).getAllByTestId("tfg-review-item")[0].querySelector("button.sent")!);
  const card = await screen.findByTestId("tfg-card");
  await userEvent.selectOptions(within(card).getByTestId("card-relabel"), "heading:2");
  await waitFor(() => expect(calls.some((c) => c.path.endsWith("/review"))).toBe(true));
  expect(calls.find((c) => c.path.endsWith("/review"))!.body).toEqual({ segment_id: "seg_0002", action: "correct", corrected_tag: "heading", corrected_level: 2, reviewer_id: "web_editor" });
  // the relabelled sentence left the queue and the other one opened
  await waitFor(() => expect(screen.getByTestId("tfg-card")).toHaveAttribute("data-segment", "seg_0003"));
  expect(screen.getByTestId("tfg-review-count")).toHaveTextContent("1 sentences need review");
  // the third has a typo fix that can be undone
  await userEvent.click(screen.getByTestId("card-undo"));
  await waitFor(() => expect(calls.filter((c) => c.path.endsWith("/review"))).toHaveLength(2));
  expect(calls.filter((c) => c.path.endsWith("/review"))[1].body).toMatchObject({ segment_id: "seg_0003", action: "reject" });
});

test("save as new copies the run and the copy is the one open; the picker lists both (F-121)", async () => {
  const a = summary("run_aaaaaaaaaaaa", "الأولى");
  const copy = summary("run_bbbbbbbbbbbb", "نسخة", { copied_from: "run_aaaaaaaaaaaa" });
  let runs = [a];
  const calls = server({ details: { run_aaaaaaaaaaaa: detail("run_aaaaaaaaaaaa", "الأولى"), run_bbbbbbbbbbbb: detail("run_bbbbbbbbbbbb", "نسخة") } }, (call) => {
    if (call.path === "/api/tafrigh/runs" && call.method === "GET") return json(runs);
    if (call.path === "/api/tafrigh/runs/run_aaaaaaaaaaaa/clone") {
      runs = [copy, a];
      return json(copy, 201);
    }
  });
  renderApp("/lectures/1/tafrigh");
  await screen.findByTestId("tfg-lesson");
  await userEvent.click(screen.getByTestId("tfg-clone"));
  const name = screen.getByTestId("tfg-run-name");
  await userEvent.clear(name);
  await userEvent.type(name, "نسخة{Enter}");
  await waitFor(() => expect(screen.getByTestId("tfg-run-picker")).toHaveValue("run_bbbbbbbbbbbb"));
  expect(calls.find((c) => c.path.endsWith("/clone"))!.body).toEqual({ name: "نسخة" });
  expect(within(screen.getByTestId("tfg-run-picker")).getAllByRole("option")).toHaveLength(2);
});

test("comparing two runs lists the sentences they label differently (F-122)", async () => {
  const runs = [summary("run_aaaaaaaaaaaa", "الأولى"), summary("run_bbbbbbbbbbbb", "الثانية", { processing_mode: "per_sentence" })];
  const result: CompareResult = {
    runs: runs.map((r) => ({ run_id: r.run_id, name: r.name, model_candidate: "gemini_all", processing_mode: r.processing_mode, jev_layout: null, typo_strategy: "gated", num_segments: 3, wall_clock_seconds: 4, total_cost_usd: 0.001, cost_per_100_sentences_usd: 0.03, requests_sent: 2, failure_rate: 0, fallback_rate: 0, tag_distribution: { paragraph: 3 } })),
    comparisons: [{ a: "run_aaaaaaaaaaaa", b: "run_bbbbbbbbbbbb", count: 1, disagreements: [{ segment_id: "seg_0002", text: "قال الله تعالى", diff_type: "tag: 'paragraph' vs 'continuation'", run_a: "paragraph", run_b: "continuation" }] }],
    markdown: "# compare",
  };
  const calls = server({ runs, details: { run_aaaaaaaaaaaa: detail("run_aaaaaaaaaaaa", "الأولى"), run_bbbbbbbbbbbb: detail("run_bbbbbbbbbbbb", "الثانية") } }, (call) => {
    if (call.path === "/api/tafrigh/compare") return json(result);
  });
  renderApp("/lectures/1/tafrigh");
  await screen.findByTestId("tfg-lesson");
  await userEvent.click(screen.getByTestId("tfg-view-compare"));
  const row = await screen.findByTestId("tfg-disagreement");
  expect(row).toHaveTextContent("قال الله تعالى");
  expect(row).toHaveTextContent("tag: 'paragraph' vs 'continuation'");
  expect(screen.getAllByTestId("tfg-compare-run")).toHaveLength(2);
  expect(calls.find((c) => c.path === "/api/tafrigh/compare")!.body).toEqual({ run_ids: ["run_aaaaaaaaaaaa", "run_bbbbbbbbbbbb"] });
  expect(screen.getByTestId("tfg-disagreements")).toHaveTextContent("1 sentences labelled differently");
});

test("re-running the engine first asks twice, detects with the chosen engine, and reads the sentences again (F-109)", async () => {
  const detect = job({ id: "d1", kind: "detect", progress: { stage: "detect", percent: 10 } });
  const calls = server({}, (call) => {
    if (call.path === "/api/lectures/1/detect") return json({ job: detect }, 202);
  });
  renderApp("/lectures/1/tafrigh");
  await screen.findAllByTestId("tfg-sentence");
  const previews = () => calls.filter((c) => c.path.endsWith("/tafrigh/preview")).length;
  const before = previews();

  await userEvent.selectOptions(screen.getByLabelText("Detection engine"), "v4");
  await userEvent.click(screen.getByTestId("tfg-redetect-start"));
  expect(calls.some((c) => c.path === "/api/lectures/1/detect")).toBe(false); // the first click only asks
  await userEvent.click(screen.getByTestId("tfg-redetect-start"));
  await screen.findByTestId("tfg-redetect-status");
  expect(calls.find((c) => c.path === "/api/lectures/1/detect")!.body).toEqual({ engine: "v4" });
  expect(screen.getByTestId("tfg-start")).toBeDisabled(); // no run while the quotes are being found

  FakeEventSource.all[0].push({ ...detect, status: "done" });
  await waitFor(() => expect(screen.getByTestId("tfg-redetect-status")).toHaveAttribute("data-status", "done"));
  await waitFor(() => expect(previews()).toBeGreaterThan(before));
  await waitFor(() => expect(screen.getByTestId("tfg-start")).toBeEnabled());
});

test("with JEV or Laya as the classifier, the Gemini model and route are the helper for splits and typo fixes (F-110)", async () => {
  server();
  renderApp("/lectures/1/tafrigh");
  await screen.findAllByTestId("tfg-sentence");
  expect(screen.getByText("Gemini model")).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Classifier"), "jev_hybrid");
  expect(screen.getByText("Helper Gemini model (splits and typo fixes)")).toBeInTheDocument();
  expect(screen.getByLabelText("JEV questions")).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Classifier"), "openrouter_chat");
  expect(screen.queryByText("Helper Gemini model (splits and typo fixes)")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Chat model")).toBeInTheDocument();
});

test("save for Laya: leaves out what needs review, quick picks, and sends the chosen sentences with the note (F-120)", async () => {
  const reviewed = detail("run_aaaaaaaaaaaa", "تفريغ", [seg(0, { trace: { review: { action: "confirm" } } }), seg(1), seg(2)], [item(1), item(2)]);
  const calls = server({ runs: [summary("run_aaaaaaaaaaaa", "تفريغ")], details: { run_aaaaaaaaaaaa: reviewed } }, (call) => {
    if (call.path === "/api/training/tafrigh/run_aaaaaaaaaaaa" && call.method === "GET") return json(null);
    if (call.path === "/api/training/tafrigh/run_aaaaaaaaaaaa" && call.method === "POST")
      return json({ run_id: "run_aaaaaaaaaaaa", segment_ids: ["seg_0001", "seg_0002"], sentences: 2, count: 2, by_source: { human_confirmed: 1, model: 1 }, note: "أول حفظ", saved_at: now });
  });
  renderApp("/lectures/1/tafrigh");
  await screen.findByTestId("tfg-lesson");
  await userEvent.click(screen.getByTestId("tfg-laya"));
  const dialog = await screen.findByRole("dialog");
  // two sentences wait for review, so only the first is chosen at first
  expect(within(dialog).getByTestId("tfg-laya-count")).toHaveTextContent("1 of 3 chosen");
  expect(within(dialog).getByTestId("tfg-laya-count")).toHaveTextContent("Confirmed 1");
  await userEvent.click(within(dialog).getByTestId("tfg-laya-pick-all"));
  expect(within(dialog).getByTestId("tfg-laya-count")).toHaveTextContent("3 of 3 chosen");
  await userEvent.click(within(dialog).getAllByTestId("tfg-laya-seg")[2]);
  await userEvent.type(within(dialog).getByLabelText("A note on this save (optional)"), "أول حفظ");
  await userEvent.click(within(dialog).getByTestId("tfg-laya-confirm"));
  await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/training/tafrigh/run_aaaaaaaaaaaa")).toBe(true));
  expect(calls.find((c) => c.method === "POST" && c.path.startsWith("/api/training/tafrigh/"))!.body).toEqual({ segment_ids: ["seg_0001", "seg_0002"], note: "أول حفظ" });
  expect(await screen.findByText("2 training examples saved from 2 sentences")).toBeInTheDocument();
  expect(screen.getByTestId("tfg-laya-saved")).toHaveTextContent("✓ 2");
});
