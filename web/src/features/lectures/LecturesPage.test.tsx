import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Job, Lecture } from "./api";
import { fakeServer, json, renderApp, type Call } from "../../test/render";

const now = "2026-11-06T10:00:00";
const lecture = (over: Partial<Lecture> = {}): Lecture => ({
  id: 1, title: "درس", source_kind: "text", source_url: null, has_media: false, duration_s: null, language: "ar",
  transcription_model: null, word_count: 12, version_count: 1, created_at: now, updated_at: now, ...over,
});
const job = (over: Partial<Job> = {}): Job => ({
  id: "j1", kind: "detect", status: "queued", lecture_id: 1, params: {}, progress: {}, result: null, error: null,
  created_at: now, started_at: null, finished_at: null, updated_at: now, ...over,
});

/** A stand-in for the browser's EventSource that the test pushes job snapshots into. */
class FakeEventSource {
  static all: FakeEventSource[] = [];
  listeners = new Map<string, (e: MessageEvent<string>) => void>();
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(name: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.set(name, fn);
  }
  close() {
    this.closed = true;
  }
  push(snapshot: Job) {
    act(() => this.listeners.get("job")?.({ data: JSON.stringify(snapshot) } as MessageEvent<string>));
  }
}

beforeEach(() => {
  FakeEventSource.all = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  window.localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const models = [
  { id: "groq", label: "Groq · whisper-large-v3-turbo", kind: "cloud", available: true, reason: null, default: true },
  { id: "local-small", label: "Whisper small int8 (محلي)", kind: "local", available: true, reason: null, default: false },
];

/** A fake server with one list of lectures and one of jobs, answering the calls these screens make. */
function server(state: { lectures: Lecture[]; jobs: Job[] }, extra: (call: Call) => Response | undefined = () => undefined) {
  return fakeServer((call) => {
    const answer = extra(call);
    if (answer) return answer;
    if (call.path === "/api/lectures" && call.method === "GET") return json(state.lectures);
    if (call.path === "/api/jobs" && call.method === "GET") return json(state.jobs);
    if (call.path === "/api/transcription/models") return json(models);
    if (call.path.endsWith("/findings")) return json({ lecture_id: 1, count: 0, findings: [] });
    if (call.path.endsWith("/versions")) return json([]);
  });
}

test("pasting text creates the lecture and starts detection, whose stages show", async () => {
  const state = { lectures: [] as Lecture[], jobs: [] as Job[] };
  const calls = server(state, (call) => {
    if (call.method === "POST" && call.path === "/api/lectures") {
      state.lectures = [lecture({ title: "موعظة" })];
      return json({ ...lecture({ title: "موعظة" }), words: [] }, 201);
    }
    if (call.path === "/api/lectures/1/detect") {
      state.jobs = [job()];
      return json({ job: job() }, 202);
    }
  });
  renderApp("/lectures");
  await userEvent.type(await screen.findByLabelText("العنوان · اختياري"), "موعظة");
  await userEvent.type(screen.getByLabelText("النص"), "بسم الله الرحمن الرحيم");
  await userEvent.click(screen.getByRole("button", { name: "إنشاء المحاضرة" }));

  expect(await screen.findByText("تم إنشاء المحاضرة «موعظة»")).toBeInTheDocument();
  expect(calls.find((c) => c.path === "/api/lectures" && c.method === "POST")?.body).toEqual({
    text: "بسم الله الرحمن الرحيم", title: "موعظة", filename: "",
  });
  const card = await screen.findByTestId("job-detect");
  expect(within(card).getAllByRole("listitem").map((x) => x.textContent)).toEqual(["تحميل", "كشف الاقتباسات", "حفظ"]);

  // the progress stream moves the card to "detect", then to done with the count
  const stream = FakeEventSource.all.find((s) => s.url === "/api/jobs/j1/events")!;
  stream.push(job({ status: "running", progress: { stage: "detect", stages: ["load", "detect", "save"] } }));
  await waitFor(() => expect(within(card).getByText("كشف الاقتباسات", { selector: "[data-stage] ,[data-stage]" })).toHaveAttribute("data-state", "on"));
  stream.push(job({ status: "done", result: { count: 7 }, progress: { stage: "save", percent: 100 } }));
  expect(await within(card).findByText("7 اقتباس")).toBeInTheDocument();
  expect(card).toHaveAttribute("data-status", "done");
  expect(stream.closed).toBe(true);
});

test("a YouTube link sends the chosen model, shows the stages with a percentage, and detection starts when transcription ends", async () => {
  const state = { lectures: [] as Lecture[], jobs: [] as Job[] };
  const tjob = (over: Partial<Job> = {}) =>
    job({ id: "t1", kind: "transcribe", progress: { stage: "download", stages: ["download", "audio", "transcribe", "save"] }, ...over });
  const calls = server(state, (call) => {
    if (call.path === "/api/transcriptions/youtube") {
      state.lectures = [lecture({ title: "خطبة", source_kind: "youtube" })];
      state.jobs = [tjob({ status: "running" })];
      return json({ lecture: state.lectures[0], job: tjob({ status: "running" }) }, 202);
    }
    if (call.path === "/api/lectures/1/detect") {
      state.jobs = [job({ id: "d1" }), ...state.jobs];
      return json({ job: job({ id: "d1" }) }, 202);
    }
  });
  renderApp("/lectures");
  await userEvent.click(await screen.findByRole("button", { name: /رابط يوتيوب/ }));
  await userEvent.type(screen.getByLabelText("رابط يوتيوب", { selector: "input" }), "https://youtu.be/abc");
  await waitFor(() => expect(screen.getByLabelText("نموذج التفريغ الصوتي")).toHaveValue("groq"));
  await userEvent.selectOptions(screen.getByLabelText("نموذج التفريغ الصوتي"), "local-small");
  await userEvent.click(screen.getByRole("button", { name: "بدء التفريغ" }));

  await waitFor(() => expect(calls.some((c) => c.path === "/api/transcriptions/youtube")).toBe(true));
  expect(calls.find((c) => c.path === "/api/transcriptions/youtube")?.body).toMatchObject({
    url: "https://youtu.be/abc", model: "local-small", auto_fallback: true,
  });
  const card = await screen.findByTestId("job-transcribe");
  const stream = FakeEventSource.all.find((s) => s.url === "/api/jobs/t1/events")!;
  stream.push(tjob({ status: "running", progress: { stage: "transcribe", stages: ["download", "audio", "transcribe", "save"], percent: 62 } }));
  await waitFor(() => expect(within(card).getByText("تفريغ صوتي 62%")).toBeInTheDocument());
  const states = within(card).getAllByRole("listitem").map((x) => x.getAttribute("data-state"));
  expect(states).toEqual(["done", "done", "on", "todo"]);

  // the transcription ends: the watcher starts detection (the lecture has no findings and no detect job)
  state.jobs = [tjob({ status: "done", result: { model_used: "Whisper small", word_count: 900, fallback: { reason: "bad key" } } })];
  stream.push(state.jobs[0]);
  expect(await within(card).findByText("Whisper small · 900 كلمة")).toBeInTheDocument();
  expect(within(card).getByText(/bad key/)).toBeInTheDocument();
  await waitFor(() => expect(calls.some((c) => c.path === "/api/lectures/1/detect")).toBe(true), { timeout: 4000 });
});

test("a text file is uploaded as a form", async () => {
  const state = { lectures: [] as Lecture[], jobs: [] as Job[] };
  const calls = server(state, (call) => {
    if (call.path === "/api/lectures/import") return json({ ...lecture({ source_kind: "vtt" }), words: [] }, 201);
    if (call.path === "/api/lectures/1/detect") return json({ job: job() }, 202);
  });
  renderApp("/lectures");
  await userEvent.click(await screen.findByRole("button", { name: /ملف نصي/ }));
  const file = new File(["WEBVTT\n\n00:00.000 --> 00:02.000\nبسم الله"], "a.vtt", { type: "text/vtt" });
  await userEvent.upload(document.querySelector<HTMLInputElement>("#text-file")!, file);
  expect(screen.getByText("الملف المختار: a.vtt")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "إنشاء المحاضرة" }));
  await waitFor(() => expect(calls.some((c) => c.path === "/api/lectures/1/detect")).toBe(true));
  // (jsdom cannot read a FormData body back; the Playwright test sends a real file to the real server)
  expect(calls.find((c) => c.path === "/api/lectures/import")?.method).toBe("POST");
});

test("the sample lecture is created in one click", async () => {
  const state = { lectures: [] as Lecture[], jobs: [] as Job[] };
  const calls = server(state, (call) => {
    if (call.path === "/api/lectures/sample") return json({ ...lecture({ source_kind: "sample", title: "تجريبية" }), words: [] }, 201);
    if (call.path === "/api/lectures/1/detect") return json({ job: job() }, 202);
  });
  renderApp("/lectures");
  await userEvent.click(await screen.findByRole("button", { name: /المحاضرة التجريبية/ }));
  await userEvent.click(screen.getByRole("button", { name: "فتح المحاضرة التجريبية" }));
  await waitFor(() => expect(calls.some((c) => c.path === "/api/lectures/1/detect")).toBe(true));
});

test("saved lectures can be searched, renamed and deleted, and all of them can be deleted", async () => {
  const state = { lectures: [lecture({ id: 1, title: "الأول" }), lecture({ id: 2, title: "الثاني", source_kind: "youtube" })], jobs: [] as Job[] };
  const calls = server(state, (call) => {
    if (call.method === "PATCH" && call.path === "/api/lectures/1") {
      state.lectures[0] = lecture({ id: 1, title: "الجديد" });
      return json(state.lectures[0]);
    }
    if (call.method === "DELETE" && call.path === "/api/lectures/2") {
      state.lectures = state.lectures.slice(0, 1);
      return new Response(null, { status: 204 });
    }
    if (call.method === "DELETE" && call.path === "/api/lectures") {
      state.lectures = [];
      return json({ deleted: 1 });
    }
  });
  renderApp("/lectures");
  const rows = await screen.findAllByTestId("lecture-row");
  expect(rows).toHaveLength(2);

  await userEvent.type(screen.getByLabelText("بحث"), "الثاني");
  expect(screen.getAllByTestId("lecture-row")).toHaveLength(1);
  await userEvent.clear(screen.getByLabelText("بحث"));

  await userEvent.click(within(screen.getAllByTestId("lecture-row")[0]).getByRole("button", { name: "إعادة تسمية" }));
  const box = screen.getByLabelText("العنوان الجديد");
  await userEvent.clear(box);
  await userEvent.type(box, "الجديد{enter}");
  expect(await screen.findByText("الجديد")).toBeInTheDocument();
  expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ title: "الجديد" });

  // deleting needs a second click
  const second = () => screen.getAllByTestId("lecture-row")[1];
  await userEvent.click(within(second()).getByRole("button", { name: "حذف" }));
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  await userEvent.click(within(second()).getByRole("button", { name: "تأكيد الحذف" }));
  await waitFor(() => expect(screen.getAllByTestId("lecture-row")).toHaveLength(1));

  await userEvent.click(screen.getByRole("button", { name: "حذف الكل" }));
  await userEvent.click(screen.getByRole("button", { name: "تأكيد: حذف كل المحاضرات" }));
  expect(await screen.findByText("لا توجد محاضرات بعد. أنشئ واحدة من الأعلى.")).toBeInTheDocument();
  expect(calls.find((c) => c.method === "DELETE" && c.path === "/api/lectures")).toBeDefined();
});

test("the last opened lecture opens at startup, and a deleted one falls back to the list", async () => {
  const state = { lectures: [lecture({ id: 5, title: "الأخير" })], jobs: [] as Job[] };
  server(state, (call) => {
    if (call.path === "/api/lectures/5") return json({ ...state.lectures[0], words: [{ idx: 0, text: "بسم", start: 0, end: 1 }] });
    if (call.path === "/api/lectures/9") return json({ detail: "not found: 9" }, 404);
  });
  window.localStorage.setItem("wahy.last-lecture", "5");
  renderApp("/");
  expect(await screen.findByRole("heading", { name: "الأخير" })).toBeInTheDocument();
  expect(await screen.findByTestId("transcript")).toHaveTextContent("بسم");

  window.localStorage.setItem("wahy.last-lecture", "9");
  renderApp("/");
  expect(await screen.findByRole("heading", { name: "محاضرة جديدة" })).toBeInTheDocument();
  expect(window.localStorage.getItem("wahy.last-lecture")).toBeNull();
});
